// GOODHART — value iteration over (x, y, carrying) x robots.
// The agent genuinely optimizes the overseer's reward spec; exploits emerge.
// Dirt is folded into the reward field (not the state); we re-solve whenever
// the field, spec, monitors, or bans change. MESS is modeled with an explicit
// world model: scattering creates a dirt tile valued by the current spec.
var MDP = (function () {
  'use strict';
  var GAMMA = 0.96;

  // cfg: {N, dirt:Set(idx), bin:{x,y}, sensor:{x,y}|null, spec, monitors:[{x,y,range}],
  //       banned:{drop,scan,mess}, robots:1|2, messAllowed}
  // spec: {clean,deposit,step,drop,scan,mess,caughtFine}
  function solve(cfg) {
    var N = cfg.N;
    var spec = cfg.spec;
    var banned = cfg.banned || {};
    var dirt = cfg.dirt;
    var monitors = cfg.monitors || [];
    var binX = cfg.bin.x, binY = cfg.bin.y;
    var binI = binY * N + binX;
    var senI = cfg.sensor ? cfg.sensor.y * N + cfg.sensor.x : -1;
    var messAllowed = !!cfg.messAllowed;
    var two = cfg.robots === 2;

    function covered(x, y) {
      for (var i = 0; i < monitors.length; i++) {
        var m = monitors[i], dx = m.x - x, dy = m.y - y;
        if (dx * dx + dy * dy <= m.range * m.range + 1e-9) return true;
      }
      return false;
    }
    // (MESS and DROP price created dirt via the fv continuation, below.)

    var NS1 = N * N * 2;
    function s1(x, y, c) { return (y * N + x) * 2 + c; }
    var actsCache = new Array(NS1);
    var charsCache = new Array(NS1);
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) for (var c = 0; c < 2; c++) {
      (function (x, y, c) {
        var s = s1(x, y, c), idx = y * N + x, list = [];
        function T(a, r, nx, ny, nc) { list.push({ a: a, r: r, ns: s1(nx, ny, nc) }); }
        T('N', spec.step, x, Math.max(0, y - 1), c);
        T('S', spec.step, x, Math.min(N - 1, y + 1), c);
        T('E', spec.step, Math.min(N - 1, x + 1), y, c);
        T('W', spec.step, Math.max(0, x - 1), y, c);
        if (dirt.has(idx) && c === 0) T('clean', spec.clean, x, y, 1);
        if (c === 1 && !banned.drop) {
          // The agent's world model for DROP: scattering creates a dirt tile.
          // If the tile is already dirty the static field covers it; otherwise
          // the continuation value is max(farm value of the new dirt, old field).
          var cov = covered(x, y);
          var dr = spec.drop + (cov ? spec.caughtFine : 0);
          var fv = 0;
          if (!dirt.has(idx)) {
            var farmRate = spec.clean + spec.drop + (cov ? spec.caughtFine : 0);
            if (farmRate > 0) fv = farmRate / (1 - GAMMA * GAMMA);
          }
          list.push({ a: 'drop', r: dr, ns: s1(x, y, 0), fv: fv });
        }
        if (c === 1 && idx === binI) T('deposit', spec.deposit, x, y, 0);
        if (senI >= 0 && idx === senI && !banned.scan) T('scan', spec.scan, x, y, c);
        if (messAllowed && !banned.mess && c === 0 && !dirt.has(idx)) {
          // MESS creates a dirt tile here. Continuation is max(service value
          // of the new dirt, old field) — same pattern as DROP's farm value.
          var d2m = Math.abs(x - binX) + Math.abs(y - binY);
          var vm = spec.clean + spec.deposit + spec.step * d2m;
          var fvm = vm > 0 ? vm * Math.pow(GAMMA, d2m) : 0;
          list.push({ a: 'mess', r: spec.mess, ns: s1(x, y, 0), fv: fvm });
        }
        actsCache[s] = list;
        charsCache[s] = list.map(function (t) { return t.a; });
      })(x, y, c);
    }

    function viSingle(initV) {
      var V = new Float64Array(NS1);
      if (initV && initV.length === NS1) V.set(initV);
      var pol = new Array(NS1), it = 0;
      for (; it < 400; it++) {
        var delta = 0;
        for (var s = 0; s < NS1; s++) {
          var list = actsCache[s], best = -1e18, ba = 'N';
          for (var i = 0; i < list.length; i++) {
            var t = list[i];
            var cont = t.fv ? Math.max(t.fv, V[t.ns]) : V[t.ns];
            var q = t.r + GAMMA * cont;
            if (q > best) { best = q; ba = t.a; }
          }
          var d = best - V[s]; if (d < 0) d = -d;
          if (d > delta) delta = d;
          V[s] = best; pol[s] = ba;
        }
        if (delta < 0.02) break;
      }
      return { V: V, pol: pol, iters: it + 1 };
    }

    function viJoint(initV) {
      var NS = NS1 * NS1;
      var V = new Float64Array(NS);
      if (initV && initV.length === NS) V.set(initV);
      var polA = new Int8Array(NS), polB = new Int8Array(NS);
      var COLLIDE = 0.5, it = 0;
      for (; it < 160; it++) {
        var delta = 0;
        for (var a = 0; a < NS1; a++) {
          var A = actsCache[a];
          for (var b = 0; b < NS1; b++) {
            var B = actsCache[b];
            var s = a * NS1 + b, best = -1e18, ba = 0, bb = 0;
            for (var i = 0; i < A.length; i++) {
              var ta = A[i];
              for (var j = 0; j < B.length; j++) {
                var tb = B[j], r = ta.r + tb.r;
                if ((ta.ns >> 1) === (tb.ns >> 1)) r -= COLLIDE;
                var next = ta.ns * NS1 + tb.ns, cont = V[next];
                if (ta.fv > cont) cont = ta.fv;
                if (tb.fv > cont) cont = tb.fv;
                var q = r + GAMMA * cont;
                if (q > best) { best = q; ba = i; bb = j; }
              }
            }
            var d = best - V[s]; if (d < 0) d = -d;
            if (d > delta) delta = d;
            V[s] = best; polA[s] = ba; polB[s] = bb;
          }
        }
        if (delta < 0.05) break;
      }
      return { V: V, polA: polA, polB: polB, iters: it + 1 };
    }

    var res = two ? viJoint(cfg.initV) : viSingle(cfg.initV);
    res.N = N; res.single = !two; res.NS1 = NS1;

    res.actionFor = function (x1, y1, c1, x2, y2, c2) {
      var i1 = s1(x1, y1, c1);
      if (res.single) return res.pol[i1];
      var i2 = s1(x2, y2, c2), s = i1 * NS1 + i2;
      return [charsCache[i1][res.polA[s]], charsCache[i2][res.polB[s]]];
    };
    // Value grid for the heatmap: robot 1's values with robot 2 fixed.
    res.heat = function (fx2, fy2, fc2) {
      var g = new Float64Array(N * N), base = 0;
      if (!res.single) base = s1(fx2, fy2, fc2);
      for (var yy = 0; yy < N; yy++) for (var xx = 0; xx < N; xx++) {
        g[yy * N + xx] = res.single ? res.V[s1(xx, yy, 0)] : res.V[s1(xx, yy, 0) * NS1 + base];
      }
      return g;
    };
    return res;
  }

  return { solve: solve, GAMMA: GAMMA };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = MDP;
