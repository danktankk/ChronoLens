// ── NTP Ground Station — Visualization Engine v2.1 ──
// Data-driven canvas visualizations for chrony + GPS monitoring
// Each viz: draw(ctx, w, h, t, sats, ntpData, TC)

var VizEngine = (function() {

    // ── Utilities ──
    function rgb(c, a) { return 'rgba('+c[0]+','+c[1]+','+c[2]+','+(a!=null?a:1)+')'; }
    function lerp(a,b,t) { return a+(b-a)*t; }
    function clamp(v,lo,hi) { return Math.max(lo,Math.min(hi,v)); }
    function safeNum(v) { return (typeof v === 'number' && !isNaN(v)) ? v : 0; }
    function safeSat(s) { return { PRN: s.PRN, az: safeNum(s.az), el: safeNum(s.el), ss: safeNum(s.ss), used: !!s.used }; }
    function safeSats(sats) { return (sats||[]).map(safeSat); }

    // Check if an NTP source name is active (synced or candidate)
    function isSourceActive(name, sources) {
        for (var j = 0; j < sources.length; j++) {
            if (sources[j].name === name && (sources[j].state.includes('*') || sources[j].state.includes('+'))) {
                return true;
            }
        }
        return false;
    }

    // Draw a satellite dot with optional glow, pulse ring, and PRN label
    // Options: { fontSize: 8, labelOffsetX: 6, labelOffsetY: 3 }
    function drawSatDot(ctx, x, y, sat, t, i, TC, opts) {
        var col = sat.used ? TC.locked : TC.dim;
        var sz = sat.used ? (opts && opts.size || 4) : (opts && opts.sizeInactive || 2.5);
        var pulse = sat.used ? (1 + (opts && opts.pulseAmp || 0.3) * Math.sin(t * 0.003 + i * (opts && opts.pulseSpread || 1))) : 1;
        var fs = (opts && opts.fontSize) || 8;

        if (sat.used) {
            var glow = ctx.createRadialGradient(x, y, 0, x, y, sz * 3);
            glow.addColorStop(0, rgb(col, 0.15));
            glow.addColorStop(1, 'transparent');
            ctx.fillStyle = glow;
            ctx.fillRect(x - sz * 3, y - sz * 3, sz * 6, sz * 6);
        }
        ctx.beginPath(); ctx.arc(x, y, sz * pulse, 0, Math.PI * 2);
        ctx.fillStyle = rgb(col, sat.used ? 1 : 0.5); ctx.fill();

        ctx.font = (sat.used ? '600 ' : '400 ') + fs + 'px IBM Plex Mono, monospace';
        ctx.fillStyle = rgb(sat.used ? TC.label : TC.labelDim, sat.used ? 0.9 : 0.7);
        ctx.textAlign = 'left';
        ctx.fillText(sat.PRN, x + (opts && opts.labelOffsetX || sz + 4), y + (opts && opts.labelOffsetY || 3));
    }

    // Plot a time-series line from a data array with current-value dot
    // dataFn(entry, index) returns the Y value; returns the last plotted {x, y} or null
    function plotTimeSeries(ctx, data, maxLen, pad, gw, gh, rangeFn, dataFn, color, TC) {
        ctx.beginPath();
        var lastPt = null;
        var hasData = false;
        for (var i = 0; i < data.length; i++) {
            var val = dataFn(data[i], i);
            if (val == null) continue;
            var x = pad + (i / (maxLen - 1)) * gw;
            var y = rangeFn(val);
            if (!hasData) { ctx.moveTo(x, y); hasData = true; }
            else ctx.lineTo(x, y);
            lastPt = { x: x, y: y };
        }
        if (hasData) {
            ctx.strokeStyle = rgb(color, 0.8); ctx.lineWidth = 1.5; ctx.stroke();
        }
        return lastPt;
    }

    // Draw a glowing dot at a point (used for current-value markers on time series)
    function drawGlowDot(ctx, x, y, color, TC) {
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = rgb(color, 1); ctx.fill();
        var pg = ctx.createRadialGradient(x, y, 0, x, y, 12);
        pg.addColorStop(0, rgb(color, 0.3)); pg.addColorStop(1, 'transparent');
        ctx.fillStyle = pg; ctx.fillRect(x - 12, y - 12, 24, 24);
    }

    // Rolling history buffers
    var MAX_HISTORY = 300;
    var freqHistory = [];
    var trackingHistory = [];
    var MAX_TRACKING = 200;

    function pushTracking(tracking) {
        if (!tracking || tracking.error) return;
        var entry = { t: Date.now() };
        if (tracking.system_time != null) entry.offset = tracking.system_time * 1e9; // nanoseconds
        if (tracking.last_offset != null) entry.lastOffset = tracking.last_offset * 1e9;
        if (tracking.rms_offset != null) entry.rms = tracking.rms_offset * 1e9;
        if (tracking.frequency != null) entry.freq = tracking.frequency;
        if (tracking.skew != null) entry.skew = tracking.skew;
        if (tracking.root_delay != null) entry.rootDelay = tracking.root_delay * 1e6;
        if (tracking.root_dispersion != null) entry.rootDisp = tracking.root_dispersion * 1e6;
        trackingHistory.push(entry);
        if (trackingHistory.length > MAX_TRACKING) trackingHistory.shift();
        if (entry.freq != null) {
            freqHistory.push({ t: entry.t, v: entry.freq });
            if (freqHistory.length > MAX_HISTORY) freqHistory.shift();
        }
    }

    // ── Shared drawing helpers ──
    function drawFrame(ctx, x, y, w, h, TC) {
        ctx.strokeStyle = rgb(TC.wire, 0.12); ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
    }
    function drawGrid(ctx, x, y, w, h, cols, rows, TC) {
        ctx.strokeStyle = rgb(TC.wire, 0.04); ctx.lineWidth = 0.5;
        ctx.setLineDash([2,4]);
        for (var i = 1; i < cols; i++) {
            var gx = x + w * i / cols;
            ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y+h); ctx.stroke();
        }
        for (var i = 1; i < rows; i++) {
            var gy = y + h * i / rows;
            ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x+w, gy); ctx.stroke();
        }
        ctx.setLineDash([]);
    }
    function drawEmpty(ctx, w, h, TC, msg) {
        ctx.font = '500 11px IBM Plex Mono, monospace';
        ctx.fillStyle = rgb(TC.labelDim, 0.7); ctx.textAlign = 'center';
        ctx.fillText(msg || 'NO DATA', w/2, h/2);
    }
    function formatNano(ns) {
        var abs = Math.abs(ns);
        if (abs < 1000) return ns.toFixed(1) + ' ns';
        if (abs < 1e6) return (ns/1000).toFixed(2) + ' \u00b5s';
        return (ns/1e6).toFixed(3) + ' ms';
    }
    function formatMicro(us) {
        var abs = Math.abs(us);
        if (abs < 1) return (us*1000).toFixed(1) + ' ns';
        if (abs < 1000) return us.toFixed(2) + ' \u00b5s';
        return (us/1000).toFixed(3) + ' ms';
    }

    // ═══════════════════════════════════════════════════════
    // 1. SIGNAL SKYLINE — SNR bars per satellite
    // ═══════════════════════════════════════════════════════
    function drawSkyline(ctx, w, h, t, sats, ntpData, TC) {
        sats = safeSats(sats); ctx.clearRect(0,0,w,h);
        if (!sats.length) { drawEmpty(ctx,w,h,TC,'AWAITING SATELLITES'); return; }

        var n = sats.length;
        var barW = Math.max(8, (w - 40) / n - 4), gap = 4;
        var totalW = n * (barW + gap) - gap;
        var startX = (w - totalW) / 2;
        var maxH = h - 60, groundY = h - 30;

        // Ground + glow
        ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(w, groundY);
        ctx.strokeStyle = rgb(TC.wire, 0.15); ctx.lineWidth = 1; ctx.stroke();
        var hg = ctx.createLinearGradient(0, groundY, 0, groundY - 40);
        hg.addColorStop(0, rgb(TC.wire, 0.06)); hg.addColorStop(1, 'transparent');
        ctx.fillStyle = hg; ctx.fillRect(0, groundY - 40, w, 40);

        for (var i = 0; i < n; i++) {
            var s = sats[i], snr = s.ss, barH = (snr / 55) * maxH;
            var x = startX + i * (barW + gap), y = groundY - barH;
            var col = s.used ? TC.locked : TC.dim;

            if (s.used) {
                var glow = ctx.createLinearGradient(x, y, x, groundY);
                glow.addColorStop(0, rgb(col, 0.3)); glow.addColorStop(1, rgb(col, 0.02));
                ctx.fillStyle = glow; ctx.fillRect(x - 2, y, barW + 4, barH);
            }
            var bg = ctx.createLinearGradient(x, y, x, groundY);
            bg.addColorStop(0, rgb(col, s.used ? 0.9 : 0.4));
            bg.addColorStop(1, rgb(col, s.used ? 0.3 : 0.1));
            ctx.fillStyle = bg; ctx.fillRect(x, y, barW, barH);

            var pulse = s.used ? (1 + 0.3 * Math.sin(t * 0.004 + i)) : 1;
            ctx.fillStyle = rgb(col, s.used ? 0.9 * pulse : 0.3);
            ctx.fillRect(x, y, barW, 2);

            ctx.font = '600 9px IBM Plex Mono, monospace';
            ctx.fillStyle = rgb(TC.label, s.used ? 0.7 : 0.3);
            ctx.textAlign = 'center';
            ctx.fillText(s.PRN, x + barW/2, groundY + 12);
            if (barH > 20) {
                ctx.font = '500 8px IBM Plex Mono, monospace';
                ctx.fillStyle = rgb(TC.label, 0.8);
                ctx.fillText(snr.toFixed(0), x + barW/2, y - 6);
            }
        }
    }

    // ═══════════════════════════════════════════════════════
    // 2. POLAR HEATMAP — Signal coverage heat map
    // ═══════════════════════════════════════════════════════
    function drawHeatmap(ctx, w, h, t, sats, ntpData, TC) {
        sats = safeSats(sats); ctx.clearRect(0,0,w,h);
        var cx = w/2, cy = h/2, r = Math.min(w,h)/2 - 25;

        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
        ctx.fillStyle = rgb(TC.wire, 0.02); ctx.fill();
        ctx.strokeStyle = rgb(TC.wire, 0.15); ctx.lineWidth = 1; ctx.stroke();

        for (var ring = 1; ring <= 3; ring++) {
            ctx.beginPath(); ctx.arc(cx, cy, r * ring / 3, 0, Math.PI*2);
            ctx.strokeStyle = rgb(TC.wire, 0.06); ctx.lineWidth = 0.5;
            ctx.setLineDash([2,4]); ctx.stroke(); ctx.setLineDash([]);
        }

        for (var i = 0; i < sats.length; i++) {
            var s = sats[i];
            var elR = r * (90 - s.el) / 90, azR = s.az * Math.PI / 180;
            var sx = cx + elR * Math.sin(azR), sy = cy - elR * Math.cos(azR);
            var intensity = clamp(s.ss / 50, 0, 1), blobR = 20 + intensity * 30;
            var hg = ctx.createRadialGradient(sx, sy, 0, sx, sy, blobR);
            var col = s.used ? TC.locked : TC.dim;
            hg.addColorStop(0, rgb(col, (s.used ? 0.4 : 0.2) * intensity));
            hg.addColorStop(0.5, rgb(col, (s.used ? 0.1 : 0.05) * intensity));
            hg.addColorStop(1, 'transparent');
            ctx.fillStyle = hg; ctx.fillRect(sx - blobR, sy - blobR, blobR*2, blobR*2);
        }
        for (var i = 0; i < sats.length; i++) {
            var s = sats[i];
            var elR = r * (90 - s.el) / 90, azR = s.az * Math.PI / 180;
            var sx = cx + elR * Math.sin(azR), sy = cy - elR * Math.cos(azR);
            drawSatDot(ctx, sx, sy, s, t, i, TC, { labelOffsetX: 7 });
        }
        ctx.font = '500 10px IBM Plex Mono, monospace';
        ctx.fillStyle = rgb(TC.label, 0.7); ctx.textAlign = 'center';
        ctx.fillText('N', cx, cy-r-8); ctx.fillText('S', cx, cy+r+14);
        ctx.fillText('E', cx+r+12, cy+4); ctx.fillText('W', cx-r-12, cy+4);
    }

    // ═══════════════════════════════════════════════════════
    // 3. DRIFT TIMELINE — System offset over time
    // ═══════════════════════════════════════════════════════
    function drawTimeline(ctx, w, h, t, sats, ntpData, TC) {
        ctx.clearRect(0,0,w,h);
        var pad = 45, gw = w - pad*2, gh = h - pad*2, cy = pad + gh/2;

        drawFrame(ctx, pad, pad, gw, gh, TC);
        drawGrid(ctx, pad, pad, gw, gh, 8, 4, TC);

        // Zero line
        ctx.beginPath(); ctx.moveTo(pad, cy); ctx.lineTo(pad+gw, cy);
        ctx.strokeStyle = rgb(TC.center, 0.2); ctx.lineWidth = 1; ctx.stroke();

        var data = trackingHistory.length >= 2 ? trackingHistory : null;
        if (!data) {
            ctx.font = '500 10px IBM Plex Mono, monospace';
            ctx.fillStyle = rgb(TC.label, 0.7); ctx.textAlign = 'center';
            ctx.fillText('COLLECTING OFFSET DATA...', w/2, h/2);
            ctx.fillText('(updates every 2s)', w/2, h/2 + 16);
            return;
        }

        // Plot system offset (nanoseconds)
        var vals = data.map(function(d) { return d.offset || 0; });
        var minV = Math.min.apply(null, vals), maxV = Math.max.apply(null, vals);
        var range = Math.max(Math.abs(minV), Math.abs(maxV), 0.1) * 1.3;

        // Offset line
        function offsetToY(val) { return cy - (val / range) * (gh / 2); }
        var lastPt = plotTimeSeries(ctx, data, MAX_TRACKING, pad, gw, gh, offsetToY,
            function(d) { return d.offset || 0; }, TC.locked, TC);

        // RMS band if available
        if (data[0].rms != null) {
            ctx.beginPath();
            for (var i = 0; i < data.length; i++) {
                var x = pad + (i / (MAX_TRACKING - 1)) * gw;
                var rms = (data[i].rms || 0);
                if (i === 0) ctx.moveTo(x, offsetToY(rms)); else ctx.lineTo(x, offsetToY(rms));
            }
            for (var i = data.length - 1; i >= 0; i--) {
                var x = pad + (i / (MAX_TRACKING - 1)) * gw;
                ctx.lineTo(x, offsetToY(-(data[i].rms || 0)));
            }
            ctx.closePath();
            ctx.fillStyle = rgb(TC.center, 0.06); ctx.fill();
        }

        // Current value marker
        if (lastPt) drawGlowDot(ctx, lastPt.x, lastPt.y, TC.center, TC);
        var last = data[data.length - 1];

        // Labels
        ctx.font = '500 8px IBM Plex Mono, monospace';
        ctx.fillStyle = rgb(TC.label, 0.7); ctx.textAlign = 'left';
        ctx.fillText('SYSTEM OFFSET', pad, pad - 8);
        ctx.textAlign = 'right';
        ctx.fillText('+' + formatNano(range), pad - 4, pad + 8);
        ctx.fillText('-' + formatNano(range), pad - 4, pad + gh);
        ctx.fillText('0', pad - 4, cy + 3);
        // Current value
        ctx.fillStyle = rgb(TC.locked, 0.7); ctx.textAlign = 'right';
        ctx.fillText('NOW: ' + formatNano(last.offset || 0), pad + gw, pad - 8);
    }

    // ═══════════════════════════════════════════════════════
    // 4. CHRONY DASHBOARD — All tracking metrics as instruments
    // ═══════════════════════════════════════════════════════
    function drawChronyDash(ctx, w, h, t, sats, ntpData, TC) {
        ctx.clearRect(0,0,w,h);
        var tracking = (ntpData && ntpData.tracking) || {};
        if (!tracking.ref_name && !tracking.stratum) {
            drawEmpty(ctx, w, h, TC, 'AWAITING CHRONY DATA'); return;
        }

        var pad = 10, cellW = (w - pad*3) / 2, cellH = (h - pad*2 - pad*5) / 6;

        var metrics = [
            { label: 'REFERENCE', value: tracking.ref_name || tracking.ref_id || '—', color: TC.center },
            { label: 'STRATUM', value: (tracking.stratum != null ? tracking.stratum : '—').toString(), color: TC.locked },
            { label: 'SYSTEM OFFSET', value: tracking.system_time_str || '—', color: TC.locked,
              numVal: tracking.system_time != null ? tracking.system_time * 1e9 : null, unit: 'ns' },
            { label: 'LAST OFFSET', value: tracking.last_offset_str || '—', color: TC.wire,
              numVal: tracking.last_offset != null ? tracking.last_offset * 1e9 : null, unit: 'ns' },
            { label: 'RMS OFFSET', value: tracking.rms_offset_str || '—', color: TC.wire,
              numVal: tracking.rms_offset != null ? tracking.rms_offset * 1e9 : null, unit: 'ns' },
            { label: 'FREQUENCY', value: tracking.frequency_str || '—', color: TC.center,
              numVal: tracking.frequency, unit: 'ppm' },
            { label: 'RESIDUAL FREQ', value: tracking.residual_freq_str || '—', color: TC.dim },
            { label: 'SKEW', value: tracking.skew_str || '—', color: TC.dim,
              numVal: tracking.skew, unit: 'ppm' },
            { label: 'ROOT DELAY', value: tracking.root_delay_str || '—', color: TC.wire,
              numVal: tracking.root_delay != null ? tracking.root_delay * 1e6 : null, unit: '\u00b5s' },
            { label: 'ROOT DISPERSION', value: tracking.root_dispersion_str || '—', color: TC.wire,
              numVal: tracking.root_dispersion != null ? tracking.root_dispersion * 1e6 : null, unit: '\u00b5s' },
            { label: 'UPDATE INTERVAL', value: tracking.update_interval_str || '—', color: TC.dim },
            { label: 'LEAP STATUS', value: tracking.leap_status || '—',
              color: tracking.leap_status === 'Normal' ? TC.locked : TC.center },
        ];

        var cols = 2, rows = 6;
        for (var i = 0; i < metrics.length; i++) {
            var m = metrics[i];
            var col = i % cols, row = Math.floor(i / cols);
            var x = pad + col * (cellW + pad), y = pad + row * (cellH + pad);

            // Cell background
            ctx.fillStyle = rgb(TC.wire, 0.05);
            ctx.fillRect(x, y, cellW, cellH);
            ctx.strokeStyle = rgb(TC.wire, 0.12);
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, cellW, cellH);

            // Label — bigger, brighter
            ctx.font = '600 9px IBM Plex Mono, monospace';
            ctx.fillStyle = rgb(TC.label, 0.8); ctx.textAlign = 'left';
            ctx.fillText(m.label, x + 8, y + 15);

            // Value — much bigger
            var displayVal = m.value;
            if (m.numVal != null) {
                if (m.unit === 'ns') displayVal = formatNano(m.numVal);
                else if (m.unit === '\u00b5s') displayVal = formatMicro(m.numVal);
                else displayVal = m.numVal.toFixed(3) + ' ' + m.unit;
            }
            ctx.font = '700 15px IBM Plex Mono, monospace';
            ctx.fillStyle = rgb(m.color, 1);
            ctx.fillText(displayVal.substring(0, 24), x + 8, y + cellH - 7);

            // Accent line at top
            ctx.fillStyle = rgb(m.color, 0.5);
            ctx.fillRect(x, y, cellW, 2);
        }
    }

    // ═══════════════════════════════════════════════════════
    // 5. SOURCE COMPARISON — Offset + jitter per source
    // ═══════════════════════════════════════════════════════
    function drawSourceCompare(ctx, w, h, t, sats, ntpData, TC) {
        ctx.clearRect(0,0,w,h);
        var stats = (ntpData && ntpData.sourcestats) || [];
        var sources = (ntpData && ntpData.sources) || [];
        if (!stats.length) { drawEmpty(ctx, w, h, TC, 'AWAITING SOURCE STATS'); return; }

        var pad = 40, gw = w - pad*2, gh = h - pad - 25;
        var n = stats.length;
        var barW = Math.max(12, gw / n - 8), gap = 8;
        var totalW = n * (barW + gap) - gap;
        var startX = pad + (gw - totalW) / 2;

        // Find max offset for scale
        var maxOff = 1;
        for (var i = 0; i < stats.length; i++) {
            maxOff = Math.max(maxOff, Math.abs(stats[i].offset_us), stats[i].std_dev_us);
        }
        maxOff *= 1.3;

        var baseY = pad + gh / 2;

        // Zero line
        ctx.beginPath(); ctx.moveTo(pad, baseY); ctx.lineTo(pad+gw, baseY);
        ctx.strokeStyle = rgb(TC.wire, 0.15); ctx.lineWidth = 1; ctx.stroke();

        drawGrid(ctx, pad, pad, gw, gh, n, 4, TC);

        for (var i = 0; i < stats.length; i++) {
            var st = stats[i];
            var x = startX + i * (barW + gap);
            var offsetPx = (st.offset_us / maxOff) * (gh / 2);
            var jitterPx = (st.std_dev_us / maxOff) * (gh / 2);

            var isActive = isSourceActive(st.name, sources);
            var col = isActive ? TC.locked : TC.wire;

            // Jitter band (std dev)
            ctx.fillStyle = rgb(col, 0.12);
            ctx.fillRect(x - 2, baseY - jitterPx, barW + 4, jitterPx * 2);

            // Offset bar
            var barTop = offsetPx > 0 ? baseY - offsetPx : baseY;
            var barHeight = Math.abs(offsetPx);
            var bg = ctx.createLinearGradient(x, barTop, x, barTop + barHeight);
            bg.addColorStop(0, rgb(col, 0.8)); bg.addColorStop(1, rgb(col, 0.3));
            ctx.fillStyle = bg;
            ctx.fillRect(x, barTop, barW, barHeight);

            // Active glow
            if (isActive) {
                ctx.fillStyle = rgb(col, 0.15);
                ctx.fillRect(x - 3, barTop - 2, barW + 6, barHeight + 4);
            }

            // Name label
            ctx.save();
            ctx.translate(x + barW/2, pad + gh + 5);
            ctx.rotate(-0.5);
            ctx.font = '500 9px IBM Plex Mono, monospace';
            ctx.fillStyle = rgb(isActive ? TC.label : TC.labelDim, isActive ? 0.9 : 0.7);
            ctx.textAlign = 'left';
            var shortName = st.name.length > 12 ? st.name.substring(0, 11) + '\u2026' : st.name;
            ctx.fillText(shortName, 0, 0);
            ctx.restore();

            // Offset value
            ctx.font = '500 9px IBM Plex Mono, monospace';
            ctx.fillStyle = rgb(TC.label, 0.75); ctx.textAlign = 'center';
            var valY = offsetPx > 0 ? barTop - 5 : barTop + barHeight + 10;
            ctx.fillText(st.offset, x + barW/2, valY);
        }

        // Scale labels
        ctx.font = '400 9px IBM Plex Mono, monospace';
        ctx.fillStyle = rgb(TC.labelDim, 0.7); ctx.textAlign = 'right';
        ctx.fillText('+' + formatMicro(maxOff), pad - 4, pad + 8);
        ctx.fillText('-' + formatMicro(maxOff), pad - 4, pad + gh);
        ctx.fillText('0', pad - 4, baseY + 3);

        ctx.textAlign = 'left';
        ctx.fillStyle = rgb(TC.label, 0.7);
        ctx.font = '500 8px IBM Plex Mono, monospace';
        ctx.fillText('SOURCE OFFSETS  (\u00b1 std dev shaded)', pad, pad - 8);
    }

    // ═══════════════════════════════════════════════════════
    // 6. FREQUENCY DRIFT — ppm frequency over time
    // ═══════════════════════════════════════════════════════
    function drawFreqDrift(ctx, w, h, t, sats, ntpData, TC) {
        ctx.clearRect(0,0,w,h);
        var pad = 45, gw = w - pad*2, gh = h - pad*2;

        drawFrame(ctx, pad, pad, gw, gh, TC);
        drawGrid(ctx, pad, pad, gw, gh, 8, 4, TC);

        if (freqHistory.length < 2) {
            ctx.font = '500 10px IBM Plex Mono, monospace';
            ctx.fillStyle = rgb(TC.label, 0.7); ctx.textAlign = 'center';
            ctx.fillText('COLLECTING FREQUENCY DATA...', w/2, h/2);
            return;
        }

        var minV = Infinity, maxV = -Infinity;
        for (var i = 0; i < freqHistory.length; i++) {
            minV = Math.min(minV, freqHistory[i].v);
            maxV = Math.max(maxV, freqHistory[i].v);
        }
        // Ensure some visible range
        if (maxV - minV < 0.001) { minV -= 0.01; maxV += 0.01; }
        var range = (maxV - minV) * 1.2;
        var midV = (maxV + minV) / 2;

        // Line + fill
        ctx.beginPath();
        for (var i = 0; i < freqHistory.length; i++) {
            var x = pad + (i / (MAX_HISTORY - 1)) * gw;
            var y = pad + gh/2 - ((freqHistory[i].v - midV) / range) * gh;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = rgb(TC.center, 0.8); ctx.lineWidth = 1.5; ctx.stroke();

        // Fill under line
        var lastX = pad + ((freqHistory.length - 1) / (MAX_HISTORY - 1)) * gw;
        var midY = pad + gh/2;
        ctx.lineTo(lastX, midY); ctx.lineTo(pad, midY); ctx.closePath();
        ctx.fillStyle = rgb(TC.center, 0.06); ctx.fill();

        // Current dot
        var last = freqHistory[freqHistory.length - 1];
        var ly = pad + gh/2 - ((last.v - midV) / range) * gh;
        drawGlowDot(ctx, lastX, ly, TC.center, TC);

        ctx.font = '500 8px IBM Plex Mono, monospace';
        ctx.fillStyle = rgb(TC.label, 0.7); ctx.textAlign = 'left';
        ctx.fillText('FREQUENCY DRIFT (ppm)', pad, pad - 8);
        ctx.textAlign = 'right';
        ctx.fillStyle = rgb(TC.center, 0.7);
        ctx.fillText('NOW: ' + last.v.toFixed(3) + ' ppm', pad + gw, pad - 8);
        ctx.fillStyle = rgb(TC.labelDim, 0.7);
        ctx.fillText((midV + range/2).toFixed(3) + ' ppm', pad - 4, pad + 8);
        ctx.fillText((midV - range/2).toFixed(3) + ' ppm', pad - 4, pad + gh);
    }

    // ═══════════════════════════════════════════════════════
    // 7. REACH PATTERN — Binary reach visualization per source
    // ═══════════════════════════════════════════════════════
    function drawReachPattern(ctx, w, h, t, sats, ntpData, TC) {
        ctx.clearRect(0,0,w,h);
        var sources = (ntpData && ntpData.sources) || [];
        if (!sources.length) { drawEmpty(ctx, w, h, TC, 'AWAITING SOURCES'); return; }

        var pad = 15, rowH = Math.min(40, (h - pad*2) / sources.length);
        var bitW = Math.min(30, (w - pad*2 - 140) / 8);
        var startX = pad + 110;

        // Header
        ctx.font = '500 8px IBM Plex Mono, monospace';
        ctx.fillStyle = rgb(TC.label, 0.7); ctx.textAlign = 'left';
        ctx.fillText('SOURCE', pad, pad + 10);
        ctx.textAlign = 'center';
        for (var b = 0; b < 8; b++) {
            ctx.fillText((7 - b).toString(), startX + b * bitW + bitW/2, pad + 10);
        }
        ctx.fillText('RCH', startX + 8 * bitW + 20, pad + 10);

        for (var i = 0; i < sources.length; i++) {
            var src = sources[i];
            var y = pad + 20 + i * rowH;
            var isActive = src.state && (src.state.includes('*') || src.state.includes('+'));

            // Parse reach (octal string to number)
            var reach = parseInt(src.reach, 8) || 0;

            // Source name
            ctx.font = (isActive ? '600 ' : '400 ') + '9px IBM Plex Mono, monospace';
            ctx.fillStyle = rgb(isActive ? TC.locked : TC.labelDim, isActive ? 0.9 : 0.7);
            ctx.textAlign = 'left';
            var name = src.name.length > 14 ? src.name.substring(0, 13) + '\u2026' : src.name;
            ctx.fillText(src.state + ' ' + name, pad, y + rowH/2 + 3);

            // Bit cells
            for (var b = 0; b < 8; b++) {
                var bit = (reach >> (7 - b)) & 1;
                var bx = startX + b * bitW, by = y + 4;
                var bh = rowH - 8, bw = bitW - 3;

                if (bit) {
                    var col = isActive ? TC.locked : TC.wire;
                    ctx.fillStyle = rgb(col, 0.7);
                    ctx.fillRect(bx, by, bw, bh);
                    // Glow
                    ctx.fillStyle = rgb(col, 0.1);
                    ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
                } else {
                    ctx.fillStyle = rgb(TC.dim, 0.08);
                    ctx.fillRect(bx, by, bw, bh);
                    // X mark for missed
                    ctx.strokeStyle = rgb(TC.dim, 0.15);
                    ctx.lineWidth = 0.5;
                    ctx.beginPath(); ctx.moveTo(bx+3, by+3); ctx.lineTo(bx+bw-3, by+bh-3); ctx.stroke();
                    ctx.beginPath(); ctx.moveTo(bx+bw-3, by+3); ctx.lineTo(bx+3, by+bh-3); ctx.stroke();
                }
            }

            // Reach fraction
            var count = 0;
            for (var b = 0; b < 8; b++) { if ((reach >> b) & 1) count++; }
            ctx.font = '600 9px IBM Plex Mono, monospace';
            ctx.fillStyle = rgb(count === 8 ? TC.locked : count > 4 ? TC.wire : TC.dim, 0.7);
            ctx.textAlign = 'center';
            ctx.fillText(count + '/8', startX + 8 * bitW + 20, y + rowH/2 + 3);
        }
    }

    // ═══════════════════════════════════════════════════════
    // 8. ROOT METRICS — Delay + dispersion over time
    // ═══════════════════════════════════════════════════════
    function drawRootMetrics(ctx, w, h, t, sats, ntpData, TC) {
        ctx.clearRect(0,0,w,h);
        var pad = 45, gw = w - pad*2, gh = h - pad*2;

        drawFrame(ctx, pad, pad, gw, gh, TC);
        drawGrid(ctx, pad, pad, gw, gh, 8, 4, TC);

        if (trackingHistory.length < 2) {
            drawEmpty(ctx, w, h, TC, 'COLLECTING ROOT METRICS...');
            return;
        }

        // Plot both root delay and root dispersion
        var maxVal = 0.01;
        for (var i = 0; i < trackingHistory.length; i++) {
            var d = trackingHistory[i];
            if (d.rootDelay != null) maxVal = Math.max(maxVal, d.rootDelay);
            if (d.rootDisp != null) maxVal = Math.max(maxVal, d.rootDisp);
        }
        maxVal *= 1.3;

        function rootToY(val) { return pad + gh - (val / maxVal) * gh; }

        // Root delay line
        plotTimeSeries(ctx, trackingHistory, MAX_TRACKING, pad, gw, gh, rootToY,
            function(d) { return d.rootDelay; }, TC.locked, TC);

        // Root dispersion line
        plotTimeSeries(ctx, trackingHistory, MAX_TRACKING, pad, gw, gh, rootToY,
            function(d) { return d.rootDisp; }, TC.center, TC);

        // Legend
        ctx.font = '500 8px IBM Plex Mono, monospace';
        ctx.fillStyle = rgb(TC.label, 0.7); ctx.textAlign = 'left';
        ctx.fillText('ROOT METRICS', pad, pad - 8);

        // Legend dots
        ctx.beginPath(); ctx.arc(pad + gw - 120, pad - 11, 3, 0, Math.PI*2);
        ctx.fillStyle = rgb(TC.locked, 0.8); ctx.fill();
        ctx.fillStyle = rgb(TC.label, 0.75);
        ctx.fillText('Delay', pad + gw - 114, pad - 8);

        ctx.beginPath(); ctx.arc(pad + gw - 55, pad - 11, 3, 0, Math.PI*2);
        ctx.fillStyle = rgb(TC.center, 0.8); ctx.fill();
        ctx.fillStyle = rgb(TC.label, 0.75);
        ctx.fillText('Dispersion', pad + gw - 49, pad - 8);

        // Scale
        ctx.font = '400 9px IBM Plex Mono, monospace';
        ctx.fillStyle = rgb(TC.labelDim, 0.7); ctx.textAlign = 'right';
        ctx.fillText(formatMicro(maxVal), pad - 4, pad + 8);
        ctx.fillText('0', pad - 4, pad + gh);
    }

    // ═══════════════════════════════════════════════════════
    // 9. CONSTELLATION WEB — Satellite proximity graph
    // ═══════════════════════════════════════════════════════
    function drawWeb(ctx, w, h, t, sats, ntpData, TC) {
        sats = safeSats(sats); ctx.clearRect(0,0,w,h);
        if (!sats.length) { drawEmpty(ctx,w,h,TC,'NO CONSTELLATION'); return; }

        var cx = w/2, cy = h/2, maxR = Math.min(w,h)/2 - 30;
        var pts = [];
        for (var i = 0; i < sats.length; i++) {
            var s = sats[i];
            var r = maxR * (90 - s.el) / 90;
            var a = s.az * Math.PI / 180;
            var wobble = Math.sin(t * 0.001 + i * 0.5) * 3;
            pts.push({ x: cx + (r+wobble)*Math.sin(a), y: cy - (r+wobble)*Math.cos(a), used: s.used, prn: s.PRN, ss: s.ss });
        }
        for (var i = 0; i < pts.length; i++) {
            for (var j = i+1; j < pts.length; j++) {
                var dx = pts[i].x-pts[j].x, dy = pts[i].y-pts[j].y;
                var dist = Math.sqrt(dx*dx+dy*dy);
                if (dist < maxR*0.8) {
                    var alpha = (1-dist/(maxR*0.8))*0.15;
                    if (pts[i].used && pts[j].used) alpha *= 2;
                    ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y);
                    ctx.strokeStyle = rgb(TC.wire, alpha);
                    ctx.lineWidth = pts[i].used&&pts[j].used ? 1 : 0.5; ctx.stroke();
                }
            }
        }
        for (var i = 0; i < pts.length; i++) {
            var p = pts[i];
            drawSatDot(ctx, p.x, p.y, { used: p.used, PRN: p.prn }, t, i, TC,
                { size: 5, sizeInactive: 3, pulseAmp: 0.4, pulseSpread: 0.8 });
        }
    }

    // ═══════════════════════════════════════════════════════
    // 10. HORIZON SWEEP — Panoramic ground-level view
    // ═══════════════════════════════════════════════════════
    function drawHorizon(ctx, w, h, t, sats, ntpData, TC) {
        sats = safeSats(sats); ctx.clearRect(0,0,w,h);
        var horizonY = h * 0.65, pad = 20;

        var sky = ctx.createLinearGradient(0,0,0,horizonY);
        sky.addColorStop(0, rgb(TC.wire, 0.02)); sky.addColorStop(1, rgb(TC.wire, 0.06));
        ctx.fillStyle = sky; ctx.fillRect(0,0,w,horizonY);
        ctx.fillStyle = rgb(TC.dim, 0.05); ctx.fillRect(0,horizonY,w,h-horizonY);
        ctx.beginPath(); ctx.moveTo(0,horizonY); ctx.lineTo(w,horizonY);
        ctx.strokeStyle = rgb(TC.wire, 0.2); ctx.lineWidth = 1; ctx.stroke();

        var dirs = ['N','NE','E','SE','S','SW','W','NW'];
        ctx.font = '400 8px IBM Plex Mono, monospace';
        ctx.fillStyle = rgb(TC.labelDim, 0.7); ctx.textAlign = 'center';
        for (var i = 0; i < 8; i++) {
            var x = pad + (i/8) * (w-pad*2);
            ctx.fillText(dirs[i], x, horizonY + 15);
            ctx.beginPath(); ctx.moveTo(x,horizonY-3); ctx.lineTo(x,horizonY+3);
            ctx.strokeStyle = rgb(TC.wire, 0.15); ctx.lineWidth = 1; ctx.stroke();
        }
        for (var el = 30; el <= 90; el += 30) {
            var y = horizonY - (el/90)*(horizonY-20);
            ctx.beginPath(); ctx.moveTo(pad,y); ctx.lineTo(w-pad,y);
            ctx.strokeStyle = rgb(TC.wire, 0.04); ctx.lineWidth = 0.5;
            ctx.setLineDash([2,6]); ctx.stroke(); ctx.setLineDash([]);
            ctx.font = '400 9px IBM Plex Mono, monospace';
            ctx.fillStyle = rgb(TC.labelDim, 0.7);
            ctx.textAlign = 'right'; ctx.fillText(el+'\u00b0', pad-4, y+3);
        }
        for (var i = 0; i < sats.length; i++) {
            var s = sats[i];
            var x = pad + (s.az/360)*(w-pad*2);
            var y = horizonY - (s.el/90)*(horizonY-20);
            if (s.used) {
                ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x,horizonY);
                ctx.strokeStyle = rgb(TC.locked, 0.1); ctx.lineWidth = 0.5;
                ctx.setLineDash([2,3]); ctx.stroke(); ctx.setLineDash([]);
            }
            drawSatDot(ctx, x, y, s, t, i, TC, { fontSize: 7, labelOffsetX: 5 });
        }
    }

    // ═══════════════════════════════════════════════════════
    // 11. SIGNAL RADAR — Spider chart of SNR
    // ═══════════════════════════════════════════════════════
    function drawSignalRadar(ctx, w, h, t, sats, ntpData, TC) {
        sats = safeSats(sats); ctx.clearRect(0,0,w,h);
        if (!sats.length) { drawEmpty(ctx,w,h,TC,'NO SIGNAL DATA'); return; }

        var cx = w/2, cy = h/2, maxR = Math.min(w,h)/2 - 30;
        var numAxes = Math.max(sats.length, 3);
        var angleStep = Math.PI * 2 / numAxes;

        for (var ring = 1; ring <= 5; ring++) {
            var r = maxR * ring / 5;
            ctx.beginPath();
            for (var i = 0; i <= numAxes; i++) {
                var a = i * angleStep - Math.PI/2;
                var x = cx + r*Math.cos(a), y = cy + r*Math.sin(a);
                if (i === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
            }
            ctx.closePath();
            ctx.strokeStyle = rgb(TC.wire, 0.06); ctx.lineWidth = 0.5; ctx.stroke();
        }
        for (var i = 0; i < numAxes; i++) {
            var a = i * angleStep - Math.PI/2;
            ctx.beginPath(); ctx.moveTo(cx,cy);
            ctx.lineTo(cx+maxR*Math.cos(a), cy+maxR*Math.sin(a));
            ctx.strokeStyle = rgb(TC.wire, 0.08); ctx.lineWidth = 0.5; ctx.stroke();
        }

        ctx.beginPath();
        for (var i = 0; i < sats.length; i++) {
            var snr = clamp(sats[i].ss/50, 0, 1);
            var a = i * angleStep - Math.PI/2;
            var x = cx + snr*maxR*Math.cos(a), y = cy + snr*maxR*Math.sin(a);
            if (i === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        }
        ctx.closePath();
        ctx.fillStyle = rgb(TC.locked, 0.08); ctx.fill();
        ctx.strokeStyle = rgb(TC.locked, 0.5); ctx.lineWidth = 1.5; ctx.stroke();

        for (var i = 0; i < sats.length; i++) {
            var s = sats[i], snr = clamp(s.ss/50, 0, 1);
            var a = i * angleStep - Math.PI/2;
            var x = cx + snr*maxR*Math.cos(a), y = cy + snr*maxR*Math.sin(a);
            drawSatDot(ctx, x, y, s, t, i, TC, { fontSize: 7 });

            // Axis label at outer edge (centered, not default left-aligned)
            var lx = cx + (maxR+15)*Math.cos(a), ly = cy + (maxR+15)*Math.sin(a);
            ctx.font = (s.used?'600 ':'400 ')+'9px IBM Plex Mono, monospace';
            ctx.fillStyle = rgb(s.used?TC.label:TC.labelDim, s.used?0.9:0.7);
            ctx.textAlign = 'center'; ctx.fillText(s.PRN, lx, ly+3);
        }
    }

    // ═══════════════════════════════════════════════════════
    // 12. STRATUM TREE — NTP hierarchy with data flow
    // ═══════════════════════════════════════════════════════
    function drawTree(ctx, w, h, t, sats, ntpData, TC) {
        ctx.clearRect(0,0,w,h);
        var cx = w/2, cy = h/2;
        var sources = (ntpData && ntpData.sources) || [];

        // Center node
        ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI*2);
        ctx.fillStyle = rgb(TC.center, 0.15); ctx.fill();
        ctx.strokeStyle = rgb(TC.center, 0.5); ctx.lineWidth = 2; ctx.stroke();
        ctx.font = '700 9px IBM Plex Mono, monospace';
        ctx.fillStyle = rgb(TC.center, 0.8); ctx.textAlign = 'center';
        ctx.fillText('LOCAL', cx, cy + 3);

        var tracking = (ntpData && ntpData.tracking) || {};
        if (tracking.stratum != null) {
            ctx.font = '400 9px IBM Plex Mono, monospace';
            ctx.fillStyle = rgb(TC.center, 0.5);
            ctx.fillText('STR ' + tracking.stratum, cx, cy + 22);
        }

        var maxStrat = 4;
        for (var s = 1; s <= maxStrat; s++) {
            var r = s * 55;
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
            ctx.strokeStyle = rgb(TC.wire, 0.06); ctx.lineWidth = 0.5;
            ctx.setLineDash([3,6]); ctx.stroke(); ctx.setLineDash([]);
            ctx.font = '400 9px IBM Plex Mono, monospace';
            ctx.fillStyle = rgb(TC.labelDim, 0.7); ctx.textAlign = 'left';
            ctx.fillText('STR '+s, cx+r+5, cy);
        }

        if (sources.length) {
            var angleStep = Math.PI * 2 / sources.length;
            for (var i = 0; i < sources.length; i++) {
                var src = sources[i];
                var strat = parseInt(src.stratum) || 2;
                var r = Math.min(strat, maxStrat) * 55;
                var angle = i * angleStep - Math.PI/2 + Math.sin(t*0.0003)*0.1;
                var nx = cx + r*Math.cos(angle), ny = cy + r*Math.sin(angle);
                var isActive = src.state && (src.state.includes('*') || src.state.includes('+'));

                ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(nx,ny);
                ctx.strokeStyle = rgb(isActive?TC.locked:TC.dim, isActive?0.3:0.08);
                ctx.lineWidth = isActive?1.5:0.5; ctx.stroke();

                if (isActive) {
                    var pulsePos = ((t*0.001)%1);
                    var px = lerp(cx,nx,pulsePos), py = lerp(cy,ny,pulsePos);
                    ctx.beginPath(); ctx.arc(px,py,2,0,Math.PI*2);
                    ctx.fillStyle = rgb(TC.locked,0.6); ctx.fill();
                }

                var col = isActive ? TC.locked : TC.dim;
                if (isActive) {
                    var glow = ctx.createRadialGradient(nx,ny,0,nx,ny,18);
                    glow.addColorStop(0, rgb(col,0.15)); glow.addColorStop(1,'transparent');
                    ctx.fillStyle = glow; ctx.fillRect(nx-18,ny-18,36,36);
                }
                ctx.beginPath(); ctx.arc(nx,ny,isActive?8:5,0,Math.PI*2);
                ctx.fillStyle = rgb(col,0.1); ctx.fill();
                ctx.strokeStyle = rgb(col,isActive?0.6:0.2); ctx.lineWidth = 1.5; ctx.stroke();

                ctx.font = (isActive?'600 ':'400 ')+'8px IBM Plex Mono, monospace';
                ctx.fillStyle = rgb(isActive?TC.label:TC.labelDim,isActive?0.7:0.35);
                ctx.textAlign = 'center';
                var sname = src.name.length > 16 ? src.name.substring(0,15)+'\u2026' : src.name;
                ctx.fillText(sname, nx, ny+18);
                // State badge
                ctx.font = '600 9px IBM Plex Mono, monospace';
                ctx.fillText(src.state, nx, ny + 3);
            }
        }
    }

    // ═══════════════════════════════════════════════════════
    // 13. SOURCE JITTER — Std deviation comparison
    // ═══════════════════════════════════════════════════════
    function drawSourceJitter(ctx, w, h, t, sats, ntpData, TC) {
        ctx.clearRect(0,0,w,h);
        var stats = (ntpData && ntpData.sourcestats) || [];
        var sources = (ntpData && ntpData.sources) || [];
        if (!stats.length) { drawEmpty(ctx, w, h, TC, 'AWAITING SOURCE STATS'); return; }

        var pad = 15, rowH = Math.min(45, (h - pad*2 - 20) / stats.length);
        var barAreaW = w - pad*2 - 140;

        var maxDev = 0.01;
        for (var i = 0; i < stats.length; i++) {
            maxDev = Math.max(maxDev, stats[i].std_dev_us);
        }
        maxDev *= 1.2;

        // Header
        ctx.font = '500 8px IBM Plex Mono, monospace';
        ctx.fillStyle = rgb(TC.label, 0.7); ctx.textAlign = 'left';
        ctx.fillText('SOURCE JITTER (std dev)', pad, pad + 10);

        for (var i = 0; i < stats.length; i++) {
            var st = stats[i];
            var y = pad + 20 + i * rowH;
            var barW = (st.std_dev_us / maxDev) * barAreaW;

            var isActive = isSourceActive(st.name, sources);
            var col = isActive ? TC.locked : TC.wire;

            // Name
            ctx.font = (isActive?'600 ':'400 ')+'9px IBM Plex Mono, monospace';
            ctx.fillStyle = rgb(isActive?TC.label:TC.labelDim, isActive?0.8:0.5);
            ctx.textAlign = 'left';
            var name = st.name.length > 14 ? st.name.substring(0,13)+'\u2026' : st.name;
            ctx.fillText(name, pad, y + rowH/2 + 3);

            // Bar
            var bx = pad + 120;
            var bg = ctx.createLinearGradient(bx, y+4, bx+barW, y+4);
            bg.addColorStop(0, rgb(col, 0.7)); bg.addColorStop(1, rgb(col, 0.2));
            ctx.fillStyle = bg;
            ctx.fillRect(bx, y + 6, barW, rowH - 12);

            // Glow for active
            if (isActive) {
                ctx.fillStyle = rgb(col, 0.08);
                ctx.fillRect(bx - 2, y + 4, barW + 4, rowH - 8);
            }

            // Value label
            ctx.font = '500 8px IBM Plex Mono, monospace';
            ctx.fillStyle = rgb(TC.label, 0.8); ctx.textAlign = 'left';
            ctx.fillText(st.std_dev, bx + barW + 8, y + rowH/2 + 3);

            // Sample count
            ctx.font = '400 9px IBM Plex Mono, monospace';
            ctx.fillStyle = rgb(TC.labelDim, 0.7); ctx.textAlign = 'right';
            ctx.fillText(st.np + ' samples', w - pad, y + rowH/2 + 3);
        }
    }

    // ═══════════════════════════════════════════════════════
    // PLANET EARTH — COBE WebGL globe (loaded from CDN)
    // ═══════════════════════════════════════════════════════

    var cobeInstance = null;
    var cobeCanvas = null;
    var cobeLoaded = false;
    var cobeLoading = false;
    var cobePhi = 4.45; // start facing Florida
    var cobeMarkers = [];
    var cobeThemeKey = '';

    function loadCobe(callback) {
        if (cobeLoaded) { callback(); return; }
        if (cobeLoading) return;
        cobeLoading = true;
        import('https://esm.sh/cobe@0.6.3').then(function(mod) {
            window.__createGlobe = mod.default;
            cobeLoaded = true;
            cobeLoading = false;
            callback();
        }).catch(function(err) {
            console.error('COBE load failed:', err);
            cobeLoading = false;
        });
    }

    function initCobe(canvas, w, h, TC) {
        if (cobeInstance) { cobeInstance.destroy(); cobeInstance = null; }
        if (!window.__createGlobe) return;

        // Bright label text = dark background theme
        var isDark = (TC.label[0] + TC.label[1] + TC.label[2]) > 250;

        // Rich theme-aware colors
        var baseColor = isDark
            ? [TC.wire[0]/255*0.25, TC.wire[1]/255*0.25, TC.wire[2]/255*0.3]
            : [0.9, 0.92, 0.95];
        var glowColor = [TC.wire[0]/255, TC.wire[1]/255, TC.wire[2]/255];
        var markerCol = [TC.locked[0]/255, TC.locked[1]/255, TC.locked[2]/255];

        var dpr = window.devicePixelRatio || 1;
        var size = Math.min(w, h);
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        canvas.style.width = size + 'px';
        canvas.style.height = size + 'px';

        // Start facing Florida (~82°W longitude)
        cobePhi = 4.45;

        cobeInstance = window.__createGlobe(canvas, {
            devicePixelRatio: dpr,
            width: size * dpr,
            height: size * dpr,
            phi: cobePhi,
            theta: 0.2,
            dark: isDark ? 1 : 0,
            diffuse: 1.4,
            mapSamples: 24000,
            mapBrightness: isDark ? 10 : 3,
            baseColor: baseColor,
            markerColor: markerCol,
            glowColor: glowColor,
            scale: 1.05,
            markers: cobeMarkers,
            markerElevation: 0.04,
            onRender: function(state) {
                state.phi = cobePhi;
                cobePhi += 0.003;
                state.markers = cobeMarkers;
            }
        });
        cobeCanvas = canvas;
    }

    function initPlanet(canvas, w, h, sats, ntpData, TC) {
        sats = safeSats(sats);

        // Always update markers from latest satellite data
        cobeMarkers = [];
        for (var i = 0; i < sats.length; i++) {
            var s = sats[i];
            if (s.el > 0 || s.az > 0) {
                var lat = 29.5 + (s.el - 45) * 0.5 + Math.sin(s.az * 0.017) * 20;
                var lon = -82.5 + (s.az - 180) * 0.3;
                cobeMarkers.push({
                    location: [lat, lon],
                    size: s.used ? 0.12 : 0.05
                });
            }
        }

        // Detect theme change (include all colors — label affects dark/light detection)
        var themeKey = TC.wire.join(',') + '|' + TC.locked.join(',') + '|' + TC.label.join(',') + '|' + TC.dim.join(',');
        var themeChanged = themeKey !== cobeThemeKey;

        if (!cobeLoaded) {
            loadCobe(function() { initCobe(canvas, w, h, TC); cobeThemeKey = themeKey; });
            return;
        }

        // Recreate if canvas changed or theme changed
        if (!cobeInstance || cobeCanvas !== canvas || themeChanged) {
            initCobe(canvas, w, h, TC);
            cobeThemeKey = themeKey;
        }
        // markers update via onRender callback automatically
    }

    // Keep drawPlanetEarth as a no-op for registry (actual work done via initPlanet)
    function drawPlanetEarth() {}

    // Cleanup function for when switching away from planet view
    function destroyCobe() {
        if (cobeInstance) { cobeInstance.destroy(); cobeInstance = null; cobeCanvas = null; }
    }

    // ═══════════════════════════════════════════════════════
    // REGISTRY
    // ═══════════════════════════════════════════════════════
    var registry = {
        'globe':          { name: '3D Globe',           category: 'GPS', draw: null, desc: 'Rotating 3D wireframe globe with satellites on orbital rings. Uses GPS azimuth/elevation data.' },
        'planet':         { name: 'Planet Earth',       category: 'GPS', draw: drawPlanetEarth, desc: 'Full-color rotating Earth with continents, oceans, atmosphere glow, and GPS satellites in orbit.' },
        'radar':          { name: 'Radar Scope',        category: 'GPS', draw: null, desc: 'Classic radar sweep showing satellite positions by azimuth and elevation from GPS receiver.' },
        'skyline':        { name: 'Signal Skyline',     category: 'GPS', draw: drawSkyline, desc: 'SNR bar chart per satellite. Taller bars = stronger signal. Green = locked/used.' },
        'heatmap':        { name: 'Polar Heatmap',      category: 'GPS', draw: drawHeatmap, desc: 'Polar plot with signal strength heat blobs. Shows coverage gaps in the sky.' },
        'web':            { name: 'Constellation Web',  category: 'GPS', draw: drawWeb, desc: 'Proximity graph connecting nearby satellites. Reveals constellation geometry.' },
        'horizon':        { name: 'Horizon Sweep',      category: 'GPS', draw: drawHorizon, desc: 'Panoramic horizon view of all satellites by compass bearing and elevation angle.' },
        'signal-radar':   { name: 'Signal Radar',       category: 'GPS', draw: drawSignalRadar, desc: 'Spider/radar chart of SNR values. Each axis is one satellite.' },
        'chrony-dash':    { name: 'Chrony Dashboard',   category: 'NTP', draw: drawChronyDash, desc: 'All chrony tracking metrics as instrument cells: offset, frequency, stratum, skew, root delay.' },
        'timeline':       { name: 'Offset Timeline',    category: 'NTP', draw: drawTimeline, desc: 'System clock offset over time with RMS band. Shows how well the clock is disciplined.' },
        'freq-drift':     { name: 'Frequency Drift',    category: 'NTP', draw: drawFreqDrift, desc: 'Clock frequency error (ppm) over time. Tracks oscillator stability.' },
        'source-compare': { name: 'Source Offsets',     category: 'NTP', draw: drawSourceCompare, desc: 'Offset and standard deviation per NTP source. Compare source quality side by side.' },
        'source-jitter':  { name: 'Source Jitter',      category: 'NTP', draw: drawSourceJitter, desc: 'Horizontal bars showing jitter (std dev) per source with sample counts.' },
        'reach-pattern':  { name: 'Reach Pattern',      category: 'NTP', draw: drawReachPattern, desc: 'Binary reach register per source. 8 bits showing recent poll success/failure.' },
        'root-metrics':   { name: 'Root Metrics',       category: 'NTP', draw: drawRootMetrics, desc: 'Root delay and root dispersion over time. Measures path quality to stratum 1.' },
        'tree':           { name: 'Stratum Tree',       category: 'NTP', draw: drawTree, desc: 'NTP hierarchy diagram showing stratum layers and active source connections.' },
    };

    return {
        registry: registry,
        pushTracking: pushTracking,
        initPlanet: initPlanet,
        destroyCobe: destroyCobe,
        rgb: rgb
    };
})();
