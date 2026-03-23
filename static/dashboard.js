// ── ChronoLens Dashboard v0.5.0 ──
// Theme-aware canvas globe + radar

// ═══════════════════════════════════════════
// 1. THEME ENGINE
// ═══════════════════════════════════════════
var THEMES = {
    'ground-station': {
        wire: [34, 211, 238],       // cyan
        locked: [52, 211, 153],     // green
        dim: [132, 148, 167],       // grey — boosted
        sweep: [34, 211, 238],
        center: [245, 166, 35],     // amber
        label: [226, 232, 240],
        labelDim: [140, 156, 179],
    },
    'daylight': {
        wire: [20, 64, 110],
        locked: [18, 107, 62],
        dim: [100, 100, 116],
        sweep: [20, 64, 110],
        center: [168, 78, 0],
        label: [17, 17, 32],
        labelDim: [80, 80, 96],
    },
    'phosphor': {
        wire: [0, 255, 65],
        locked: [0, 255, 65],
        dim: [0, 144, 38],
        sweep: [0, 255, 65],
        center: [0, 255, 65],
        label: [0, 220, 56],
        labelDim: [0, 150, 42],
    },
    'solar': {
        wire: [212, 160, 18],
        locked: [212, 160, 18],
        dim: [160, 130, 90],
        sweep: [232, 106, 32],
        center: [232, 106, 32],
        label: [232, 213, 184],
        labelDim: [160, 130, 90],
    },
    'arctic': {
        wire: [32, 96, 160],
        locked: [26, 114, 72],
        dim: [64, 88, 108],
        sweep: [32, 96, 160],
        center: [14, 110, 126],
        label: [14, 30, 48],
        labelDim: [64, 88, 108],
    },
    'amber-terminal': {
        wire: [255, 176, 0],
        locked: [255, 176, 0],
        dim: [178, 120, 0],
        sweep: [255, 176, 0],
        center: [255, 176, 0],
        label: [238, 170, 0],
        labelDim: [178, 120, 0],
    },
    'deep-space': {
        wire: [167, 139, 250],
        locked: [110, 231, 183],
        dim: [120, 112, 140],
        sweep: [167, 139, 250],
        center: [244, 114, 182],
        label: [224, 220, 232],
        labelDim: [120, 112, 140],
    }
};

var currentTheme = 'ground-station';
var TC = THEMES[currentTheme]; // theme colors shorthand

// Use VizEngine.rgb as the single source of truth
var rgb = VizEngine.rgb;

function setTheme(name) {
    if (!THEMES[name]) return;
    currentTheme = name;
    TC = THEMES[name];
    document.documentElement.setAttribute('data-theme', name);
    localStorage.setItem('chronolens-theme', name);

    // Update swatch active states
    var swatches = document.querySelectorAll('.theme-swatch');
    for (var i = 0; i < swatches.length; i++) {
        swatches[i].classList.toggle('active', swatches[i].getAttribute('data-theme') === name);
    }
}

// Init theme from localStorage
(function() {
    var saved = localStorage.getItem('chronolens-theme');
    if (saved && THEMES[saved]) setTheme(saved);
})();

// Swatch click handlers
document.getElementById('themePicker').addEventListener('click', function(e) {
    var swatch = e.target.closest('.theme-swatch');
    if (swatch) setTheme(swatch.getAttribute('data-theme'));
});

// ═══════════════════════════════════════════
// 2. MODAL CONTROLS
// ═══════════════════════════════════════════
var modal = document.getElementById('settingsModal');
function openSettings() { modal.classList.add('open'); }
function closeSettings() { modal.classList.remove('open'); }
function toggleRemote() {
    var isLocal = document.getElementById('mode').value === 'local';
    document.getElementById('remoteFields').style.display = isLocal ? 'none' : 'block';
    if (!isLocal) toggleAuthFields();
}
function toggleAuthFields() {
    var isKey = document.getElementById('auth').value === 'key';
    document.getElementById('passwordFields').style.display = isKey ? 'none' : 'block';
    document.getElementById('keyStatus').style.display = isKey ? 'block' : 'none';
}
modal.addEventListener('click', function(e) { if (e.target === modal) closeSettings(); });
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeSettings(); });

// ═══════════════════════════════════════════
// 3. CLOCKS
// ═══════════════════════════════════════════
var baseGpsTimeMs = null, fetchLocalTimeMs = null;

function formatLocalTime(d) {
    var h = d.getHours(), ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return d.toLocaleDateString() + ', ' + h + ':' +
        String(d.getMinutes()).padStart(2,'0') + ':' +
        String(d.getSeconds()).padStart(2,'0') + '.' +
        String(d.getMilliseconds()).padStart(3,'0') + ' ' + ap;
}

function formatUTC(d) {
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0') + '-' +
        String(d.getUTCDate()).padStart(2,'0') + '  ' +
        String(d.getUTCHours()).padStart(2,'0') + ':' +
        String(d.getUTCMinutes()).padStart(2,'0') + ':' +
        String(d.getUTCSeconds()).padStart(2,'0') + '.' +
        String(d.getUTCMilliseconds()).padStart(3,'0') + ' UTC';
}

function updateClocks() {
    var now = new Date();
    document.getElementById('localTimeDisplay').textContent = formatLocalTime(now);
    if (baseGpsTimeMs !== null) {
        document.getElementById('gpsTimeDisplay').textContent =
            formatUTC(new Date(baseGpsTimeMs + (now.getTime() - fetchLocalTimeMs)));
    }
}
setInterval(updateClocks, 80);

// ═══════════════════════════════════════════
// 4. CONFIG UI
// ═══════════════════════════════════════════
async function loadUI() {
    try {
        var res = await fetch('/api/config');
        var conf = await res.json();
        document.getElementById('mode').value = conf.mode || 'local';
        document.getElementById('host').value = conf.host || '';
        document.getElementById('user').value = conf.user || '';
        document.getElementById('auth').value = conf.auth || 'key';
        var ki = document.getElementById('keyIndicator');
        ki.innerHTML = conf.has_ssh_key
            ? '<span style="color:var(--accent-3);">&#10003;</span> SSH key detected'
            : '<span style="color:var(--accent-bad);">&#10007;</span> No key — mount at /app/ssh/';
        document.getElementById('connMode').textContent = conf.mode === 'local'
            ? 'Local System (Docker Host)'
            : 'SSH \u2192 ' + (conf.host || '???') + ' (' + (conf.auth === 'password' ? 'password' : 'key') + ')';
        toggleRemote();
        // Cesium fields — show placeholder if token is set but masked
        document.getElementById('cesiumToken').value = '';
        document.getElementById('cesiumToken').placeholder = conf.has_cesium_token ? '(token set — enter new to replace)' : 'Paste Cesium Ion token';
        document.getElementById('receiverLat').value = conf.receiver_lat || '';
        document.getElementById('receiverLon').value = conf.receiver_lon || '';
        // Load auto-cycle setting
        var cycleEl = document.getElementById('cycleInterval');
        if (cycleEl) cycleEl.value = parseInt(localStorage.getItem('chronolens-cycle-interval')) || 0;
    } catch (e) { console.error('Config load error', e); }
}

document.getElementById('configForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    var latVal = parseFloat(document.getElementById('receiverLat').value);
    var lonVal = parseFloat(document.getElementById('receiverLon').value);
    var payload = {
        mode: document.getElementById('mode').value,
        host: document.getElementById('host').value,
        user: document.getElementById('user').value,
        auth: document.getElementById('auth').value,
        password: document.getElementById('password').value,
        receiver_lat: isNaN(latVal) ? '' : latVal,
        receiver_lon: isNaN(lonVal) ? '' : lonVal
    };
    var ct = document.getElementById('cesiumToken').value;
    if (ct) payload.cesium_token = ct;  // only send if user entered a new one
    await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    closeSettings(); loadUI(); fetchNTP(); fetchGPS();
});

// ═══════════════════════════════════════════
// 4b. AUTO-DETECT RECEIVER LOCATION
// ═══════════════════════════════════════════
async function autoDetectLocation() {
    var statusEl = document.getElementById('locationStatus');
    statusEl.style.color = 'var(--accent-1)';
    statusEl.textContent = 'Querying GPS receiver...';

    try {
        var res = await fetch('/api/gps');
        var d = await res.json();

        if (d.receiver_lat != null && d.receiver_lon != null) {
            document.getElementById('receiverLat').value = d.receiver_lat;
            document.getElementById('receiverLon').value = d.receiver_lon;
            statusEl.style.color = 'var(--accent-3)';
            statusEl.textContent = 'Location detected: ' + d.receiver_lat + ', ' + d.receiver_lon;
        } else {
            statusEl.style.color = 'var(--accent-bad)';
            statusEl.textContent = 'GPS receiver did not return position. Make sure the NTP server is connected and GPS has a fix.';
        }
    } catch (e) {
        statusEl.style.color = 'var(--accent-bad)';
        statusEl.textContent = 'Failed to reach GPS API. Connect to the NTP server first (set Target Mode above).';
    }
}

// ═══════════════════════════════════════════
// 5. CANVAS SETUP
// ═══════════════════════════════════════════
var globeCanvas = document.getElementById('globeCanvas');
var gCtx = globeCanvas.getContext('2d');
var GW = 420, GH = 420;
var globeRotY = 0;
var globeTilt = -0.35;
var currentSats = [];

var radarCanvas = document.getElementById('radarCanvas');
var rCtx = radarCanvas.getContext('2d');
var RW = 420, RH = 420;

// DPR scaling
(function() {
    var dpr = window.devicePixelRatio || 1;
    globeCanvas.width = GW * dpr; globeCanvas.height = GH * dpr;
    globeCanvas.style.width = GW + 'px'; globeCanvas.style.height = GH + 'px';
    gCtx.scale(dpr, dpr);
    radarCanvas.width = RW * dpr; radarCanvas.height = RH * dpr;
    radarCanvas.style.width = RW + 'px'; radarCanvas.style.height = RH + 'px';
    rCtx.scale(dpr, dpr);
})();

// Fade canvases in after parent panel animations complete
(function() {
    var panels = document.querySelectorAll('.viz-panel.animate-in');
    var pending = panels.length;
    function reveal() {
        if (--pending > 0) return;
        globeCanvas.style.opacity = '1';
        radarCanvas.style.opacity = '1';
    }
    for (var i = 0; i < panels.length; i++) {
        panels[i].addEventListener('animationend', reveal, { once: true });
    }
    // Safety fallback in case animationend doesn't fire
    setTimeout(function() {
        globeCanvas.style.opacity = '1';
        radarCanvas.style.opacity = '1';
    }, 3500);
})();

// ═══════════════════════════════════════════
// 6. 3D GLOBE
// ═══════════════════════════════════════════
function rotX(p, a) { var c=Math.cos(a), s=Math.sin(a); return [p[0], p[1]*c-p[2]*s, p[1]*s+p[2]*c]; }
function rotY(p, a) { var c=Math.cos(a), s=Math.sin(a); return [p[0]*c+p[2]*s, p[1], -p[0]*s+p[2]*c]; }
function project(p, cx, cy) { var d=600, sc=d/(d+p[2]); return {x:cx+p[0]*sc, y:cy+p[1]*sc, z:p[2], s:sc}; }
function ll2xyz(la, lo, r) {
    var a=la*Math.PI/180, b=lo*Math.PI/180;
    return [r*Math.cos(a)*Math.sin(b), -r*Math.sin(a), r*Math.cos(a)*Math.cos(b)];
}

// Draw a wireframe arc on the globe, handling front/back face breaks
function drawGlobeArc(ctx, points, gcx, gcy, angle, frontAlpha, backAlpha, lineW) {
    ctx.beginPath(); var first = true;
    for (var i = 0; i < points.length; i++) {
        var p = points[i];
        p = rotX(p, globeTilt); p = rotY(p, angle);
        var pp = project(p, gcx, gcy);
        if (p[2] > 0) {
            if (first) { ctx.moveTo(pp.x, pp.y); first = false; }
            else ctx.lineTo(pp.x, pp.y);
        } else {
            ctx.strokeStyle = rgb(TC.wire, backAlpha); ctx.lineWidth = 0.5; ctx.stroke();
            ctx.beginPath(); first = true;
        }
    }
    ctx.strokeStyle = rgb(TC.wire, frontAlpha); ctx.lineWidth = lineW; ctx.stroke();
}

function drawGlobe(ctx, cw, ch, t) {
    var gcx = cw/2, gcy = ch/2, gr = Math.min(cw, ch)/2 - 35;
    ctx.clearRect(0, 0, cw, ch);
    var angle = globeRotY + t * 0.0001;

    // Atmosphere glow
    var glow = ctx.createRadialGradient(gcx, gcy, gr*0.9, gcx, gcy, gr*1.3);
    glow.addColorStop(0, rgb(TC.wire, 0.04));
    glow.addColorStop(1, rgb(TC.wire, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, cw, ch);

    // Outer rings
    ctx.beginPath(); ctx.arc(gcx, gcy, gr+2, 0, Math.PI*2);
    ctx.strokeStyle = rgb(TC.wire, 0.12); ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(gcx, gcy, gr+8, 0, Math.PI*2);
    ctx.strokeStyle = rgb(TC.wire, 0.04); ctx.lineWidth = 1; ctx.stroke();

    // Longitude lines
    for (var lon = -180; lon < 180; lon += 30) {
        var pts = [];
        for (var lat = -90; lat <= 90; lat += 3) pts.push(ll2xyz(lat, lon, gr));
        drawGlobeArc(ctx, pts, gcx, gcy, angle, 0.15, 0.08, 0.5);
    }

    // Latitude lines
    for (var lat = -60; lat <= 60; lat += 30) {
        var pts = [];
        for (var lon2 = 0; lon2 <= 360; lon2 += 3) pts.push(ll2xyz(lat, lon2, gr));
        drawGlobeArc(ctx, pts, gcx, gcy, angle, 0.12, 0.08, 0.5);
    }

    // Equator
    var eqPts = [];
    for (var lon = 0; lon <= 360; lon += 2) eqPts.push(ll2xyz(0, lon, gr));
    drawGlobeArc(ctx, eqPts, gcx, gcy, angle, 0.25, 0.06, 0.8);

    // Orbital rings
    var orbitR = gr * 1.18;
    var oTilts = [0.3, -0.4, 0.15, -0.25, 0.5, -0.1];
    for (var oi = 0; oi < oTilts.length; oi++) {
        ctx.beginPath();
        for (var a = 0; a <= 360; a += 3) {
            var rad = a * Math.PI/180;
            var p = [orbitR*Math.cos(rad), 0, orbitR*Math.sin(rad)];
            p = rotX(p, oTilts[oi]+globeTilt); p = rotY(p, angle+oi*0.5);
            var pp = project(p, gcx, gcy);
            if (a === 0) ctx.moveTo(pp.x, pp.y); else ctx.lineTo(pp.x, pp.y);
        }
        ctx.closePath();
        ctx.strokeStyle = rgb(TC.wire, 0.06); ctx.lineWidth = 0.4; ctx.stroke();
    }

    // Satellites on orbits
    var satsDraw = [];
    for (var i = 0; i < currentSats.length; i++) {
        var sat = currentSats[i];
        var oi = i % oTilts.length;
        var sa = (sat.az||0)*Math.PI/180 + t*0.00015;
        var sr = gr * (1.05 + ((sat.el||45)/90)*0.25);
        var sp = [sr*Math.cos(sa), 0, sr*Math.sin(sa)];
        sp = rotX(sp, oTilts[oi]+globeTilt); sp = rotY(sp, angle+oi*0.5);
        var spp = project(sp, gcx, gcy);
        satsDraw.push({x:spp.x, y:spp.y, z:sp[2], s:spp.s, used:sat.used, prn:sat.PRN, ss:sat.ss||0});
    }
    satsDraw.sort(function(a,b) { return b.z - a.z; });

    for (var i = 0; i < satsDraw.length; i++) {
        var s = satsDraw[i];
        var sz = (s.used ? 4 : 2.5) * s.s;
        var col = s.used ? TC.locked : TC.dim;

        if (s.used) {
            // Glow
            ctx.beginPath(); ctx.arc(s.x, s.y, sz*3, 0, Math.PI*2);
            ctx.fillStyle = rgb(col, 0.08); ctx.fill();
            // Pulse
            var pulse = 1 + 0.5*Math.sin(t*0.003+i);
            ctx.beginPath(); ctx.arc(s.x, s.y, sz*1.8*pulse, 0, Math.PI*2);
            ctx.strokeStyle = rgb(col, 0.3/pulse); ctx.lineWidth = 0.5; ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(s.x, s.y, sz, 0, Math.PI*2);
        ctx.fillStyle = rgb(col, s.used ? 1 : 0.6); ctx.fill();

        if (s.s > 0.7) {
            ctx.font = (s.used ? '600 ' : '400 ') + '9px IBM Plex Mono, monospace';
            ctx.fillStyle = rgb(s.used ? TC.label : TC.labelDim, s.used ? 0.8 : 0.5);
            ctx.textAlign = 'left';
            ctx.fillText(s.prn, s.x+sz+3, s.y+3);
        }
    }

    // Center dot
    var cg = ctx.createRadialGradient(gcx, gcy, 0, gcx, gcy, 8);
    cg.addColorStop(0, rgb(TC.center, 0.3)); cg.addColorStop(1, rgb(TC.center, 0));
    ctx.fillStyle = cg; ctx.fillRect(gcx-8, gcy-8, 16, 16);
    ctx.beginPath(); ctx.arc(gcx, gcy, 2, 0, Math.PI*2);
    ctx.fillStyle = rgb(TC.center, 1); ctx.fill();
}

// ═══════════════════════════════════════════
// 7. RADAR SCOPE
// ═══════════════════════════════════════════
function drawRadar(ctx, cw, ch, t) {
    var rcx = cw/2, rcy = ch/2, rr = Math.min(cw, ch)/2 - 20;
    ctx.clearRect(0, 0, cw, ch);

    // Background
    var bg = ctx.createRadialGradient(rcx, rcy, 0, rcx, rcy, rr);
    bg.addColorStop(0, rgb(TC.wire, 0.03));
    bg.addColorStop(1, 'rgba(0,0,0,0.01)');
    ctx.beginPath(); ctx.arc(rcx, rcy, rr, 0, Math.PI*2);
    ctx.fillStyle = bg; ctx.fill();

    // Outer ring
    ctx.beginPath(); ctx.arc(rcx, rcy, rr, 0, Math.PI*2);
    ctx.strokeStyle = rgb(TC.wire, 0.2); ctx.lineWidth = 1.5; ctx.stroke();

    // Elevation rings
    [rr*2/3, rr/3].forEach(function(r) {
        ctx.beginPath(); ctx.arc(rcx, rcy, r, 0, Math.PI*2);
        ctx.strokeStyle = rgb(TC.wire, 0.07); ctx.lineWidth = 0.5;
        ctx.setLineDash([3,5]); ctx.stroke(); ctx.setLineDash([]);
    });

    // Crosshairs
    for (var ci = 0; ci < 8; ci++) {
        var ca = ci * Math.PI/4;
        ctx.beginPath(); ctx.moveTo(rcx, rcy);
        ctx.lineTo(rcx+rr*Math.sin(ca), rcy-rr*Math.cos(ca));
        ctx.strokeStyle = rgb(TC.wire, 0.08); ctx.lineWidth = 0.5; ctx.stroke();
    }

    // Labels
    ctx.font = '500 10px IBM Plex Mono, monospace';
    ctx.fillStyle = rgb(TC.label, 0.7); ctx.textAlign = 'center';
    ctx.fillText('N', rcx, rcy-rr-8);
    ctx.fillText('S', rcx, rcy+rr+15);
    ctx.fillText('E', rcx+rr+12, rcy+4);
    ctx.fillText('W', rcx-rr-12, rcy+4);

    ctx.font = '400 9px IBM Plex Mono, monospace';
    ctx.fillStyle = rgb(TC.label, 0.5);
    ctx.fillText('30\u00b0', rcx+rr*2/3+2, rcy-4);
    ctx.fillText('60\u00b0', rcx+rr/3+2, rcy-4);

    // Sweep
    var sweepAngle = (t * 0.0008) % (Math.PI*2);
    for (var ti = 0; ti < 20; ti++) {
        var ta = sweepAngle - 0.5*(ti/20);
        ctx.beginPath(); ctx.moveTo(rcx, rcy);
        ctx.arc(rcx, rcy, rr, ta-0.03, ta+0.03); ctx.closePath();
        ctx.fillStyle = rgb(TC.sweep, 0.08*(1-ti/20)); ctx.fill();
    }
    var sx = rcx+rr*Math.sin(sweepAngle), sy = rcy-rr*Math.cos(sweepAngle);
    ctx.beginPath(); ctx.moveTo(rcx, rcy); ctx.lineTo(sx, sy);
    var sg = ctx.createLinearGradient(rcx, rcy, sx, sy);
    sg.addColorStop(0, rgb(TC.sweep, 0.5)); sg.addColorStop(1, rgb(TC.sweep, 0.1));
    ctx.strokeStyle = sg; ctx.lineWidth = 1; ctx.stroke();

    // Satellites
    for (var i = 0; i < currentSats.length; i++) {
        var sat = currentSats[i];
        var elR = rr*(90-(sat.el||0))/90;
        var azR = (sat.az||0)*Math.PI/180;
        var sx = rcx+elR*Math.sin(azR), sy = rcy-elR*Math.cos(azR);
        var col = sat.used ? TC.locked : TC.dim;

        if (sat.used) {
            var gg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 12);
            gg.addColorStop(0, rgb(col, 0.15)); gg.addColorStop(1, rgb(col, 0));
            ctx.fillStyle = gg; ctx.fillRect(sx-12, sy-12, 24, 24);

            var ping = 1+0.6*Math.sin(t*0.003+i*0.7);
            ctx.beginPath(); ctx.arc(sx, sy, 5*ping, 0, Math.PI*2);
            ctx.strokeStyle = rgb(col, 0.25/ping); ctx.lineWidth = 0.6; ctx.stroke();
        }

        ctx.beginPath(); ctx.arc(sx, sy, sat.used?3.5:2, 0, Math.PI*2);
        ctx.fillStyle = rgb(col, sat.used?1:0.5); ctx.fill();

        ctx.font = (sat.used?'600 ':'400 ')+'9px IBM Plex Mono, monospace';
        ctx.fillStyle = rgb(sat.used?TC.label:TC.labelDim, sat.used?0.8:0.7);
        ctx.textAlign = 'left';
        ctx.fillText(sat.PRN, sx+6, sy+3);
    }

    // Center
    ctx.beginPath(); ctx.arc(rcx, rcy, 2.5, 0, Math.PI*2);
    ctx.fillStyle = rgb(TC.sweep, 0.5); ctx.fill();
}

// ═══════════════════════════════════════════
// 8. ANIMATION LOOP + VIZ PICKER
// ═══════════════════════════════════════════
var activeVizLeft = localStorage.getItem('chronolens-viz-left') || 'planet';
var activeVizRight = localStorage.getItem('chronolens-viz-right') || 'radar';
var lastNtpData = {};

// Planet Earth — show/hide dedicated COBE canvases
var cobeLeftCanvas = null;
var cobeRightCanvas = null;
var prevVizLeft = '', prevVizRight = '';

function drawVizOnCanvas(vizKey, ctx, cw, ch, t, side) {
    if (!cobeLeftCanvas) cobeLeftCanvas = document.getElementById('cobeLeft');
    if (!cobeRightCanvas) cobeRightCanvas = document.getElementById('cobeRight');

    var isPlanet = vizKey === 'planet';
    var baseCanvas = side === 'left' ? globeCanvas : radarCanvas;
    var cobeCanvas = side === 'left' ? cobeLeftCanvas : cobeRightCanvas;
    var prevViz = side === 'left' ? prevVizLeft : prevVizRight;

    // Show/hide canvases
    if (isPlanet) {
        baseCanvas.style.display = 'none';
        cobeCanvas.style.display = 'block';
        // Update markers every frame, init globe if needed
        VizEngine.initPlanet(cobeCanvas, cw, ch, currentSats, lastNtpData, TC);
    } else {
        baseCanvas.style.display = 'block';
        cobeCanvas.style.display = 'none';
        // Destroy COBE when switching away
        if (prevViz === 'planet') {
            VizEngine.destroyCobe();
        }
    }

    if (side === 'left') prevVizLeft = vizKey; else prevVizRight = vizKey;

    if (isPlanet) return; // COBE renders itself

    ctx.save();
    try {
        var viz = VizEngine.registry[vizKey];
        if (viz && viz.draw) {
            viz.draw(ctx, cw, ch, t, currentSats, lastNtpData, TC);
        }
    } finally {
        ctx.restore();
    }
}

function animate(t) {
    drawVizOnCanvas(activeVizLeft, gCtx, GW, GH, t, 'left');
    drawVizOnCanvas(activeVizRight, rCtx, RW, RH, t, 'right');
    requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// Viz picker UI
var vizPickerPanel = null; // which panel the modal is picking for

function openVizPicker(panel) {
    vizPickerPanel = panel;
    var modal = document.getElementById('vizPickerModal');
    var container = document.getElementById('vizPickerContent');
    var title = document.getElementById('vizPickerTitle');
    title.textContent = (panel === 'left' ? 'Left' : 'Right') + ' Panel \u2014 Choose Visualization';

    var current = panel === 'left' ? activeVizLeft : activeVizRight;
    var html = '';
    var keys = Object.keys(VizEngine.registry);
    var lastCat = '';
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var v = VizEngine.registry[k];
        if (v.category && v.category !== lastCat) {
            html += '<div class="viz-picker-category">' + v.category + ' Visualizations</div>';
            lastCat = v.category;
        }
        html += '<div class="viz-picker-item' + (k === current ? ' active' : '') +
            '" data-viz="' + k + '" data-panel="' + panel + '">' +
            '<span class="viz-name">' + v.name + '</span>' +
            (v.desc ? '<span class="viz-desc">' + v.desc + '</span>' : '') +
            '</div>';
    }
    container.innerHTML = html;
    modal.classList.add('open');
}

function closeVizPicker() {
    document.getElementById('vizPickerModal').classList.remove('open');
    vizPickerPanel = null;
}

function selectViz(panel, vizKey) {
    if (panel === 'left') {
        activeVizLeft = vizKey;
        localStorage.setItem('chronolens-viz-left', vizKey);
        document.getElementById('vizLeftTitle').textContent = VizEngine.registry[vizKey].name;
        var strip = document.getElementById('satCountStrip');
        if (strip) strip.style.display = (vizKey === 'planet' || vizKey === 'radar') ? 'flex' : 'none';
    } else {
        activeVizRight = vizKey;
        localStorage.setItem('chronolens-viz-right', vizKey);
        document.getElementById('vizRightTitle').textContent = VizEngine.registry[vizKey].name;
    }
    closeVizPicker();
}

// Click handlers for modal
document.addEventListener('click', function(e) {
    var item = e.target.closest('.viz-picker-item');
    if (item) {
        selectViz(item.getAttribute('data-panel'), item.getAttribute('data-viz'));
        return;
    }
    // Close if clicking overlay background
    if (e.target.id === 'vizPickerModal') {
        closeVizPicker();
    }
});
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && document.getElementById('vizPickerModal').classList.contains('open')) {
        closeVizPicker();
    }
});

// Initialize titles from saved state
(function() {
    var regL = VizEngine.registry[activeVizLeft];
    if (regL) document.getElementById('vizLeftTitle').textContent = regL.name;
    var regR = VizEngine.registry[activeVizRight];
    if (regR) document.getElementById('vizRightTitle').textContent = regR.name;
    var strip = document.getElementById('satCountStrip');
    if (strip) strip.style.display = (activeVizLeft === 'planet' || activeVizLeft === 'radar') ? 'flex' : 'none';
})();

// ═══════════════════════════════════════════
// 9. NTP POLLING
// ═══════════════════════════════════════════
function esc(s) { var el=document.createElement('span'); el.textContent=String(s); return el.innerHTML; }

async function fetchNTP() {
    try {
        var res = await fetch('/api/ntp');
        var d = await res.json();
        var oe = document.getElementById('sysOffset');
        var dot = document.getElementById('statusDot');
        if (d.error) {
            oe.textContent = 'Disconnected'; oe.style.color = 'var(--accent-bad)'; oe.className = 'metric-value';
            dot.classList.add('error');
            document.getElementById('ntpTableBody').innerHTML =
                '<tr><td colspan="8" style="padding:1.2rem;color:var(--accent-bad);">' + esc(d.error) + '</td></tr>';
            return;
        }
        dot.classList.remove('error');
        oe.textContent = d.offset || 'Waiting\u2026'; oe.style.color = ''; oe.className = 'metric-value highlight';
        lastNtpData = d;

        // Feed tracking data to VizEngine
        if (d.tracking) {
            VizEngine.pushTracking(d.tracking);
        }

        // Show server stratum badge
        if (d.tracking && d.tracking.stratum != null) {
            document.getElementById('serverStratumBadge').textContent = 'Server Stratum ' + d.tracking.stratum + ' \u00b7 chronyc';
        }

        var TYPE_LABELS = {refclock: '\u2693 Refclock', server: '\u2191 Remote', peer: '\u21c4 Peer', unknown: '? Unknown'};
        var STATE_LABELS = {synced: '\u2713 Synced', combined: '+ Combined', excluded: '\u2212 Excluded',
            unknown: '? Unreach', falseticker: '\u2717 False', variable: '~ Variable'};
        var STATE_COLORS = {synced: 'var(--accent-3)', combined: 'var(--accent-1)', excluded: 'var(--text-tertiary)',
            unknown: 'var(--accent-2)', falseticker: 'var(--accent-bad)', variable: 'var(--accent-2-dim)'};

        document.getElementById('ntpTableBody').innerHTML = (d.sources||[]).map(function(s) {
            var a = s.source_state === 'synced';
            var typeLabel = TYPE_LABELS[s.source_type] || s.source_type;
            var stateLabel = STATE_LABELS[s.source_state] || s.source_state;
            var stateColor = STATE_COLORS[s.source_state] || '';
            return '<tr class="'+(a?'row-active':'')+'">' +
                '<td style="opacity:0.7;font-size:0.8em;">'+esc(typeLabel)+'</td>' +
                '<td>'+esc(s.name)+'</td>' +
                '<td>'+esc(s.stratum)+'</td>' +
                '<td style="color:'+stateColor+'">'+esc(stateLabel)+'</td>' +
                '<td>'+esc(s.poll)+'</td><td>'+esc(s.reach)+'</td>' +
                '<td>'+esc(s.lastrx)+'</td><td>'+esc(s.last_sample)+'</td></tr>';
        }).join('') || '<tr><td colspan="8" style="padding:1.2rem;text-align:center;color:var(--text-tertiary);">No sources</td></tr>';
    } catch(e) { console.error('NTP fail', e); }
}

// ═══════════════════════════════════════════
// 10. GPS POLLING
// ═══════════════════════════════════════════
var sweepTimer = 30;

async function fetchGPS() {
    try {
        var res = await fetch('/api/gps');
        var d = await res.json();

        if (d.gps_time && d.gps_time.includes('T')) {
            var p = new Date(d.gps_time);
            if (!isNaN(p)) { baseGpsTimeMs = p.getTime(); fetchLocalTimeMs = Date.now(); }
        } else {
            baseGpsTimeMs = null;
            document.getElementById('gpsTimeDisplay').textContent = d.gps_time || 'Acquiring lock\u2026';
        }

        currentSats = d.satellites || [];
        var locked = 0, rows = [];
        for (var i = 0; i < currentSats.length; i++) {
            var s = currentSats[i];
            if (s.used) locked++;
            var snr = s.ss||0, pct = Math.min(snr/50*100, 100);
            var sc = snr>30 ? 'var(--accent-3)' : snr>15 ? 'var(--accent-2)' : 'var(--accent-bad)';
            rows.push('<tr><td style="font-weight:600;">PRN '+esc(s.PRN)+'</td><td>'+(s.el!=null?s.el:'\u2014')+'\u00b0</td><td>'+(s.az!=null?s.az:'\u2014')+
                '\u00b0</td><td><span class="snr-bar-bg"><span class="snr-bar-fill" style="width:'+pct+'%;background:'+sc+
                '"></span></span>'+snr+' dB</td><td>'+(s.used?'<span class="sat-status-locked">LOCKED</span>':
                '<span class="sat-status-visible">visible</span>')+'</td></tr>');
        }

        document.getElementById('satTableBody').innerHTML = rows.join('') ||
            '<tr><td colspan="5" style="padding:1.2rem;text-align:center;color:var(--text-tertiary);">Waiting\u2026</td></tr>';
        document.getElementById('satCountNum').textContent = locked;
        var badge = currentSats.length + ' tracked \u00b7 ' + locked + ' locked';
        document.getElementById('satCount').textContent = badge;
        var badgeEl = document.getElementById('satCountBadge');
        if (badgeEl) badgeEl.textContent = badge;
        sweepTimer = 30;
    } catch(e) { console.error('GPS fail', e); }
}

// Sweep bar
setInterval(function() {
    sweepTimer--; if (sweepTimer<0) sweepTimer=0;
    document.getElementById('sweepBar').style.width = ((sweepTimer/30)*100)+'%';
}, 1000);

// ═══════════════════════════════════════════
// 11. AUTO-CYCLE
// ═══════════════════════════════════════════
var autoCycleTimer = null;
var autoCycleInterval = parseInt(localStorage.getItem('chronolens-cycle-interval')) || 0; // 0 = off

function getVizKeys() { return Object.keys(VizEngine.registry); }

function cycleViz(panel) {
    var keys = getVizKeys();
    var current = panel === 'left' ? activeVizLeft : activeVizRight;
    var idx = keys.indexOf(current);
    var next = keys[(idx + 1) % keys.length];

    // Fade out, switch, fade in
    var canvas = panel === 'left' ? globeCanvas : radarCanvas;
    canvas.style.opacity = '0';
    setTimeout(function() {
        selectViz(panel, next);
        canvas.style.opacity = '1';
    }, 1500);
}

var cycleLeftNext = true;
function startAutoCycle() {
    stopAutoCycle();
    if (autoCycleInterval > 0) {
        autoCycleTimer = setInterval(function() {
            cycleViz(cycleLeftNext ? 'left' : 'right');
            cycleLeftNext = !cycleLeftNext;
        }, autoCycleInterval * 1000);
    }
}

function stopAutoCycle() {
    if (autoCycleTimer) { clearInterval(autoCycleTimer); autoCycleTimer = null; }
}

function setAutoCycle(seconds) {
    autoCycleInterval = seconds;
    localStorage.setItem('chronolens-cycle-interval', seconds);
    startAutoCycle();
    // Update UI
    var sel = document.getElementById('cycleInterval');
    if (sel) sel.value = seconds;
}

// ═══════════════════════════════════════════
// 12. INIT
// ═══════════════════════════════════════════
loadUI(); fetchNTP(); fetchGPS();
setInterval(fetchNTP, 2000);
setInterval(fetchGPS, 30000);
startAutoCycle();
