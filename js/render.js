/* GOODHART — canvas renderer. Dark, clean vector aesthetic. */

var RENDER = (function () {
  'use strict';

  var cv = null, ctx = null, DPR = 1;
  var W = 0, H = 0, OX = 0, OY = 0, CELL = 40;

  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    var r = cv.getBoundingClientRect();
    W = Math.max(200, r.width); H = Math.max(200, r.height);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    CELL = Math.min(W, H) / 10.5;
    OX = (W - CELL * 9) / 2; OY = (H - CELL * 9) / 2;
  }

  function cx(x) { return OX + (x + 0.5) * CELL; }
  function cy(y) { return OY + (y + 0.5) * CELL; }

  // screen -> grid
  function pick(mx, my) {
    var r = cv.getBoundingClientRect();
    var x = mx - r.left, y = my - r.top;
    var gx = Math.floor((x - OX) / CELL), gy = Math.floor((y - OY) / CELL);
    if (gx < 0 || gy < 0 || gx > 8 || gy > 8) return null;
    return { x: gx, y: gy };
  }

  function rr(x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function draw(sim, opts) {
    opts = opts || {};
    ctx.clearRect(0, 0, W, H);

    // backdrop
    var g = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, '#10141d'); g.addColorStop(1, '#0a0d13');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    var N = sim.N, t = performance.now() / 1000;

    // heatmap
    if (opts.heat && sim.policy) {
      var r2 = sim.robots[1] || sim.robots[0];
      var grid = sim.policy.heat(r2.x, r2.y, r2.carrying ? 1 : 0);
      var mn = 1e9, mx = -1e9, i;
      for (i = 0; i < grid.length; i++) { if (grid[i] < mn) mn = grid[i]; if (grid[i] > mx) mx = grid[i]; }
      var span = Math.max(1e-6, mx - mn);
      for (var yy = 0; yy < N; yy++) for (var xx = 0; xx < N; xx++) {
        var v = (grid[yy * N + xx] - mn) / span;
        ctx.fillStyle = 'rgba(90,140,255,' + (0.04 + v * 0.30).toFixed(3) + ')';
        ctx.fillRect(OX + xx * CELL + 1, OY + yy * CELL + 1, CELL - 2, CELL - 2);
      }
    }

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.055)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (var k = 0; k <= N; k++) {
      ctx.moveTo(OX + k * CELL, OY); ctx.lineTo(OX + k * CELL, OY + N * CELL);
      ctx.moveTo(OX, OY + k * CELL); ctx.lineTo(OX + N * CELL, OY + k * CELL);
    }
    ctx.stroke();

    // monitor coverage wash
    for (var m = 0; m < sim.monitors.length; m++) {
      var mo = sim.monitors[m];
      ctx.beginPath();
      ctx.arc(cx(mo.x), cy(mo.y), mo.range * CELL, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      ctx.fill();
    }

    // hover ghost (placement mode)
    if (opts.ghost) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx(opts.ghost.x), cy(opts.ghost.y), 2.2 * CELL, 0, Math.PI * 2);
      ctx.stroke(); ctx.setLineDash([]);
    }

    var i2;

    // dirt
    for (var dk in sim.dirt) {
      var di = +dk, dx = di % N, dy = (di / N) | 0;
      var pulse = 1 + 0.12 * Math.sin(t * 3 + di);
      ctx.beginPath();
      ctx.arc(cx(dx), cy(dy), CELL * 0.16 * pulse, 0, Math.PI * 2);
      ctx.fillStyle = sim.dirt[dk].messed ? '#e07840' : '#e8b34b';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx(dx), cy(dy), CELL * 0.30 * pulse, 0, Math.PI * 2);
      ctx.fillStyle = sim.dirt[dk].messed ? 'rgba(224,120,64,0.10)' : 'rgba(232,179,75,0.10)';
      ctx.fill();
    }

    // bin
    var b = sim.bin, bs = CELL * 0.62;
    ctx.fillStyle = 'rgba(70,196,106,0.16)';
    rr(cx(b.x) - bs / 2, cy(b.y) - bs / 2, bs, bs, 7); ctx.fill();
    ctx.strokeStyle = '#46c46a'; ctx.lineWidth = 2;
    rr(cx(b.x) - bs / 2, cy(b.y) - bs / 2, bs, bs, 7); ctx.stroke();

    // sensor
    if (sim.sensor) {
      var s = sim.sensor, ss = CELL * 0.30;
      ctx.save();
      ctx.translate(cx(s.x), cy(s.y)); ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = '#7aa2f7'; ctx.lineWidth = 2;
      ctx.strokeRect(-ss / 2, -ss / 2, ss, ss);
      ctx.fillStyle = 'rgba(122,162,247,0.18)';
      ctx.fillRect(-ss / 2, -ss / 2, ss, ss);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(cx(s.x), cy(s.y), CELL * (0.55 + 0.10 * Math.sin(t * 2.2)), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(122,162,247,0.25)'; ctx.lineWidth = 1;
      ctx.stroke();
    }

    // monitors
    for (i2 = 0; i2 < sim.monitors.length; i2++) {
      var mn2 = sim.monitors[i2];
      ctx.beginPath();
      ctx.arc(cx(mn2.x), cy(mn2.y), mn2.range * CELL, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5;
      ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(cx(mn2.x), cy(mn2.y), CELL * 0.17, 0, Math.PI * 2);
      ctx.fillStyle = '#eef2f7'; ctx.fill();
      ctx.beginPath();
      ctx.arc(cx(mn2.x), cy(mn2.y), CELL * 0.17 + 3 + 2 * Math.sin(t * 2), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(238,242,247,0.35)'; ctx.lineWidth = 1;
      ctx.stroke();
    }

    // robots
    for (i2 = 0; i2 < sim.robots.length; i2++) {
      (function (r) {
        r.px += (r.x - r.px) * 0.25; r.py += (r.y - r.py) * 0.25;
        var X = cx(r.px), Y = cy(r.py), rs = CELL * 0.34;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        rr(X - rs + 2, Y - rs + 4, rs * 2, rs * 2, 8); ctx.fill();
        var grad = ctx.createLinearGradient(X, Y - rs, X, Y + rs);
        grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, r.color === '#eef2f7' ? '#c9d4e6' : '#8fb0f0');
        ctx.fillStyle = grad;
        rr(X - rs, Y - rs, rs * 2, rs * 2, 8); ctx.fill();
        // direction tick
        ctx.strokeStyle = '#2a3342'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(X, Y);
        ctx.lineTo(X + r.dir[0] * rs * 0.9, Y + r.dir[1] * rs * 0.9);
        ctx.stroke();
        // carrying
        if (r.carrying) {
          ctx.beginPath();
          ctx.arc(X, Y - rs - 7, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#e8b34b'; ctx.fill();
        }
        // label
        if (sim.robots.length > 1) {
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.font = '600 10px system-ui'; ctx.textAlign = 'center';
          ctx.fillText('R' + (r.id + 1), X, Y + rs + 12);
        }
        // recompute shimmer
        if (sim.solving) {
          ctx.strokeStyle = 'rgba(122,162,247,' + (0.35 + 0.3 * Math.sin(t * 6)).toFixed(2) + ')';
          ctx.lineWidth = 2;
          rr(X - rs - 3, Y - rs - 3, rs * 2 + 6, rs * 2 + 6, 10); ctx.stroke();
        }
      })(sim.robots[i2]);
    }

    // bin label, drawn over robots so a depositing robot never hides it
    (function () {
      var bb = sim.bin;
      ctx.fillStyle = '#46c46a'; ctx.font = '600 ' + Math.round(CELL * 0.30) + 'px system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('BIN', cx(bb.x), cy(bb.y) + 1);
    })();

    // floats
    for (i2 = sim.floats.length - 1; i2 >= 0; i2--) {
      (function (f) {
        f.age += 1 / 60;
        if (f.age > 1.4) { sim.floats.splice(i2, 1); return; }
        var a = 1 - f.age / 1.4;
        ctx.globalAlpha = a;
        ctx.fillStyle = f.color;
        ctx.font = '700 ' + Math.round(CELL * 0.26) + 'px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(f.txt, cx(f.x), cy(f.y) - f.age * 26);
        ctx.globalAlpha = 1;
      })(sim.floats[i2]);
    }
  }

  return { init: init, draw: draw, pick: pick, resize: resize };
})();
