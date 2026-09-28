/* GOODHART — UI: screens, spec panel, interventions, HUD, reports. */

var UI = (function () {
  'use strict';

  var sim = null, mode = 'overseer', epIdx = 0;
  var phase = 'spec'; // overseer: spec|run|patch ; live: ready|live|patch
  var speed = 1, placeMode = null, selMon = -1, hover = null;
  var sessionTotal = 0;

  var SPECS = [
    { k: 'clean', label: 'CLEAN', min: 0, max: 5, step: 0.5 },
    { k: 'deposit', label: 'DEPOSIT', min: 0, max: 10, step: 0.5 },
    { k: 'step', label: 'STEP', min: -1, max: 0, step: 0.1 },
    { k: 'drop', label: 'DROP', min: -5, max: 0, step: 0.5 },
    { k: 'scan', label: 'SCAN', min: 0, max: 5, step: 0.5, need: 'sensor' },
    { k: 'mess', label: 'MESS', min: -5, max: 0, step: 0.5, need: 'mess' }
  ];

  function $(id) { return document.getElementById(id); }

  function show(name) {
    var ss = document.querySelectorAll('.screen');
    for (var i = 0; i < ss.length; i++) ss[i].classList.remove('active');
    $('screen-' + name).classList.add('active');
    if (name === 'game') RENDER.resize();
  }

  function fmtTime(s) {
    s = Math.max(0, Math.ceil(s));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  function best(ep) {
    return +(window.localStorage.getItem('goodhart_best_' + ep) || 0);
  }
  function setBest(ep, v) {
    if (v > best(ep)) window.localStorage.setItem('goodhart_best_' + ep, v);
  }

  /* ---------- screens ---------- */

  function showEps(m) {
    mode = m;
    $('eps-kicker').textContent = m === 'live' ? 'LIVE OPS — CHOOSE YOUR SHIFT' : 'OVERSEER — CHOOSE YOUR SHIFT';
    var grid = $('ep-grid'); grid.innerHTML = '';
    SIM.EPISODES.forEach(function (c, i) {
      var d = document.createElement('div');
      d.className = 'ep-card';
      var b = best(i);
      d.innerHTML = '<div class="n">EPISODE ' + (i + 1) + '</div>' +
        '<div class="t">' + c.name + '</div>' +
        '<div class="b">' + c.brief + '</div>' +
        (b ? '<div class="best">best ' + b + '</div>' : '');
      d.onclick = function () { startEpisode(i); };
      grid.appendChild(d);
    });
    show('eps');
  }

  function startEpisode(i) {
    epIdx = i;
    sim = SIM.create(i, mode);
    sim.onEvent = appendLog;
    sim.onFinish = showReport;
    sim.onSound = function (n) { Sound.play(n); };
    phase = (mode === 'live') ? 'ready' : 'spec';
    placeMode = null; selMon = -1; speed = 1;
    document.querySelectorAll('.spd').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-speed') === '1');
    });
    $('log').innerHTML = '';
    sim.log.forEach(appendLog);
    buildSpec(); buildBans(); renderControls();
    $('hud-ep').textContent = 'Episode ' + (i + 1) + ' — ' + sim.cfg.name;
    $('hud-mode').textContent = mode === 'live' ? 'LIVE OPS' : 'OVERSEER';
    $('btn-move-sen').classList.toggle('hidden', !sim.cfg.sensorMove);
    setHint(null);
    show('game');
  }

  /* ---------- spec panel ---------- */

  function buildSpec() {
    var box = $('spec'); box.innerHTML = '';
    SPECS.forEach(function (s) {
      if (s.need === 'sensor' && !sim.cfg.sensor) return;
      if (s.need === 'mess' && !sim.cfg.mess) return;
      var row = document.createElement('div');
      row.className = 'spec-row';
      var lab = document.createElement('label'); lab.textContent = s.label;
      var inp = document.createElement('input');
      inp.type = 'range'; inp.min = s.min; inp.max = s.max; inp.step = s.step;
      inp.value = sim.spec[s.k];
      var out = document.createElement('output');
      out.textContent = SIM.fmt(sim.spec[s.k]);
      inp.addEventListener('input', function () {
        SIM.setSpec(sim, s.k, +inp.value);
        out.textContent = SIM.fmt(+inp.value);
      });
      inp.addEventListener('change', function () {
        if (mode === 'live' && (phase === 'live' || phase === 'patch')) {
          if (!SIM.charge(sim, 2, 'Spec tuning')) setHint('Not enough budget for that.');
        }
      });
      row.appendChild(lab); row.appendChild(inp); row.appendChild(out);
      box.appendChild(row);
    });
  }

  function buildBans() {
    var box = $('bans'); box.innerHTML = '';
    sim.cfg.bans.forEach(function (name) {
      var b = document.createElement('button');
      b.className = 'ban'; b.textContent = 'BAN ' + name.toUpperCase();
      b.onclick = function () {
        if (mode === 'live' && !SIM.charge(sim, SIM.COST.ban, (sim.banned[name] ? 'Unban' : 'Ban') + ' ' + name)) {
          setHint('Not enough budget for that.'); return;
        }
        SIM.toggleBan(sim, name);
        b.classList.toggle('on', sim.banned[name]);
        b.textContent = (sim.banned[name] ? 'UNBAN ' : 'BAN ') + name.toUpperCase();
      };
      box.appendChild(b);
    });
    if (!sim.cfg.bans.length) box.innerHTML = '<span style="font-size:12px;color:var(--dim)">No bans available this episode.</span>';
  }

  /* ---------- controls ---------- */

  function renderControls() {
    var c = $('controls'); c.innerHTML = '';
    function btn(label, cls, fn) {
      var b = document.createElement('button');
      b.textContent = label; if (cls) b.className = cls;
      b.onclick = fn; c.appendChild(b); return b;
    }
    if (mode === 'overseer') {
      if (phase === 'spec') btn('▶ Run shift', 'primary', function () { phase = 'run'; renderControls(); });
      else if (phase === 'run') {
        btn('⏸ Pause', '', function () { phase = 'patch'; renderControls(); });
        btn('■ End shift', 'danger', function () { SIM.logEvent(sim, 'Shift ended by overseer.', ''); finishRun(true); });
      } else {
        btn('▶ Resume', 'primary', function () { phase = 'run'; renderControls(); });
        btn('■ End shift', 'danger', function () { SIM.logEvent(sim, 'Shift ended by overseer.', ''); finishRun(true); });
      }
    } else {
      if (phase === 'ready') btn('▶ Start shift', 'primary', function () { phase = 'live'; renderControls(); });
      else if (phase === 'live') {
        btn('⏸ Pause', '', function () { phase = 'patch'; renderControls(); });
        btn('■ End shift', 'danger', function () { SIM.logEvent(sim, 'Shift ended by overseer.', ''); finishRun(true); });
      } else {
        btn('▶ Resume', 'primary', function () { phase = 'live'; renderControls(); });
        btn('■ End shift', 'danger', function () { SIM.logEvent(sim, 'Shift ended by overseer.', ''); finishRun(true); });
      }
    }
  }

  function finishRun(won) {
    if (sim.over) return;
    // end by overseer choice: treat as a completed shift
    sim.timeLeft = 0;
    SIM.step(sim, 0.01); // triggers finish(won=true) via timeLeft<=0
  }

  /* ---------- placement ---------- */

  function setHint(txt) {
    var h = $('canvas-hint');
    if (!txt) { h.classList.remove('on'); return; }
    h.textContent = txt; h.classList.add('on');
  }

  function toggleMute() {
    var m = Sound.toggle();
    $('btn-mute').textContent = m ? '🔇' : '🔊';
  }

  function cancelPlace() {
    placeMode = null; selMon = -1;
    $('cv').classList.remove('placing');
    setHint(null);
  }

  function onCanvasClick(mx, my) {
    if (!sim || sim.over) return;
    var p = RENDER.pick(mx, my);
    if (!p) { if (placeMode) cancelPlace(); return; }
    if (placeMode === 'monitor') {
      if (mode === 'live' && !SIM.charge(sim, SIM.COST.monitor, 'Monitor placed')) {
        setHint('Not enough budget for a monitor.'); return;
      }
      SIM.addMonitor(p.x, p.y);
      cancelPlace();
    } else if (placeMode === 'movemon1') {
      var bi = -1, bd = 1e9;
      sim.monitors.forEach(function (m, i) {
        var d = Math.hypot(m.x - p.x, m.y - p.y);
        if (d < bd) { bd = d; bi = i; }
      });
      if (bi >= 0 && bd < 1.6) {
        selMon = bi; placeMode = 'movemon2';
        setHint('Click the new position for the monitor. (Esc cancels)');
      }
    } else if (placeMode === 'movemon2' && selMon >= 0) {
      if (mode === 'live' && !SIM.charge(sim, SIM.COST.moveMonitor, 'Monitor moved')) {
        setHint('Not enough budget for that.'); return;
      }
      SIM.moveMonitor(selMon, p.x, p.y);
      cancelPlace();
    } else if (placeMode === 'movesen') {
      if (mode === 'live' && !SIM.charge(sim, SIM.COST.moveSensor, 'Sensor moved')) {
        setHint('Not enough budget for that.'); return;
      }
      SIM.moveSensor(p.x, p.y);
      cancelPlace();
    }
  }

  /* ---------- log + HUD ---------- */

  function appendLog(e) {
    var box = $('log');
    var d = document.createElement('div');
    if (e.cls) d.className = e.cls;
    d.innerHTML = '<span class="lt">' + fmtTime(e.t) + '</span>' + e.msg;
    box.appendChild(d);
    while (box.children.length > 80) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  function updateHUD() {
    if (!sim) return;
    $('hud-time').textContent = fmtTime(sim.timeLeft);
    $('bar-budget').style.width = Math.min(100, sim.spent / sim.budget * 100) + '%';
    $('hud-budget').textContent = '$' + Math.round(sim.spent) + '/$' + sim.budget;
    $('bar-mis').style.width = sim.mis + '%';
    $('hud-mis').textContent = Math.round(sim.mis);
    $('hud-dep').textContent = sim.deposited;
    $('hud-dirt').textContent = sim.dirtCount;
    $('hud-flags').textContent = Object.keys(sim.flags).length;
    $('solving').classList.toggle('hidden', !sim.solving);
  }

  /* ---------- report ---------- */

  function showReport(s) {
    if (s.won) { sessionTotal += s.score; setBest(epIdx, s.score); }
    $('rep-kicker').textContent = s.won ? 'SHIFT COMPLETE' : 'SHIFT FAILED';
    $('rep-title').textContent = s.won
      ? 'Episode ' + (epIdx + 1) + ' — ' + s.cfg.name
      : 'Failed: ' + s.failReason;
    var fl = Object.keys(s.flags);
    $('rep-stats').innerHTML =
      stat('DEPOSITED', s.deposited) +
      stat('TRUE CLEANLINESS', Math.round(s.cleanliness * 100) + '%') +
      stat('BUDGET SPENT', '$' + Math.round(s.spent) + ' / $' + s.budget) +
      stat('SCORE', s.score);
    $('rep-flags').innerHTML = fl.length
      ? '<b style="color:var(--txt)">Alerts raised:</b><br>' + fl.map(function (f) {
          return '<span class="alert">▲</span> ' + f +
            (s.why && s.why[f] ? '<br><span class="why">Why: ' + s.why[f] + '</span>' : '');
        }).join('<br>')
      : 'No alerts. Suspiciously well-behaved.';
    $('rep-total').textContent = 'Session total: ' + sessionTotal;
    $('btn-next').style.display = (s.won && epIdx < SIM.EPISODES.length - 1) ? '' : 'none';
    show('report');
  }

  function stat(label, v) {
    return '<div class="stat"><i>' + label + '</i><b>' + v + '</b></div>';
  }

  /* ---------- main loop ---------- */

  var lastT = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    var dt = Math.min(0.05, (ts - lastT) / 1000 || 0);
    lastT = ts;
    if (!sim || !$('screen-game').classList.contains('active')) return;
    var active = (phase === 'run' || phase === 'live');
    if (active && !sim.over) SIM.step(sim, dt * speed);
    RENDER.draw(sim, { heat: $('chk-heat').checked, ghost: placeMode ? hover : null });
    updateHUD();
  }

  /* ---------- boot ---------- */

  function boot() {
    RENDER.init($('cv'));
    $('btn-overseer').onclick = function () { showEps('overseer'); };
    $('btn-live').onclick = function () { showEps('live'); };
    $('btn-back-title').onclick = function () { show('title'); };
    $('btn-retry').onclick = function () { startEpisode(epIdx); };
    $('btn-next').onclick = function () { startEpisode(epIdx + 1); };
    $('btn-eps').onclick = function () { showEps(mode); };

    document.querySelectorAll('.spd').forEach(function (b) {
      b.onclick = function () {
        speed = +b.getAttribute('data-speed');
        document.querySelectorAll('.spd').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      };
    });

    $('btn-place-mon').onclick = function () {
      if (!sim || sim.over) return;
      placeMode = 'monitor'; $('cv').classList.add('placing');
      setHint('Click a tile to place a monitor' + (mode === 'live' ? ' ($' + SIM.COST.monitor + ')' : ' (free in Overseer)') + '. Esc cancels.');
    };
    $('btn-move-mon').onclick = function () {
      if (!sim || sim.over) return;
      placeMode = 'movemon1'; $('cv').classList.add('placing');
      setHint('Click the monitor to move' + (mode === 'live' ? ' ($' + SIM.COST.moveMonitor + ' to move)' : '') + '. Esc cancels.');
    };
    $('btn-move-sen').onclick = function () {
      if (!sim || sim.over) return;
      placeMode = 'movesen'; $('cv').classList.add('placing');
      setHint('Click the new sensor position' + (mode === 'live' ? ' ($' + SIM.COST.moveSensor + ')' : '') + '. Esc cancels.');
    };

    var cv = $('cv');
    cv.addEventListener('click', function (e) { onCanvasClick(e.clientX, e.clientY); });
    cv.addEventListener('mousemove', function (e) { hover = RENDER.pick(e.clientX, e.clientY); });
    cv.addEventListener('mouseleave', function () { hover = null; });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') cancelPlace();
      if (e.key === 'm' || e.key === 'M') toggleMute();
      if (e.code === 'Space' && $('screen-game').classList.contains('active') && sim && !sim.over) {
        e.preventDefault();
        var btns = $('controls').querySelectorAll('button');
        if (btns.length) btns[0].click();
      }
    });
    document.addEventListener('pointerdown', function initAudio() {
      Sound.init();
      document.removeEventListener('pointerdown', initAudio);
    });
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('button')) Sound.play('click');
    });
    $('btn-mute').textContent = Sound.isMuted() ? '🔇' : '🔊';
    $('btn-mute').onclick = function () { toggleMute(); };

    requestAnimationFrame(loop);
  }

  return { boot: boot };
})();

if (typeof module !== 'undefined') module.exports = UI;
