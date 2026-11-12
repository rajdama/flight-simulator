'use strict';
/* Synthesised sound: engines, airflow, ground roll, rain, warnings, thunder. Web Audio only, no samples. */
const AUDIO = (function () {
  let ac = null, master, bus, lp, N = {}, on = true, vol = 0.7, lastSay = 0;
  const now = () => ac.currentTime;
  function noise(sec, brown) {
    const b = ac.createBuffer(1, ac.sampleRate * sec, ac.sampleRate), d = b.getChannelData(0); let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    return b;
  }
  function loop(buf, filterType, freq, q) {
    const src = ac.createBufferSource(); src.buffer = buf; src.loop = true; const f = ac.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q || 0.7;
    const g = ac.createGain(); g.gain.value = 0; src.connect(f); f.connect(g); g.connect(bus); src.start(); return { g, f };
  }
  function osc(type, freq) { const o = ac.createOscillator(); o.type = type; o.frequency.value = freq; const g = ac.createGain(); g.gain.value = 0; o.connect(g); g.connect(bus); o.start(); return { o, g }; }
  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
    try {
      ac = new A(); master = ac.createGain(); master.gain.value = on ? vol : 0; master.connect(ac.destination);
      lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200; lp.connect(master); bus = ac.createGain(); bus.connect(lp);
      const white = noise(2, false), brown = noise(3, true);
      N.rumble = loop(brown, 'lowpass', 140); N.wind = loop(white, 'bandpass', 500, 0.5); N.roll = loop(brown, 'lowpass', 70); N.rain = loop(white, 'highpass', 3200); N.jet = loop(white, 'bandpass', 1800, 0.8);
      N.e = [0, 1].map(() => ({ a: osc('sawtooth', 80), b: osc('sine', 200) }));
      N.motor = osc('sawtooth', 96); N.shaker = osc('square', 23);
      N.white = white; N.brown = brown;
    } catch (e) { ac = null; }
  }
  const set = (p, v, tc) => p.setTargetAtTime(v, now(), tc || 0.08);
  function update(s) { // s: {n1[], thrust, ias, gs, onGround, cockpit, rain, moving, stall, paused}
    if (!ac) return;
    const k = s.paused ? 0 : 1, ck = s.cockpit ? 1 : 0;
    set(lp.frequency, s.cockpit ? 1500 : 7000, 0.3);
    for (let i = 0; i < 2; i++) { const n = s.n1[i] / 100, e = N.e[i]; set(e.a.o.frequency, 38 + n * 150 + i * 1.5); set(e.b.o.frequency, 180 + n * 1500 + i * 9); set(e.a.g.gain, k * n * n * (ck ? 0.035 : 0.06)); set(e.b.g.gain, k * (0.008 + n * 0.02) * (ck ? 0.5 : 1)); }
    const th = (s.n1[0] + s.n1[1]) / 200;
    set(N.rumble.g.gain, k * (0.05 + th * th * (ck ? 0.5 : 0.85))); set(N.jet.g.gain, k * th * th * (ck ? 0.03 : 0.12)); set(N.jet.f.frequency, 900 + th * 1600);
    const q = Math.min(1.3, Math.pow(s.ias / 140, 2));
    set(N.wind.g.gain, k * q * (ck ? 0.22 : 0.10) * (1 + s.drag * 0.6)); set(N.wind.f.frequency, 320 + s.ias * 5);
    set(N.roll.g.gain, k * (s.onGround ? Math.min(1, s.gs / 55) * 0.9 : 0)); set(N.rain.g.gain, k * s.rain * (ck ? 0.05 : 0.025) * (0.4 + q));
    set(N.motor.g.gain, k * (s.moving ? 0.022 : 0), 0.05); set(N.shaker.g.gain, k * (s.stall ? 0.07 : 0), 0.03);
  }
  function blip(type, f0, f1, dur, gain, delay) {
    if (!ac) return; const t = now() + (delay || 0), o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function burst(buf, type, freq, dur, gain, delay) {
    if (!ac) return; const t = now() + (delay || 0), s = ac.createBufferSource(); s.buffer = buf; const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; const g = ac.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + dur + 0.1);
  }
  const fx = {
    touchdown(vs) { const g = Math.min(1, 0.25 + vs / 4); burst(N.brown, 'lowpass', 160, 0.7, g * 1.4); burst(N.white, 'bandpass', 2600, 0.28, g * 0.22); burst(N.white, 'bandpass', 2300, 0.22, g * 0.16, 0.12); },
    clunk() { burst(N.brown, 'lowpass', 240, 0.25, 0.9); blip('sine', 90, 50, 0.18, 0.25); },
    click() { blip('square', 1400, 900, 0.03, 0.05); },
    chime() { blip('sine', 880, 880, 0.35, 0.16); blip('sine', 1320, 1320, 0.5, 0.14, 0.16); },
    wp() { blip('sine', 1180, 1180, 0.18, 0.1); },
    caution() { blip('triangle', 760, 760, 0.16, 0.16); blip('triangle', 760, 760, 0.16, 0.16, 0.24); },
    warning() { for (let i = 0; i < 3; i++) { blip('sawtooth', 980, 980, 0.11, 0.09, i * 0.36); blip('sawtooth', 660, 660, 0.11, 0.09, i * 0.36 + 0.17); } },
    apDisc() { for (let i = 0; i < 4; i++) blip('square', i % 2 ? 620 : 880, i % 2 ? 620 : 880, 0.17, 0.07, i * 0.2); },
    thunder(delay, near) { burst(N.brown, 'lowpass', near ? 400 : 150, near ? 2.6 : 4.5, near ? 2.2 : 1.1, delay); if (near) burst(N.white, 'highpass', 1500, 0.25, 0.5, delay); },
    crash() { burst(N.brown, 'lowpass', 300, 2.2, 2.4); burst(N.white, 'bandpass', 900, 1.2, 0.8); },
    success() { blip('sine', 660, 660, 0.25, 0.14); blip('sine', 880, 880, 0.25, 0.14, 0.18); blip('sine', 1320, 1320, 0.6, 0.14, 0.36); }
  };
  function play(name, a, b) { if (ac && on && fx[name]) { try { fx[name](a, b); } catch (e) { } } }
  function say(text) { // radio-altitude callouts via the browser voice, where one exists
    if (!on || !window.speechSynthesis) return; const t = performance.now(); if (t - lastSay < 600) return; lastSay = t;
    try { const u = new SpeechSynthesisUtterance(text); u.rate = 1.15; u.pitch = 0.9; u.volume = Math.min(1, vol * 1.2); window.speechSynthesis.speak(u); } catch (e) { }
  }
  return {
    init, update, play, say,
    setOn(v) { on = v; if (ac) set(master.gain, on ? vol : 0, 0.05); if (!on && window.speechSynthesis) try { window.speechSynthesis.cancel(); } catch (e) { } },
    setVol(v) { vol = v; if (ac && on) set(master.gain, vol, 0.05); },
    get on() { return on; }, get ready() { return !!ac; }
  };
})();
