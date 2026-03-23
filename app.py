import os, json, re, threading, time
from flask import Flask, render_template, jsonify, request
import paramiko
from cryptography.fernet import Fernet

app = Flask(__name__)

APP_VERSION = "v0.4.0"

# --- Authentication ---
AUTH_TOKEN = os.environ.get('CHRONOLENS_AUTH_TOKEN', '')

@app.before_request
def check_auth():
    if not AUTH_TOKEN:
        return  # No token configured = no auth enforced (backwards compat)
    if request.path.startswith('/api/'):
        provided = request.headers.get('Authorization', '')
        if provided != f'Bearer {AUTH_TOKEN}':
            return jsonify({"error": "unauthorized"}), 401

@app.after_request
def security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response

# --- SSH Connection Limiter ---
_ssh_semaphore = threading.Semaphore(3)

# --- Directory and File Paths ---
DATA_DIR = '/app/data'
CONFIG_FILE = os.path.join(DATA_DIR, 'config.json')
KEY_FILE = os.path.join(DATA_DIR, 'secret.key')
SSH_KEY_DIR = '/app/ssh'
DEFAULT_CONFIG = '/app/config.default.json'

os.makedirs(DATA_DIR, exist_ok=True)
if not os.path.exists(CONFIG_FILE) and os.path.exists(DEFAULT_CONFIG):
    import shutil
    shutil.copy2(DEFAULT_CONFIG, CONFIG_FILE)

# --- Encryption Logic ---
def get_cipher():
    if not os.path.exists(KEY_FILE):
        key = Fernet.generate_key()
        fd = os.open(KEY_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as key_file:
            key_file.write(key)
    else:
        with open(KEY_FILE, 'rb') as key_file:
            key = key_file.read()
    return Fernet(key)

def encrypt_pwd(pwd):
    if not pwd: return ""
    return get_cipher().encrypt(pwd.encode()).decode()

def decrypt_pwd(encrypted_pwd):
    if not encrypted_pwd: return ""
    try:
        return get_cipher().decrypt(encrypted_pwd.encode()).decode()
    except Exception:
        return ""  # decryption failed — require re-entry

def find_ssh_key():
    if not os.path.isdir(SSH_KEY_DIR):
        return None
    for name in ['id_rsa', 'id_ed25519', 'id_ecdsa', 'key', 'cc']:
        path = os.path.join(SSH_KEY_DIR, name)
        if os.path.isfile(path):
            return path
    return None

# --- Config Handling ---
def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r') as f: return json.load(f)
        except Exception: pass
    return {"mode": "remote", "host": "", "user": "ubuntu", "password": "", "auth": "key"}

def save_config(config):
    with open(CONFIG_FILE, 'w') as f: json.dump(config, f)

KNOWN_HOSTS_FILE = os.path.join(DATA_DIR, 'known_hosts')

def run_commands_remote(cmds, config):
    if not _ssh_semaphore.acquire(timeout=5):
        return ["Error: too many concurrent SSH connections"] * len(cmds)
    ssh = paramiko.SSHClient()
    if os.path.exists(KNOWN_HOSTS_FILE):
        ssh.load_host_keys(KNOWN_HOSTS_FILE)
    ssh.set_missing_host_key_policy(paramiko.WarningPolicy())
    results = []
    try:
        auth_mode = config.get('auth', 'key')
        connect_kwargs = {
            'hostname': config.get('host'),
            'username': config.get('user'),
            'timeout': 10,
            'banner_timeout': 15,
            'auth_timeout': 15,
        }
        if auth_mode == 'password':
            enc_pwd = config.get('password')
            pwd = decrypt_pwd(enc_pwd) if enc_pwd else None
            connect_kwargs['password'] = pwd
            connect_kwargs['look_for_keys'] = False
        else:
            key_path = find_ssh_key()
            if key_path:
                connect_kwargs['key_filename'] = key_path
                connect_kwargs['look_for_keys'] = False
            else:
                connect_kwargs['look_for_keys'] = True

        ssh.connect(**connect_kwargs)
        for cmd in cmds:
            stdin, stdout, stderr = ssh.exec_command(cmd, timeout=5)
            err_out = stderr.read().decode('utf-8').strip()
            std_out = stdout.read().decode('utf-8').strip()
            exit_status = stdout.channel.recv_exit_status()
            if exit_status != 0:
                results.append(f"Error: {err_out if err_out else std_out}")
            else:
                results.append(std_out)
    except Exception as e:
        return [f"Error: {str(e)}"] * len(cmds)
    finally:
        ssh.close()
        _ssh_semaphore.release()
    return results

def _parse_signed_float(val, pattern):
    """Extract a float from val using pattern. Returns the float or None."""
    m = re.match(pattern, val)
    return float(m.group(1)) if m else None

def _parse_directional(val, pattern):
    """Extract a float with fast/slow direction (slow = negative). Returns float or None."""
    m = re.match(pattern, val)
    if not m:
        return None
    v = float(m.group(1))
    return -v if m.group(2) == 'slow' else v

def parse_tracking(raw):
    """Parse chronyc tracking output into structured dict"""
    result = {}
    if raw.startswith("Error"):
        return {"error": raw}

    # Mapping of chrony keys to: (result_key, parser_type)
    # 'seconds_dir' = unsigned float + fast/slow direction
    # 'seconds_signed' = signed float in seconds
    # 'seconds' = unsigned float in seconds
    # 'ppm_dir' = unsigned float + fast/slow direction in ppm
    # 'ppm_signed' = signed float in ppm
    # 'ppm' = unsigned float in ppm
    SECONDS_DIR = r'([\d.]+)\s+seconds\s+(fast|slow)'
    SECONDS_SIGNED = r'([+-]?[\d.]+)\s+seconds'
    SECONDS = r'([\d.]+)\s+seconds'
    PPM_DIR = r'([\d.]+)\s+ppm\s+(fast|slow)'
    PPM_SIGNED = r'([+-]?[\d.]+)\s+ppm'
    PPM = r'([\d.]+)\s+ppm'

    for line in raw.strip().split('\n'):
        if ':' not in line:
            continue
        key, val = line.split(':', 1)
        key = key.strip()
        val = val.strip()

        if key == 'Reference ID':
            parts = val.split('(')
            result['ref_id'] = parts[0].strip()
            result['ref_name'] = parts[1].rstrip(')') if len(parts) > 1 else ''
        elif key == 'Stratum':
            result['stratum'] = int(val) if val.isdigit() else val
        elif key == 'System time':
            v = _parse_directional(val, SECONDS_DIR)
            if v is not None:
                result['system_time'] = v
                result['system_time_str'] = val
        elif key == 'Last offset':
            v = _parse_signed_float(val, SECONDS_SIGNED)
            if v is not None: result['last_offset'] = v
            result['last_offset_str'] = val
        elif key == 'RMS offset':
            v = _parse_signed_float(val, SECONDS)
            if v is not None: result['rms_offset'] = v
            result['rms_offset_str'] = val
        elif key == 'Frequency':
            v = _parse_directional(val, PPM_DIR)
            if v is not None:
                result['frequency'] = v
                result['frequency_str'] = val
        elif key == 'Residual freq':
            v = _parse_signed_float(val, PPM_SIGNED)
            if v is not None: result['residual_freq'] = v
            result['residual_freq_str'] = val
        elif key == 'Skew':
            v = _parse_signed_float(val, PPM)
            if v is not None: result['skew'] = v
            result['skew_str'] = val
        elif key == 'Root delay':
            v = _parse_signed_float(val, SECONDS)
            if v is not None: result['root_delay'] = v
            result['root_delay_str'] = val
        elif key == 'Root dispersion':
            v = _parse_signed_float(val, SECONDS)
            if v is not None: result['root_dispersion'] = v
            result['root_dispersion_str'] = val
        elif key == 'Update interval':
            v = _parse_signed_float(val, SECONDS)
            if v is not None: result['update_interval'] = v
            result['update_interval_str'] = val
        elif key == 'Leap status':
            result['leap_status'] = val
        elif key == 'Ref time (UTC)':
            result['ref_time'] = val
    return result

def to_microseconds(val_str):
    """Convert a chrony time value (e.g. '12.3us', '4.5ms') to microseconds"""
    m = re.match(r'([+-]?[\d.]+)(ns|us|ms|s)', val_str)
    if not m:
        return 0
    v = float(m.group(1))
    unit = m.group(2)
    if unit == 'ns': return v / 1000
    if unit == 'us': return v
    if unit == 'ms': return v * 1000
    return v * 1e6  # 's'

def parse_sourcestats(raw):
    """Parse chronyc sourcestats into structured list"""
    stats = []
    if raw.startswith("Error"):
        return stats
    lines = raw.strip().split('\n')
    start_idx = next((i + 1 for i, l in enumerate(lines) if set(l.strip()) == {'='}), -1)
    if start_idx == -1:
        return stats
    for line in lines[start_idx:]:
        if not line.strip():
            continue
        parts = line.split()
        if len(parts) >= 8:
            stats.append({
                "name": parts[0],
                "np": int(parts[1]) if parts[1].isdigit() else 0,
                "nr": int(parts[2]) if parts[2].isdigit() else 0,
                "span": parts[3],
                "frequency": parts[4],
                "freq_skew": parts[5],
                "offset": parts[6],
                "offset_us": to_microseconds(parts[6]),
                "std_dev": parts[7],
                "std_dev_us": to_microseconds(parts[7]),
            })
    return stats

DEFAULT_CESIUM_TOKEN = os.environ.get('CESIUM_TOKEN', '')

@app.route('/')
def index():
    return render_template('index.html', app_version=APP_VERSION, auth_token=AUTH_TOKEN)

@app.route('/satellite')
def satellite():
    conf = load_config()
    raw_token = decrypt_pwd(conf.get('cesium_token', ''))
    token = raw_token or DEFAULT_CESIUM_TOKEN
    try: lat = float(conf.get('receiver_lat'))
    except (ValueError, TypeError): lat = 39.0
    try: lon = float(conf.get('receiver_lon'))
    except (ValueError, TypeError): lon = -98.0
    return render_template('satellite.html', cesium_token=token, receiver_lat=lat, receiver_lon=lon, app_version=APP_VERSION, auth_token=AUTH_TOKEN)

@app.route('/api/ntp')
def get_ntp():
    config = load_config()
    cmds = ["chronyc tracking", "chronyc sources", "chronyc sourcestats"]

    outs = run_commands_remote(cmds, config)

    tracking_out = outs[0]
    sources_out = outs[1]
    sourcestats_out = outs[2] if len(outs) > 2 else ""

    # Parse tracking into structured data
    tracking = parse_tracking(tracking_out)

    # Legacy offset string for backward compat
    offset = tracking.get('system_time_str', 'Unknown')

    # Parse sources — correct refclock stratum 0 to server's actual stratum
    server_stratum = tracking.get('stratum', 1)
    sources = []
    lines = sources_out.strip().split('\n')
    start_idx = next((i + 1 for i, l in enumerate(lines) if set(l.strip()) == {'='}), -1)
    if start_idx != -1:
        for line in lines[start_idx:]:
            if not line.strip(): continue
            parts = line.split()
            if len(parts) >= 6:
                raw_stratum = parts[2]
                name = parts[1]
                is_refclock = name.startswith('.') or any(x in name.upper() for x in ['NMEA', 'PPS', 'GPS', 'SHM'])
                if raw_stratum == '0' and is_refclock:
                    stratum = str(server_stratum)
                else:
                    stratum = raw_stratum
                sources.append({
                    "state": parts[0], "name": name, "stratum": stratum,
                    "raw_stratum": raw_stratum, "is_refclock": is_refclock,
                    "poll": parts[3], "reach": parts[4], "lastrx": parts[5],
                    "last_sample": " ".join(parts[6:])
                })

    # Parse sourcestats
    sourcestats = parse_sourcestats(sourcestats_out)

    err = tracking_out if tracking_out.startswith("Error") else None
    if not err and sources_out.startswith("Error"):
        err = sources_out

    return jsonify({
        "offset": offset,
        "sources": sources,
        "tracking": tracking,
        "sourcestats": sourcestats,
        "error": err
    })

@app.route('/api/gps')
def get_gps():
    config = load_config()
    cmd = ["timeout 3 gpspipe -w -n 12"]

    gps_out = run_commands_remote(cmd, config)[0]

    satellites = []
    gps_time = "Waiting for lock..."
    receiver_lat = None
    receiver_lon = None

    if gps_out and "Error" not in gps_out:
        for line in gps_out.strip().split('\n'):
            if not line: continue
            try:
                data = json.loads(line)
                if data.get("class") == "SKY":
                    satellites = data.get("satellites", [])
                elif data.get("class") == "TPV":
                    if "time" in data:
                        gps_time = data.get("time")
                    if "lat" in data and "lon" in data:
                        receiver_lat = data["lat"]
                        receiver_lon = data["lon"]
            except Exception: pass

    result = {"satellites": satellites, "gps_time": gps_time}
    if receiver_lat is not None:
        result["receiver_lat"] = round(receiver_lat, 6)
        result["receiver_lon"] = round(receiver_lon, 6)
    return jsonify(result)

@app.route('/api/config', methods=['GET', 'POST'])
def config_endpoint():
    if request.method == 'POST':
        ALLOWED_KEYS = {'mode', 'host', 'user', 'password', 'auth', 'cesium_token', 'receiver_lat', 'receiver_lon'}
        new_conf = {k: v for k, v in (request.json or {}).items() if k in ALLOWED_KEYS}
        old_conf = load_config()

        if not new_conf.get('password') and old_conf.get('password'):
            new_conf['password'] = old_conf['password']
        elif new_conf.get('password'):
            new_conf['password'] = encrypt_pwd(new_conf['password'])

        # Encrypt cesium token if changed
        if not new_conf.get('cesium_token') and old_conf.get('cesium_token'):
            new_conf['cesium_token'] = old_conf['cesium_token']
        elif new_conf.get('cesium_token'):
            new_conf['cesium_token'] = encrypt_pwd(new_conf['cesium_token'])

        # Merge into existing config to preserve fields not sent by frontend
        old_conf.update(new_conf)
        save_config(old_conf)
        return jsonify({"status": "success"})

    conf = load_config()
    conf['password'] = ""
    # Decrypt token — mask in response, show only last 4 chars
    raw_token = decrypt_pwd(conf.get('cesium_token', ''))
    conf['cesium_token'] = ('*' * (len(raw_token) - 4) + raw_token[-4:]) if len(raw_token) > 4 else raw_token
    conf['has_cesium_token'] = bool(raw_token)
    conf['has_ssh_key'] = find_ssh_key() is not None
    # Only return whitelisted keys
    allowed = {'mode', 'host', 'user', 'password', 'auth', 'cesium_token', 'has_cesium_token',
               'has_ssh_key', 'receiver_lat', 'receiver_lon'}
    return jsonify({k: v for k, v in conf.items() if k in allowed})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=55234)
