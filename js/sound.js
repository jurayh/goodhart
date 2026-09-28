/* GOODHART — tiny WebAudio synth. Zero assets, zero dependencies. */
var Sound = (function () {
  var ctx = null, muted = false, lastPlay = {};
  try { muted = localStorage.getItem('goodhart_mute') === '1'; } catch (e) {}

  function ac() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, delay, dur, type, vol, slideTo) {
    var c = ac(); if (!c) return;
    var t = c.currentTime + delay;
    var o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function throttled(name, ms) {
    var now = Date.now();
    if (lastPlay[name] && now - lastPlay[name] < ms) return true;
    lastPlay[name] = now;
    return false;
  }

  return {
    init: function () { try { ac(); } catch (e) {} },
    isMuted: function () { return muted; },
    toggle: function () {
      muted = !muted;
      try { localStorage.setItem('goodhart_mute', muted ? '1' : '0'); } catch (e) {}
      return muted;
    },
    play: function (name) {
      if (muted) return;
      try {
        switch (name) {
          case 'clean':
            if (throttled(name, 70)) return;
            tone(660, 0, 0.07, 'sine', 0.10);
            break;
          case 'deposit':
            if (throttled(name, 120)) return;
            tone(523, 0, 0.09, 'sine', 0.13);
            tone(784, 0.08, 0.12, 'sine', 0.13);
            break;
          case 'alert':
            if (throttled(name, 400)) return;
            tone(196, 0, 0.16, 'sawtooth', 0.07, 130);
            break;
          case 'win':
            [523, 659, 784, 1047].forEach(function (f, i) { tone(f, i * 0.1, 0.14, 'triangle', 0.12); });
            break;
          case 'lose':
            tone(311, 0, 0.18, 'triangle', 0.11, 208);
            tone(208, 0.16, 0.28, 'triangle', 0.11, 139);
            break;
          case 'click':
            if (throttled(name, 50)) return;
            tone(840, 0, 0.035, 'square', 0.04);
            break;
        }
      } catch (e) {}
    }
  };
})();
