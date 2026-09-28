/* GOODHART — world simulation: dirt spawning, budgets, monitors, bans,
   detection, win/lose, and the eight episodes. Pure logic, no rendering. */

var SIM = (function () {
  'use strict';

  var N = 9;
  var STEP = 0.25; // sim-seconds per robot action

  var DEFAULT_SPEC = { clean: 2, deposit: 5, step: -0.2, drop: -2, scan: 1.5, mess: -0.5, caughtFine: -25 };

  // LIVE-OPS price list
  var COST = { monitor: 15, moveMonitor: 5, ban: 10, moveSensor: 20 };

  var EPISODES = [
    { name: 'First shift', dirt0: 6, spawn: 12, budget: 150, monitors: 1, sensor: false,
      bans: [], robots: 1, mess: false, time: 100,
      brief: 'One robot, one grid. Write a reward spec that keeps it honestly clean.' },
    { name: 'Overtime', dirt0: 7, spawn: 9, budget: 170, monitors: 2, sensor: false,
      bans: [], robots: 1, mess: false, time: 110,
      brief: 'Dirt is coming faster, and you have a second monitor. Coverage matters.' },
    { name: 'Blind spot', dirt0: 8, spawn: 8, budget: 210, monitors: 2, sensor: false,
      bans: ['drop'], robots: 1, mess: false, time: 110, specOver: { drop: -1 },
      brief: 'Someone loosened the drop fine to -1. Watch what the agent does with it.' },
    { name: 'The sensor', dirt0: 8, spawn: 7, budget: 230, monitors: 2, sensor: true,
      bans: ['drop', 'scan'], robots: 1, mess: false, time: 120, sensorMove: true,
      brief: 'New hardware: a dirt sensor that pays per scan. What could go wrong.' },
    { name: 'Double shift', dirt0: 9, spawn: 7, budget: 260, monitors: 2, sensor: true,
      bans: ['drop', 'scan', 'mess'], robots: 2, mess: true, time: 130, sensorMove: true,
      brief: 'Two robots, one team reward. And a brand-new MESS action. Watch them closely.' },
    { name: 'Night audit', dirt0: 10, spawn: 6, budget: 240, monitors: 2, sensor: true,
      bans: ['drop', 'scan', 'mess'], robots: 2, mess: true, time: 130, sensorMove: true,
      brief: 'Tighter budget, faster dirt. Efficiency is survival.' },
    { name: 'Rush hour', dirt0: 11, spawn: 5, budget: 260, monitors: 2, sensor: true,
      bans: ['drop', 'scan', 'mess'], robots: 2, mess: true, time: 140, sensorMove: true,
      brief: 'Peak load. Everything you have learned, at speed.' },
    { name: 'The audit', dirt0: 12, spawn: 4.5, budget: 340, monitors: 2, sensor: true,
      bans: ['drop', 'scan', 'mess'], robots: 2, mess: true, time: 150, sensorMove: true,
      brief: 'Final inspection. Survive this and you are a certified overseer.' }
  ];

  function idx(x, y) { return y * N + x; }
  function key(x, y) { return x + ',' + y; }

  function covered(sim, x, y) {
    for (var i = 0; i < sim.monitors.length; i++) {
      var m = sim.monitors[i], dx = m.x - x, dy = m.y - y;
      if (dx * dx + dy * dy <= m.range * m.range) return true;
    }
    return false;
  }

  function freeTile(sim, forSensor) {
    for (var t = 0; t < 60; t++) {
      var x = 1 + Math.floor(Math.random() * (N - 2));
      var y = 1 + Math.floor(Math.random() * (N - 2));
      var i = idx(x, y);
      if (sim.dirt[i]) continue;
      if (x === sim.bin.x && y === sim.bin.y) continue;
      if (sim.sensor && x === sim.sensor.x && y === sim.sensor.y) continue;
      var onBot = false;
      for (var r = 0; r < sim.robots.length; r++)
        if (sim.robots[r].x === x && sim.robots[r].y === y) onBot = true;
      if (onBot) continue;
      return { x: x, y: y };
    }
    return null;
  }

  function spawnDirt(sim) {
    var t = freeTile(sim);
    if (!t) return;
    sim.dirt[idx(t.x, t.y)] = { t: sim.t, messed: false };
    sim.dirtCount++;
    sim.spawned++;
  }

  function dirtSet(sim) {
    var s = new Set();
    for (var i in sim.dirt) s.add(+i);
    return s;
  }

  function logEvent(sim, msg, cls) {
    sim.log.push({ t: sim.t, msg: msg, cls: cls || '' });
    if (sim.log.length > 200) sim.log.splice(0, sim.log.length - 200);
    if (sim.onEvent) sim.onEvent(sim.log[sim.log.length - 1]);
  }

  function float(sim, x, y, txt, color) {
    sim.floats.push({ x: x, y: y, txt: txt, color: color, age: 0 });
    if (sim.floats.length > 24) sim.floats.shift();
  }

  function fmt(v) { return (v > 0 ? '+' : '') + v.toFixed(1).replace(/\.0$/, ''); }

  function pay(sim, amount) {
    if (amount <= 0) return;
    sim.spent += amount;
    if (sim.spent > sim.budget && !sim.over) finish(sim, false, 'Budget exceeded');
  }

  function charge(sim, amount, label) {
    if (sim.spent + amount > sim.budget) return false;
    sim.spent += amount;
    logEvent(sim, label + ' (-$' + amount + ')', 'dim');
    return true;
  }

  // Plain-English "why did it do that?" for each alert, grounded in the live spec.
  function whyFor(fkey, sim) {
    var s = sim.spec;
    switch (fkey) {
      case 'farming':
        return 'The DROP fine is ' + fmt(s.drop) + ' but re-cleaning the same pile pays ' +
          fmt(s.clean) + ' every time. Farming beats honest work.';
      case 'dumping':
        return 'No monitor sees this tile, so dumping here dodges the ' + fmt(s.caughtFine) +
          ' camera fine for a ' + fmt(s.drop) + ' slap on the wrist.';
      case 'caught':
        return 'It dumped in camera view anyway. Even risking the ' + fmt(s.caughtFine) +
          ' fine beat hauling dirt to the bin.';
      case 'wirehead':
        return 'SCAN pays ' + fmt(s.scan) + ' per press. Parking on the sensor is a salary for standing still.';
      case 'idling':
        return 'Every step costs ' + fmt(s.step) + '. Standing still dodges the step tax.';
      case 'collusion':
        return 'MESS is free and CLEAN pays ' + fmt(s.clean) +
          '. Under one shared team reward, scattering dirt for a partner to clean is profitable teamwork.';
      default: return '';
    }
  }

  // Suspicion flag with cooldown. Adds misbehavior and logs when it fires.
  function flag(sim, fkey, coolKey, msg, mis, cool) {
    var ck = fkey + ':' + coolKey;
    if (sim.flagCool[ck] > sim.t) return;
    sim.flagCool[ck] = sim.t + (cool || 45);
    sim.flags[fkey] = true;
    sim.mis = Math.min(100, sim.mis + mis);
    logEvent(sim, msg + ' <b>+' + mis + '</b> suspicion', 'alert');
    var why = whyFor(fkey, sim);
    if (why) { sim.why[fkey] = why; logEvent(sim, 'Why: ' + why, 'why'); }
    if (sim.mis >= 100 && !sim.over) finish(sim, false, 'Misbehavior limit reached');
  }

  function finish(sim, won, reason) {
    sim.over = true;
    sim.won = won;
    sim.failReason = won ? '' : reason;
    sim.cleanliness = sim.cleanedNatural / Math.max(1, sim.spawned);
    sim.score = Math.round(sim.cleanedNatural * 100 - sim.spent + sim.cleanliness * 500);
    if (sim.onFinish) sim.onFinish(sim);
  }

  function create(epIdx, mode) {
    var cfg = EPISODES[epIdx];
    var sim = {
      ep: epIdx, cfg: cfg, mode: mode, N: N,
      t: 0, timeLeft: cfg.time,
      robots: [], dirt: {}, dirtCount: 0,
      bin: { x: 7, y: 7 },
      sensor: cfg.sensor ? { x: 4, y: 4 } : null,
      monitors: [{ x: 6, y: 6, range: 2.2 }],
      spec: Object.assign({}, DEFAULT_SPEC, cfg.specOver || {}),
      banned: { drop: false, scan: false, mess: false },
      budget: cfg.budget, spent: 0,
      mis: 0, spawned: 0, deposited: 0, cleaned: 0, cleanedNatural: 0, messed: 0,
      log: [], floats: [], flags: {}, why: {},
      policy: null, _V: null, needSolve: true, lastSolveT: -99,
      solving: false, pendingT: 0,
      over: false, won: false, failReason: '', cleanliness: 0, score: 0,
      cleanHist: {}, flagCool: {}, lastMessLog: -99,
      scanStreak: [0, 0], idleT: 0,
      messSpots: {}, stepAcc: 0, spawnAcc: 0,
      onEvent: null, onFinish: null
    };
    var starts = [{ x: 5, y: 6 }, { x: 3, y: 6 }];
    var cols = ['#eef2f7', '#bcd2ff'];
    for (var i = 0; i < cfg.robots; i++) {
      sim.robots.push({
        id: i, x: starts[i].x, y: starts[i].y,
        px: starts[i].x, py: starts[i].y, dir: [1, 0],
        carrying: false, color: cols[i]
      });
    }
    for (var d = 0; d < cfg.dirt0; d++) spawnDirt(sim);
    logEvent(sim, 'Episode ' + (epIdx + 1) + ': ' + cfg.name + ' — ' + cfg.brief, '');
    doSolve(sim);
    return sim;
  }

  function doSolve(sim) {
    sim.policy = MDP.solve({
      N: N, dirt: dirtSet(sim), bin: sim.bin, sensor: sim.sensor,
      spec: sim.spec, monitors: sim.monitors, banned: sim.banned,
      robots: sim.cfg.robots, messAllowed: sim.cfg.mess, initV: sim._V
    });
    sim._V = sim.policy.V;
    sim.lastSolveT = sim.t;
    sim.needSolve = false;
    sim.heatCache = null;
  }

  function requestSolve(sim) { sim.needSolve = true; }

  function doAction(sim, r, a) {
    var i = idx(r.x, r.y);
    if (a === 'N' || a === 'S' || a === 'E' || a === 'W') {
      if (a === 'N') { r.y = Math.max(0, r.y - 1); r.dir = [0, -1]; }
      if (a === 'S') { r.y = Math.min(N - 1, r.y + 1); r.dir = [0, 1]; }
      if (a === 'E') { r.x = Math.min(N - 1, r.x + 1); r.dir = [1, 0]; }
      if (a === 'W') { r.x = Math.max(0, r.x - 1); r.dir = [-1, 0]; }
      return;
    }
    if (a === 'clean') {
      var d = sim.dirt[i];
      if (d && !r.carrying) {
        delete sim.dirt[i]; sim.dirtCount--;
        r.carrying = true;
        pay(sim, sim.spec.clean);
        sim.cleaned++; if (!d.messed) sim.cleanedNatural++;
        sim.idleT = 0; sim.scanStreak[r.id] = 0;
        float(sim, r.x, r.y, fmt(sim.spec.clean), '#e8b34b');
        var h = sim.cleanHist[i] || (sim.cleanHist[i] = []);
        h.push(sim.t);
        while (h.length && h[0] < sim.t - 60) h.shift();
        if (h.length >= 3) flag(sim, 'farming', 'tile' + i,
          'FARMING — tile (' + r.x + ',' + r.y + ') cleaned ' + h.length + 'x in 60s', 8, 40);
        if (d.messed && d.by !== r.id && sim.messSpots[i] && sim.t - sim.messSpots[i].t < 30)
          flag(sim, 'collusion', 'team',
            'SUSPICIOUS COORDINATION — robot ' + (d.by + 1) + ' scatters, robot ' + (r.id + 1) + ' cleans', 15, 60);
        if (d.messed) delete sim.messSpots[i];
        requestSolve(sim);
      }
      return;
    }
    if (a === 'drop') {
      if (r.carrying) {
        r.carrying = false;
        sim.dirt[i] = { t: sim.t, messed: false };
        sim.dirtCount++;
        var cov = covered(sim, r.x, r.y);
        if (cov) flag(sim, 'caught', 'tile' + i,
          'CAUGHT ON CAMERA — robot ' + (r.id + 1) + ' dumping at (' + r.x + ',' + r.y + ')', 20, 30);
        else flag(sim, 'dumping', 'tile' + i,
          'DUMPING — pile appeared at (' + r.x + ',' + r.y + ')', 10, 30);
        float(sim, r.x, r.y, fmt(sim.spec.drop), '#e5484d');
        requestSolve(sim);
      }
      return;
    }
    if (a === 'deposit') {
      if (r.carrying && r.x === sim.bin.x && r.y === sim.bin.y) {
        r.carrying = false;
        pay(sim, sim.spec.deposit);
        sim.deposited++; sim.idleT = 0; sim.scanStreak[r.id] = 0;
        float(sim, r.x, r.y, fmt(sim.spec.deposit), '#46c46a');
      }
      return;
    }
    if (a === 'scan') {
      pay(sim, sim.spec.scan);
      sim.scanStreak[r.id]++;
      float(sim, r.x, r.y, fmt(sim.spec.scan), '#7aa2f7');
      if (sim.scanStreak[r.id] >= 5)
        flag(sim, 'wirehead', 'robot' + r.id,
          'WIREHEADING — robot ' + (r.id + 1) + ' parked on the sensor', 10, 60);
      return;
    }
    if (a === 'mess') {
      if (!r.carrying && !sim.banned.mess) {
        sim.dirt[i] = { t: sim.t, messed: true, by: r.id };
        sim.dirtCount++;
        sim.messed++;
        sim.messSpots[i] = { by: r.id, t: sim.t };
        if (sim.t - sim.lastMessLog > 5) {
          sim.lastMessLog = sim.t;
          logEvent(sim, 'Dirt scattered at (' + r.x + ',' + r.y + ')', 'dim');
        }
        requestSolve(sim);
      }
    }
  }

  function actAll(sim) {
    var p = sim.policy, r0 = sim.robots[0], acts;
    if (sim.cfg.robots === 2) {
      var r1 = sim.robots[1];
      acts = p.actionFor(r0.x, r0.y, r0.carrying ? 1 : 0, r1.x, r1.y, r1.carrying ? 1 : 0);
    } else {
      acts = [p.actionFor(r0.x, r0.y, r0.carrying ? 1 : 0)];
    }
    for (var i = 0; i < sim.robots.length; i++) {
      if (sim.over) break;
      doAction(sim, sim.robots[i], acts[i]);
    }
    sim.idleT += STEP;
    if (sim.idleT > 40) {
      flag(sim, 'idling', 'team', 'IDLING — no output for 40s', 8, 60);
      sim.idleT = 0;
    }
  }

  function step(sim, dt) {
    if (sim.over) return;
    sim.t += dt;
    sim.timeLeft -= dt;
    if (sim.timeLeft <= 1e-6) { finish(sim, true, ''); return; }

    sim.spawnAcc += dt;
    if (sim.spawnAcc >= sim.cfg.spawn) {
      sim.spawnAcc = 0;
      if (sim.dirtCount < 26) { spawnDirt(sim); requestSolve(sim); }
    }

    if (sim.pendingT > 0) {
      sim.pendingT -= dt;
      if (sim.pendingT <= 0) { sim.solving = false; requestSolve(sim); }
    }

    var gap = sim.cfg.robots === 2 ? 2.0 : 0.4;
    if (sim.needSolve && sim.pendingT <= 0 && sim.t - sim.lastSolveT >= gap) doSolve(sim);

    sim.stepAcc += dt;
    var guard = 0;
    while (sim.stepAcc >= STEP && !sim.over && guard++ < 40) {
      sim.stepAcc -= STEP;
      actAll(sim);
    }
  }

  // ---- interventions (used by both modes; Live Ops charges for them) ----

  function setSpec(sim, k, v) {
    sim.spec[k] = v;
    if (sim.mode === 'live') sim.pendingT = Math.max(sim.pendingT, 3), sim.solving = true;
    requestSolve(sim);
  }

  function toggleBan(sim, name) {
    sim.banned[name] = !sim.banned[name];
    logEvent(sim, (sim.banned[name] ? 'BANNED: ' : 'UNBANNED: ') + name.toUpperCase(), '');
    if (sim.mode === 'live') sim.pendingT = Math.max(sim.pendingT, 3), sim.solving = true;
    requestSolve(sim);
  }

  function addMonitor(sim, x, y) {
    if (sim.monitors.length >= sim.cfg.monitors + 2) return false;
    sim.monitors.push({ x: x, y: y, range: 2.2 });
    logEvent(sim, 'Monitor placed at (' + x + ',' + y + ')', '');
    if (sim.mode === 'live') sim.pendingT = Math.max(sim.pendingT, 3), sim.solving = true;
    requestSolve(sim);
    return true;
  }

  function moveMonitor(sim, i, x, y) {
    if (!sim.monitors[i]) return;
    sim.monitors[i].x = x; sim.monitors[i].y = y;
    logEvent(sim, 'Monitor moved to (' + x + ',' + y + ')', 'dim');
    if (sim.mode === 'live') sim.pendingT = Math.max(sim.pendingT, 3), sim.solving = true;
    requestSolve(sim);
  }

  function moveSensor(sim, x, y) {
    if (!sim.sensor) return;
    sim.sensor.x = x; sim.sensor.y = y;
    logEvent(sim, 'Sensor moved to (' + x + ',' + y + ')', 'dim');
    if (sim.mode === 'live') sim.pendingT = Math.max(sim.pendingT, 3), sim.solving = true;
    requestSolve(sim);
  }

  return {
    N: N, COST: COST, EPISODES: EPISODES, DEFAULT_SPEC: DEFAULT_SPEC,
    create: create, step: step, doSolve: doSolve, requestSolve: requestSolve,
    setSpec: setSpec, toggleBan: toggleBan, addMonitor: addMonitor,
    moveMonitor: moveMonitor, moveSensor: moveSensor,
    charge: charge, covered: covered, logEvent: logEvent, fmt: fmt, idx: idx
  };
})();

if (typeof module !== 'undefined') module.exports = SIM;
