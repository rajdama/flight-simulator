'use strict';
/* Application: input, cameras, mission flow, HUD, main loop. */
(function () {
  const $ = id => document.getElementById(id);
  const { KT, FT, D2R, R2D, NM, clamp, wrapPi, wrap360, sstep } = FS;
  const canvas = $('view');
  let world, scene, sim, run = null, mode = 'loading', lastDef = null, lastOpts = {};
  const env = { hour: 10, rate: 1, flash: 0, bolt: null, boltT: 0, nextStrike: 6, pulse: 0 };
  const set = { simRate: 1, invert: 1, gfx: 'auto', scale: 1, vol: 0.7, panel: { cockpit: true, chase: false, free: false }, range: 20, done: {} };
  const cam = { mode: 'free', hdg: 0, yaw: 0, pitch: 0.17, dist: 95, lookYaw: 0, lookPitch: 0, fovC: 62, freeYaw: 0.9, freePitch: 0.2, freeDist: 125, t: 1, from: null, pos: [0, 100, 0], q: [0, 0, 0, 1], fov: 0.9, shift: 0, shown: true };
  const keys = new Set(), hold = {}, axis = { p: 0, r: 0, y: 0 }, yoke = { x: 0, y: 0, sx: 0, sy: 0 };
  let altArmed = false, shownStep = -1; // a selected altitude waits in the window until the autopilot captures it
  let drag = null, frameN = 0, last = 0, toasts = [], timed = [], prevAlertKey = '', prevRA = 1e9, endTimer = 0, deckFrac = 0, atNag = 0, perf = { acc: 0, n: 0 };
  const toR = p => [p[1], -p[2], -p[0]], qR = q => [q[2], -q[3], -q[1], q[0]];
  const pad = (n, w) => { let s = String(Math.round(n)); while (s.length < w) s = '0' + s; return s; };
  const hhmm = h => pad(Math.floor(h) % 24, 2) + ':' + pad(Math.floor((h % 1) * 60), 2);
  const store = { load() { try { const o = JSON.parse(localStorage.getItem('meridian-deck') || '{}'); if (o.done) set.done = o.done; if (o.vol !== undefined) set.vol = o.vol; if (o.invert) set.invert = o.invert; if (o.gfx) set.gfx = o.gfx; } catch (e) { } }, save() { try { localStorage.setItem('meridian-deck', JSON.stringify({ done: set.done, vol: set.vol, invert: set.invert, gfx: set.gfx })); } catch (e) { } } };

  const KEYS = [['W S / ↑ ↓', 'Pitch: S or ↓ pulls the nose up'], ['A D / ← →', 'Roll left and right'], ['Q E', 'Rudder, and nose-wheel steering'], ['R F / + −', 'Throttle up and down'], ['X Z', 'Flaps: extend, retract'], ['G', 'Landing gear'], ['Space', 'Wheel brakes (hold)'], ['B', 'Parking brake'], ['K', 'Speedbrake'], ['P', 'Autopilot'], ['T', 'Autothrottle'], ['C / 1 2 3', 'Camera: cockpit, chase, free'], ['V', 'Show or hide the instruments'], ['[ ]', 'Map range'], ['N', 'Simulation speed'], ['Mouse drag', 'Yoke: drag on the view'], ['Right drag', 'Look around; wheel zooms'], ['Esc', 'Pause and settings']];

  // ---------------------------------------------------------------- toasts and alerts
  function toast(text, secs) { toasts = toasts.filter(t => t.text !== text); toasts.push({ text, until: performance.now() + (secs || 3) * 1000 }); if (toasts.length > 3) toasts.shift(); }
  function timedAlert(text, level, secs) { timed.push({ text, level, until: performance.now() + (secs || 7) * 1000 }); }
  function computeAlerts() {
    const d = sim.d, s = sim.s, A = [], now = performance.now();
    timed = timed.filter(t => t.until > now);
    if (d.stallWarn) A.push({ text: 'STALL', level: 2 });
    const vmo = [350, 255, 235, 215, 205, 190, 180][s.flapIdx];
    if (d.ias * KT > vmo + 6) A.push({ text: s.flapIdx ? 'FLAP OVERSPEED' : 'OVERSPEED', level: 2 });
    if (!d.onGround) {
      let ahead = false;
      if (d.agl < 900 && d.gs > 40) {
        let nearRw = false; for (const a of world.airports) if (FS.segDist(s.pos[0], s.pos[1], a.a, a.b) < 9000) nearRw = true;
        if (!(nearRw && s.gearTarget === 1)) for (const t of [8, 16, 24]) { const h = world.heightAt(s.pos[0] + s.vel[0] * t, s.pos[1] + s.vel[1] * t); if (Math.max(h, 0) > d.alt + d.vs * t - 45) ahead = true; }
      }
      if (d.vs < -7 && d.agl < 600 && d.agl / -d.vs < 7 && !(s.gearTarget === 1 && d.vs > -9)) A.push({ text: 'SINK RATE · PULL UP', level: 2 });
      else if (ahead) A.push({ text: 'TERRAIN AHEAD · PULL UP', level: 2 });
      if (s.gearTarget === 0 && d.agl < 250 && d.vs < 1 && d.ias * KT < 200 && s.airTime > 25) A.push({ text: 'TOO LOW · GEAR', level: 1 });
      if (Math.abs(d.roll) > 40 * D2R) A.push({ text: 'BANK ANGLE', level: 1 });
    } else if (sim.inp.throttle > 0.7 && d.gs < 45) {
      if (s.parkBrake) A.push({ text: 'CONFIG · PARKING BRAKE', level: 1 }); else if (s.flapIdx === 0) A.push({ text: 'CONFIG · FLAPS', level: 1 }); else if (s.spoilerLever) A.push({ text: 'CONFIG · SPEEDBRAKE', level: 1 });
    }
    if (!s.engOn[0]) A.push({ text: 'ENG 1 FAIL', level: 1 }); if (!s.engOn[1]) A.push({ text: 'ENG 2 FAIL', level: 1 });
    if (s.fuel <= 0) A.push({ text: 'FUEL EXHAUSTED', level: 2 }); else if (s.fuel < 1500) A.push({ text: 'FUEL LOW', level: 1 });
    for (const t of timed) A.push({ text: t.text, level: t.level, timed: true });
    return A;
  }
  let alertList = [];
  function renderAlerts() {
    alertList = computeAlerts();
    const key = alertList.filter(a => !a.timed).map(a => a.text).join('|');
    if (key !== prevAlertKey && mode === 'fly') { const prev = prevAlertKey.split('|'); const fresh = alertList.filter(a => !a.timed && prev.indexOf(a.text) < 0); if (fresh.some(a => a.level === 2)) AUDIO.play('warning'); else if (fresh.length) AUDIO.play('caution'); }
    prevAlertKey = key;
    const now = performance.now(); toasts = toasts.filter(t => t.until > now);
    const big = alertList.slice().sort((a, b) => b.level - a.level).slice(0, 3);
    let html = ''; for (const a of big) html += '<div class="alert ' + (a.level === 2 ? 'red' : 'amber') + '">' + a.text + '</div>';
    for (const t of toasts) html += '<div class="alert info">' + t.text + '</div>';
    const el = $('alerts'); if (el._h !== html) { el.innerHTML = html; el._h = html; }
  }

  // ---------------------------------------------------------------- actions
  function action(a) {
    const s = sim.s, ap = sim.ap, d = sim.d;
    if (mode !== 'fly') return;
    switch (a) {
      case 'gear': if (d.onGround && s.gearTarget === 1) toast('Gear lever is locked on the ground'); else { s.gearTarget = 1 - s.gearTarget; AUDIO.play('clunk'); toast(s.gearTarget ? 'Gear down' : 'Gear up'); } break;
      case 'flapDn': if (s.flapIdx < 6) { s.flapIdx++; AUDIO.play('click'); toast('Flaps ' + FS.FLAPS[s.flapIdx].name); } break;
      case 'flapUp': if (s.flapIdx > 0) { s.flapIdx--; AUDIO.play('click'); toast('Flaps ' + FS.FLAPS[s.flapIdx].name); } break;
      case 'park': s.parkBrake = !s.parkBrake; AUDIO.play('click'); toast(s.parkBrake ? 'Parking brake set' : 'Parking brake released'); break;
      case 'spoiler': s.spoilerLever = s.spoilerLever ? 0 : 1; AUDIO.play('click'); toast(s.spoilerLever ? 'Speedbrake extended' : 'Speedbrake retracted'); break;
      case 'ap':
        if (ap.on) { sim.apDisengage(); AUDIO.play('apDisc'); toast('Autopilot off. You have control'); }
        else if (sim.apInop) { AUDIO.play('caution'); toast('Autopilot is inoperative'); }
        else if (d.onGround) toast('The autopilot engages once airborne');
        else { const selAlt = ap.alt; sim.apEngage(false); if (altArmed) ap.alt = selAlt; AUDIO.play('click'); toast('Autopilot on: heading ' + pad(ap.hdg, 3) + ', altitude ' + Math.round(ap.alt * FT / 100) * 100 + ' ft'); }
        break;
      case 'at': if (ap.at) { ap.at = false; toast('Autothrottle off'); } else if (sim.apInop) { AUDIO.play('caution'); toast('Autothrottle is inoperative'); } else { sim.atEngage(); toast('Autothrottle holding ' + Math.round(ap.spd * KT) + ' kt'); } AUDIO.play('click'); break;
      case 'nav':
        if (!sim.nav.route.length) { toast('No route loaded for this flight'); break; }
        if (!ap.on) { if (sim.apInop || d.onGround) { toast(d.onGround ? 'The autopilot engages once airborne' : 'Autopilot is inoperative'); break; } { const a0 = ap.alt; sim.apEngage(false); if (altArmed) ap.alt = a0; } }
        if (ap.lat === 'NAV') { ap.lat = 'HDG'; ap.hdg = Math.round(d.hdg); } else { ap.lat = 'NAV'; ap.locCap = false; } AUDIO.play('click'); break;
      case 'app':
        if (!sim.nav.ils) { toast('No ILS tuned'); break; }
        if (!ap.on) { if (sim.apInop || d.onGround) { toast(d.onGround ? 'The autopilot engages once airborne' : 'Autopilot is inoperative'); break; } { const a0 = ap.alt; sim.apEngage(false); if (altArmed) ap.alt = a0; } }
        ap.appArmed = !ap.appArmed; if (!ap.appArmed) { ap.locCap = ap.gsCap = ap.flare = false; if (ap.lat === 'LOC') { ap.lat = 'HDG'; ap.hdg = Math.round(d.hdg); } if (ap.vert === 'GS') { ap.vert = 'ALT'; ap.alt = d.alt; } }
        toast(ap.appArmed ? 'Approach armed for ' + sim.nav.ils.id : 'Approach disarmed'); AUDIO.play('click'); break;
      case 'hdgSel': if (ap.on) { ap.lat = 'HDG'; ap.locCap = false; } AUDIO.play('click'); break;
      case 'altHold': if (ap.on && ap.vert !== 'GS') { ap.vert = 'ALT'; } AUDIO.play('click'); break;
      case 'vsMode': if (ap.on && ap.vert !== 'GS') { ap.vert = 'VS'; ap.vs = Math.round(d.vs * 196.85 / 100) * 100 / 196.85; } AUDIO.play('click'); break;
    }
  }
  function adjust(what, dlt) {
    const ap = sim.ap;
    if (what === 'spd') ap.spd = clamp(Math.round(ap.spd * KT / 5) * 5 + dlt, 110, 340) / KT;
    else if (what === 'hdg') ap.hdg = wrap360(Math.round(ap.hdg / 5) * 5 + dlt);
    else if (what === 'alt') { ap.alt = clamp(Math.round(ap.alt * FT / 500) * 500 + dlt, 0, 41000) / FT; altArmed = true; }
    else if (what === 'vs') { ap.vs = clamp(Math.round(ap.vs * 196.85 / 100) * 100 + dlt, -4000, 4000) / 196.85; if (ap.on && ap.vert !== 'GS') ap.vert = 'VS'; }
    AUDIO.play('click');
  }

  // ---------------------------------------------------------------- input
  function readInput(dt) {
    const k = c => keys.has(c), inp = sim.inp;
    const tp = ((k('KeyS') || k('ArrowDown')) ? 1 : 0) - ((k('KeyW') || k('ArrowUp')) ? 1 : 0);
    const tr = ((k('KeyD') || k('ArrowRight')) ? 1 : 0) - ((k('KeyA') || k('ArrowLeft')) ? 1 : 0);
    const ty = ((k('KeyE') || hold.rudR) ? 1 : 0) - ((k('KeyQ') || hold.rudL) ? 1 : 0);
    const ramp = (v, t) => v + clamp(t - v, -(t === 0 ? 3.4 : 1.9) * dt, (t === 0 ? 3.4 : 1.9) * dt);
    axis.p = ramp(axis.p, tp * set.invert); axis.r = ramp(axis.r, tr); axis.y = ramp(axis.y, ty);
    inp.pitch = clamp(axis.p * 0.85 + yoke.y, -1, 1); inp.roll = clamp(axis.r * 0.9 + yoke.x, -1, 1); inp.yaw = axis.y;
    const th = ((k('KeyR') || k('Equal') || k('NumpadAdd') || hold.thrUp) ? 1 : 0) - ((k('KeyF') || k('Minus') || k('NumpadSubtract') || hold.thrDn) ? 1 : 0);
    if (th) { if (sim.ap.at) { if (performance.now() - atNag > 4000) { atNag = performance.now(); toast('Autothrottle is holding speed. Press T to take the throttles'); } } else inp.throttle = clamp(inp.throttle + th * 0.42 * dt, 0, 1); }
    inp.brake = (k('Space') || hold.brake) ? 1 : 0;
  }
  window.addEventListener('keydown', e => {
    if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) { if (e.code === 'Escape') e.target.blur(); else return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const c = e.code;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(c) >= 0 && mode === 'fly') e.preventDefault();
    if (c === 'Escape') { if (mode === 'fly') pause(true); else if (mode === 'pause') pause(false); return; }
    if (c === 'Space' && e.target && e.target.tagName === 'BUTTON' && mode === 'fly') e.target.blur();
    if (keys.has(c)) return; keys.add(c);
    if (mode !== 'fly') return;
    AUDIO.init();
    const map = { KeyG: 'gear', KeyX: 'flapDn', KeyZ: 'flapUp', KeyB: 'park', KeyK: 'spoiler', KeyP: 'ap', KeyT: 'at' };
    if (map[c]) action(map[c]);
    else if (c === 'KeyC') setCam(cam.mode === 'cockpit' ? 'chase' : cam.mode === 'chase' ? 'free' : 'cockpit');
    else if (c === 'Digit1') setCam('cockpit'); else if (c === 'Digit2') setCam('chase'); else if (c === 'Digit3') setCam('free');
    else if (c === 'KeyV') togglePanel(); else if (c === 'KeyH') toggleHelp(); else if (c === 'KeyM') toggleSound(); else if (c === 'KeyN') cycleRate();
    else if (c === 'BracketLeft') { set.range = Math.max(5, set.range / 2); } else if (c === 'BracketRight') { set.range = Math.min(80, set.range * 2); }
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); for (const h in hold) hold[h] = false; yoke.x = yoke.y = 0; drag = null; });

  canvas.addEventListener('pointerdown', e => {
    if (mode !== 'fly' && mode !== 'menu') return; AUDIO.init();
    try { canvas.setPointerCapture(e.pointerId); } catch (x) { }
    const look = e.button === 2 || e.button === 1 || cam.mode === 'free' || e.shiftKey || mode === 'menu';
    drag = { id: e.pointerId, look, x: e.clientX, y: e.clientY }; if (!look) { yoke.sx = e.clientX; yoke.sy = e.clientY; }
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (drag.look) {
      drag.x = e.clientX; drag.y = e.clientY;
      if (cam.mode === 'cockpit') { cam.lookYaw = clamp(cam.lookYaw + dx * 0.0035, -2.3, 2.3); cam.lookPitch = clamp(cam.lookPitch - dy * 0.0035, -0.8, 0.8); }
      else if (cam.mode === 'chase') { cam.yaw = wrapPi(cam.yaw - dx * 0.005); cam.pitch = clamp(cam.pitch + dy * 0.004, -0.25, 1.35); }
      else { cam.freeYaw = wrapPi(cam.freeYaw - dx * 0.005); cam.freePitch = clamp(cam.freePitch + dy * 0.004, -0.3, 1.4); }
    } else { yoke.x = clamp((e.clientX - yoke.sx) / 120, -1, 1); yoke.y = clamp((e.clientY - yoke.sy) / 120, -1, 1); }
  });
  const endDrag = e => { if (drag && e.pointerId === drag.id) { drag = null; yoke.x = yoke.y = 0; } };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('dblclick', () => { cam.lookYaw = cam.lookPitch = 0; cam.yaw = 0; cam.pitch = 0.17; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); const f = Math.exp(e.deltaY * 0.0012); if (cam.mode === 'cockpit') cam.fovC = clamp(cam.fovC * f, 32, 80); else if (cam.mode === 'chase') cam.dist = clamp(cam.dist * f, 45, 600); else cam.freeDist = clamp(cam.freeDist * f, 40, 2500); }, { passive: false });

  // ---------------------------------------------------------------- cameras
  function setCam(m, instant) {
    if (m === cam.mode && !instant) return;
    cam.from = { off: V3.sub(cam.pos, toR(sim.s.pos)), q: cam.q.slice(), fov: cam.fov, shift: cam.shift };
    cam.t = instant ? 1 : 0; cam.mode = m; if (m === 'chase') { cam.hdg = sim.d.hdg * D2R; }
    syncView();
  }
  function syncView() {
    document.querySelectorAll('#cams button').forEach(b => b.classList.toggle('on', b.dataset.cam === cam.mode));
    const vis = mode === 'fly', full = !!set.panel[cam.mode]; // outside the cockpit the deck folds down to the autopilot row
    $('deck').hidden = !vis; $('deck').classList.toggle('compact', !full); $('b-panel').classList.toggle('on', full);
    $('frame').classList.toggle('on', mode === 'fly' && cam.mode === 'cockpit');
    const app = $('app').getBoundingClientRect(), dk = $('deck').getBoundingClientRect();
    deckFrac = vis && app.height > 0 ? Math.min(0.6, (app.bottom - dk.top) / app.height) : 0;
  }
  function togglePanel() { set.panel[cam.mode] = !set.panel[cam.mode]; syncView(); }
  function cameraPose(dt) {
    const s = sim.s, d = sim.d, acPos = toR(s.pos), acQ = qR(s.q); let off, q, fov, near, show = true;
    const tt = performance.now() / 1000;
    if (cam.mode === 'cockpit') {
      off = Q4.rot(acQ, [-0.55, 1.12, -24.5]);
      q = Q4.mul(acQ, Q4.mul(Q4.axis([0, 1, 0], -cam.lookYaw), Q4.axis([1, 0, 0], cam.lookPitch)));
      const amp = (d.stallWarn ? 0.004 : 0) + (d.onGround ? Math.min(1, d.gs / 70) * 0.0013 : 0) + Math.min(0.004, Math.hypot(sim.gust[0], sim.gust[1], sim.gust[2]) * 0.00035);
      q = Q4.mul(q, Q4.mul(Q4.axis([1, 0, 0], amp * Math.sin(tt * 31) * Math.sin(tt * 7.3)), Q4.axis([0, 0, 1], amp * 0.7 * Math.sin(tt * 23 + 1))));
      fov = cam.fovC * D2R; near = 1.2; show = false;
    } else {
      let yawW, pitch, dist;
      if (cam.mode === 'chase') { cam.hdg += wrapPi(d.hdg * D2R - cam.hdg) * Math.min(1, dt * 2.4); yawW = cam.hdg + cam.yaw; pitch = cam.pitch; dist = cam.dist; }
      else { yawW = cam.freeYaw; pitch = cam.freePitch; dist = cam.freeDist; }
      off = [-Math.sin(yawW) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yawW) * Math.cos(pitch) * dist];
      const tgt = [0, 3 + dist * 0.035, 0];
      q = Q4.look(V3.norm(V3.sub(tgt, off)), [0, 1, 0]); fov = 52 * D2R; near = 3;
    }
    let shift = deckFrac;
    if (cam.t < 1 && cam.from) {
      cam.t = Math.min(1, cam.t + dt / 1.15); const e = sstep(0, 1, cam.t);
      off = V3.lerp(cam.from.off, off, e); q = Q4.slerp(cam.from.q, q, e); fov = cam.from.fov + (fov - cam.from.fov) * e; shift = cam.from.shift + (shift - cam.from.shift) * e;
      show = show || e < 0.93; near = Math.min(near, 1.2);
    }
    const pos = V3.add(acPos, off);
    const g = Math.max(world.heightAt(-pos[2], pos[0]), 0) + 1.6; if (pos[1] < g) pos[1] = g;
    cam.pos = pos; cam.q = q; cam.fov = fov; cam.shift = shift; cam.shown = show;
    return { pos, q, fov, near, shift, acPos, acQ, show };
  }

  // ---------------------------------------------------------------- weather effects
  function strike(near) {
    env.flash = 1; env.pulse = 0.13;
    const az = Math.random() * 6.283, dist = near ? 500 + Math.random() * 600 : 2500 + Math.random() * 6500, wx = sim.weather;
    let x = cam.pos[0] + Math.sin(az) * dist, z = cam.pos[2] + Math.cos(az) * dist; const top = Math.max(wx.base + 500, cam.pos[1] + 700), gnd = Math.max(world.heightAt(-z, x), 0), pts = [];
    for (let i = 0; i <= 30; i++) { const t = i / 30; x += (Math.random() - 0.5) * 90; z += (Math.random() - 0.5) * 90; pts.push([x, top + (gnd - top) * t, z]); }
    env.bolt = pts; env.boltT = 0.22;
    AUDIO.play('thunder', Math.min(7, dist / 340), near);
    if (near) { $('flash').style.opacity = 0.75; setTimeout(() => { $('flash').style.opacity = 0; }, 90); }
  }

  // ---------------------------------------------------------------- simulation step
  function simulate(dt, rdt) {
    if (mode === 'fly') readInput(rdt);
    const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
    for (let i = 0; i < n; i++) sim.step(h);
    env.hour = (env.hour + dt * env.rate / 3600) % 24;
    const d = sim.d, s = sim.s;
    for (const ev of sim.events.splice(0)) {
      if (ev.type === 'touchdown') { AUDIO.play('touchdown', Math.abs(ev.vs)); if (mode === 'fly') toast(ev.water ? 'Ditched on the water' : 'Touchdown at ' + Math.round(ev.vs * 196.85) + ' fpm', 5); }
      else if (ev.type === 'alert') { timedAlert(ev.text.split(' — ')[0], 1, 8); if (ev.text.indexOf(' — ') > 0) toast(ev.text.split(' — ')[1], 7); AUDIO.play(/AUTOPILOT/.test(ev.text) ? 'apDisc' : 'warning'); }
      else if (ev.type === 'msg') { toast(ev.text); AUDIO.play('wp'); }
      else if (ev.type === 'lightning') strike(true);
      else if (ev.type === 'crash') { AUDIO.play('crash'); $('flash').style.opacity = 0.9; setTimeout(() => { $('flash').style.opacity = 0; }, 160); }
    }
    if (sim.weather.storm > 0.5) { env.nextStrike -= dt; if (env.nextStrike <= 0) { strike(false); env.nextStrike = 2.5 + Math.random() * 8; } }
    if (env.pulse > 0) { env.pulse -= dt; if (env.pulse <= 0) env.flash = Math.max(env.flash, 0.7); }
    env.flash *= Math.exp(-dt * 10); if (env.boltT > 0) { env.boltT -= dt; if (env.boltT <= 0) env.bolt = null; }
    if (sim.ap.on && Math.abs(sim.ap.alt - d.alt) < 60) altArmed = false;
    if (mode === 'fly') {
      // radio-altitude callouts on the way down
      const ra = d.agl * FT; if (d.vs < -0.5 && s.gearTarget === 1 && !d.onGround) for (const c of [[1000, 'one thousand'], [500, 'five hundred'], [200, 'minimums'], [100, 'one hundred'], [50, 'fifty'], [30, 'thirty'], [20, 'twenty'], [10, 'ten']]) if (prevRA > c[0] && ra <= c[0]) { AUDIO.say(c[1]); break; }
      prevRA = ra;
      if (run) {
        for (const ev of run.update(dt)) {
          if (ev.type === 'step') { AUDIO.play('chime'); renderSteps(); }
          else if (ev.type === 'wp') { toast('Passing ' + ev.name); AUDIO.play('wp'); }
        }
        if (run.state !== 'flying' && !endTimer) endTimer = performance.now() + (run.state === 'done' ? 1600 : 2200);
        if (run.def.free && d.onGround && d.gs < 1 && sim.lastTouch && !run.ctx.rep && s.airTime > 20) { run.ctx.rep = true; const r = MISSIONS.landingReport(sim); if (r) toast('Landing score ' + r.score + ' / 100 · ' + r.grade, 8); }
        if (run.def.free && !d.onGround) run.ctx.rep = false;
      }
    } else if (mode === 'menu') {
      cam.freeYaw = wrapPi(cam.freeYaw + dt * 0.05);
      if (sim.crashed || Math.abs(s.pos[0]) > 50000 || Math.abs(s.pos[1]) > 50000) attract();
    }
  }

  // ---------------------------------------------------------------- HUD
  function renderSteps() {
    const def = run.def, ol = $('steps'); let h = ''; shownStep = run.step;
    if (def.free) h = '<li class="now"><div>Fly where you like. Every runway has an ILS: press APP on the autopilot panel to use it.<span class="hint">H shows the controls</span></div></li>';
    def.steps.forEach((st, i) => { h += '<li class="' + (i < run.step ? 'done' : i === run.step ? 'now' : '') + '"><div>' + st.t + '<span class="hint">' + st.k + '</span></div></li>'; });
    ol.innerHTML = h; $('m-kicker').textContent = def.kicker + (def.steps.length ? ' · ' + Math.min(run.step + 1, def.steps.length) + ' of ' + def.steps.length : ''); $('m-title').textContent = def.title;
  }
  const setVal = (id, v, unit) => { const el = $(id), h = v + (unit ? '<small>' + unit + '</small>' : ''); if (el._h !== h) { el.innerHTML = h; el._h = h; } };
  function renderDash() {
    const d = sim.d, s = sim.s, ap = sim.ap;
    setVal('d-alt', String(Math.round(d.alt * FT / 10) * 10), 'FT'); setVal('d-ias', String(Math.round(d.ias * KT)), 'KT'); setVal('d-hdg', pad(wrap360(d.hdg) < 0.5 ? 360 : d.hdg, 3), '°M');
    const vs = Math.round(d.vs * 196.85 / 50) * 50; setVal('d-vs', (vs > 0 ? '+' : '') + vs, 'FPM'); setVal('d-thr', String(Math.round(sim.inp.throttle * 100)), '%');
    setVal('d-fuel', String(Math.round(s.fuel / 10) * 10), 'KG'); setVal('d-time', pad(Math.floor(s.t / 60), 2) + ':' + pad(Math.floor(s.t % 60), 2)); setVal('d-dist', (s.dist / NM).toFixed(1), 'NM');
    const chip = (id, text, cls) => { const el = $(id); if (el.textContent !== text) el.textContent = text; el.className = 'chip ' + (cls || ''); };
    chip('c-gear', s.gear > 0.98 ? 'GEAR DN' : s.gear < 0.02 ? 'GEAR UP' : 'GEAR …', s.gear > 0.98 ? 'on' : s.gear < 0.02 ? '' : 'warn');
    chip('c-flap', 'FLAPS ' + FS.FLAPS[s.flapIdx].name, s.flapIdx ? 'on' : ''); chip('c-brk', 'PARK BRK', s.parkBrake ? 'warn' : ''); chip('c-spd', 'SPD BRK', s.spoiler > 0.1 ? 'warn' : ''); chip('c-ap', ap.on ? 'A/P ' + ap.lat : 'A/P', ap.on ? 'on' : '');
    const txt = (id, t) => { const el = $(id); if (el.textContent !== t) el.textContent = t; };
    txt('l-spd', String(Math.round(ap.spd * KT))); txt('l-hdg', pad(wrap360(ap.hdg) < 0.5 ? 360 : ap.hdg, 3)); txt('l-alt', String(Math.round(ap.alt * FT / 100) * 100)); const v = Math.round(ap.vs * 196.85 / 100) * 100; txt('l-vs', (v > 0 ? '+' : '') + v);
    $('k-at').classList.toggle('on', ap.at); $('k-ap').classList.toggle('on', ap.on); $('k-nav').classList.toggle('on', ap.on && ap.lat === 'NAV');
    $('k-app').classList.toggle('on', ap.locCap); $('k-app').classList.toggle('armed', ap.appArmed && !ap.locCap);
    txt('k-ap', ap.on ? 'A/P on' : 'A/P engage');
  }

  // ---------------------------------------------------------------- flow
  function attract() {
    sim.reset(); sim.apInop = false; sim.weather = Object.assign({}, FS.WEATHER.scattered); sim.s.fuel = 30000;
    sim.placeInAir({ n: -15500, e: -27000, alt: 820, hdg: 78, ias: 118, ap: true }); run = null; env.hour = 17.35; env.rate = 1;
  }
  function showOnly(id) { for (const o of ['menu', 'pause', 'debrief']) $(o).hidden = o !== id; }
  function toMenu() { mode = 'menu'; endTimer = 0; attract(); cam.mode = 'free'; cam.t = 1; cam.freeDist = 125; cam.freePitch = 0.2; $('ui').hidden = true; $('help').hidden = true; showOnly('menu'); syncView(); buildMenu(); }
  function startMission(def, opts) {
    lastDef = def; lastOpts = opts || {}; AUDIO.init();
    run = new MISSIONS.Run(def, sim, lastOpts); env.hour = lastOpts.time !== undefined ? lastOpts.time : def.time; env.rate = def.timeRate;
    if (sim.d.onGround) { sim.ap.hdg = Math.round(sim.d.hdg); sim.ap.alt = (def.cruise || 5000) / FT; sim.ap.spd = 250 / KT; altArmed = true; } else { altArmed = false; if (!sim.ap.on) { sim.ap.hdg = Math.round(sim.d.hdg); sim.ap.alt = Math.round(sim.d.alt * FT / 100) * 100 / FT; } } // autopilot windows preset for the departure
    axis.p = axis.r = axis.y = 0; yoke.x = yoke.y = 0; keys.clear(); toasts = []; timed = []; prevAlertKey = ''; prevRA = 1e9; endTimer = 0; set.simRate = 1; $('b-rate').textContent = '1×';
    mode = 'fly'; $('ui').hidden = false; showOnly(null);
    cam.lookYaw = cam.lookPitch = 0; cam.yaw = 0; cam.pitch = 0.17; cam.dist = 95;
    const start = def.id === 'storm' || def.id === 'minimums' ? 'cockpit' : 'chase';
    cam.from = { off: V3.sub(cam.pos, toR(sim.s.pos)), q: cam.q.slice(), fov: cam.fov, shift: 0 }; cam.mode = start; cam.hdg = sim.d.hdg * D2R; cam.t = 1; cameraPose(0.016);
    renderSteps(); syncView(); renderDash();
    toast(def.title + ' · ' + hhmm(env.hour) + ' · ' + sim.weather.name, 5);
  }
  function pause(on) {
    if (on) { mode = 'pause'; $('p-title').textContent = run ? run.def.title : 'Flight paused'; $('s-time').value = Math.round(env.hour * 4) / 4; $('s-time-v').textContent = hhmm(env.hour); $('s-wx').value = wxKey(sim.weather); showOnly('pause'); }
    else { mode = 'fly'; showOnly(null); last = performance.now(); }
  }
  const wxKey = w => Object.keys(FS.WEATHER).find(k => FS.WEATHER[k].name === w.name) || 'clear';
  function debrief() {
    const ok = run.state === 'done', def = run.def; mode = 'debrief';
    if (ok) { set.done[def.id] = true; store.save(); AUDIO.play('success'); }
    $('r-kicker').textContent = def.kicker; $('r-title').textContent = ok ? 'Mission complete' : (sim.crashed ? 'Aircraft lost' : 'Mission failed'); $('r-title').className = ok ? 'status-ok' : 'status-bad';
    $('r-text').textContent = ok ? def.title + ' flown in ' + Math.floor(sim.s.t / 60) + ' min ' + pad(Math.floor(sim.s.t % 60), 2) + ' s.' : run.failReason + '.';
    let h = ''; for (const l of (ok || sim.lastTouch ? run.results() : [])) h += '<div><span>' + l[0] + '</span><b>' + l[1] + '</b></div>'; $('r-lines').innerHTML = h;
    const i = MISSIONS.list.indexOf(def), nxt = MISSIONS.list[i + 1]; $('r-next').hidden = !(ok && nxt); $('r-next').textContent = nxt ? 'Next: ' + nxt.title : '';
    showOnly('debrief');
  }
  function toggleHelp() { $('help').hidden = !$('help').hidden; }
  function toggleSound() { AUDIO.init(); AUDIO.setOn(!AUDIO.on); $('b-sound').classList.toggle('on', AUDIO.on); toast(AUDIO.on ? 'Sound on' : 'Sound off'); }
  function cycleRate() { set.simRate = set.simRate === 1 ? 2 : set.simRate === 2 ? 4 : 1; $('b-rate').textContent = set.simRate + '×'; $('b-rate').classList.toggle('on', set.simRate > 1); }

  // ---------------------------------------------------------------- menu
  let sel = 0;
  function buildMenu() {
    const ol = $('mlist'); ol.innerHTML = '';
    MISSIONS.list.forEach((m, i) => { const li = document.createElement('li'), b = document.createElement('button'); b.className = (i === sel ? 'sel ' : '') + (set.done[m.id] ? 'done' : ''); b.innerHTML = '<span class="num">' + pad(i + 1, 2) + '</span><span class="ttl">' + m.title + '</span><span class="sub">' + m.kicker + ' · ' + m.airport + '</span>'; b.addEventListener('click', () => { sel = i; buildMenu(); }); li.appendChild(b); ol.appendChild(li); });
    const m = MISSIONS.list[sel], wx = FS.WEATHER[m.free ? $('o-wx').value || m.wx : m.wx];
    $('b-kicker').textContent = 'Mission ' + pad(sel + 1, 2) + ' · ' + m.kicker; $('b-title').textContent = m.title; $('b-text').textContent = m.brief;
    $('b-opts').hidden = !m.free; const hr = m.free ? parseFloat($('o-time').value) : m.time;
    $('b-time').textContent = hhmm(hr); $('b-wx').textContent = wx.name; $('b-wind').textContent = pad(wx.windDir, 3) + '° / ' + Math.round(wx.windSpd * KT) + ' kt'; $('o-time-v').textContent = hhmm(hr);
  }
  function fillSelects() {
    for (const a of world.airports) for (const rc of [0, 1]) { const o = document.createElement('option'); o.value = a.id + ':' + rc; o.textContent = a.name + ' · RWY ' + FS.runwayName(a.hdg + rc * 180); $('o-ap').appendChild(o); }
    for (const id of ['o-wx', 's-wx']) for (const k in FS.WEATHER) { const o = document.createElement('option'); o.value = k; o.textContent = FS.WEATHER[k].name; $(id).appendChild(o); }
    $('o-wx').value = 'scattered';
    const kh = KEYS.map(k => '<div><kbd>' + k[0] + '</kbd><span>' + k[1] + '</span></div>').join(''); $('menu-keys').innerHTML = kh; $('help-keys').innerHTML = kh;
  }
  function bindUI() {
    $('b-fly').addEventListener('click', () => { const m = MISSIONS.list[sel], o = {}; if (m.free) { const v = $('o-ap').value.split(':'); o.ap = v[0]; o.recip = v[1] === '1'; o.wx = $('o-wx').value; o.time = parseFloat($('o-time').value); } startMission(m, o); });
    $('o-wx').addEventListener('change', buildMenu); $('o-time').addEventListener('input', buildMenu);
    document.querySelectorAll('#cams button').forEach(b => b.addEventListener('click', () => { setCam(b.dataset.cam); b.blur(); }));
    $('b-panel').addEventListener('click', e => { togglePanel(); e.currentTarget.blur(); }); $('b-rate').addEventListener('click', e => { cycleRate(); e.currentTarget.blur(); });
    $('b-sound').addEventListener('click', e => { toggleSound(); e.currentTarget.blur(); }); $('b-help').addEventListener('click', e => { toggleHelp(); e.currentTarget.blur(); }); $('b-pause').addEventListener('click', () => pause(true));
    $('p-resume').addEventListener('click', () => pause(false)); $('p-restart').addEventListener('click', () => startMission(lastDef, lastOpts)); $('p-menu').addEventListener('click', toMenu);
    $('r-again').addEventListener('click', () => startMission(lastDef, lastOpts)); $('r-menu').addEventListener('click', toMenu);
    $('r-next').addEventListener('click', () => { const i = MISSIONS.list.indexOf(lastDef); sel = i + 1; startMission(MISSIONS.list[i + 1], {}); });
    $('s-wx').addEventListener('change', e => { sim.weather = Object.assign({}, FS.WEATHER[e.target.value]); });
    $('s-time').addEventListener('input', e => { env.hour = parseFloat(e.target.value); $('s-time-v').textContent = hhmm(env.hour); });
    $('s-vol').addEventListener('input', e => { set.vol = parseFloat(e.target.value); AUDIO.setVol(set.vol); store.save(); });
    $('s-gfx').addEventListener('change', e => { set.gfx = e.target.value; if (set.gfx !== 'auto') { set.scale = parseFloat(set.gfx); scene.resize(set.scale); } store.save(); });
    $('s-inv').addEventListener('change', e => { set.invert = parseInt(e.target.value, 10); store.save(); });
    $('s-vol').value = set.vol; $('s-gfx').value = set.gfx; $('s-inv').value = String(set.invert); $('b-sound').classList.add('on');
    $('k-ap').addEventListener('click', e => { action('ap'); e.currentTarget.blur(); }); $('k-at').addEventListener('click', e => { action('at'); e.currentTarget.blur(); });
    $('k-nav').addEventListener('click', e => { action('nav'); e.currentTarget.blur(); }); $('k-app').addEventListener('click', e => { action('app'); e.currentTarget.blur(); });
    $('l-hdg').addEventListener('click', e => { action('hdgSel'); e.currentTarget.blur(); }); $('l-alt').addEventListener('click', e => { action('altHold'); e.currentTarget.blur(); }); $('l-vs').addEventListener('click', e => { action('vsMode'); e.currentTarget.blur(); });
    document.querySelectorAll('.adj').forEach(b => {
      let tm = 0, iv = 0; const stop = () => { clearTimeout(tm); clearInterval(iv); };
      b.addEventListener('pointerdown', e => { e.preventDefault(); adjust(b.dataset.adj, parseFloat(b.dataset.d)); stop(); tm = setTimeout(() => { iv = setInterval(() => adjust(b.dataset.adj, parseFloat(b.dataset.d)), 80); }, 380); });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
      b.addEventListener('keydown', e => { if (e.code === 'Enter') adjust(b.dataset.adj, parseFloat(b.dataset.d)); });
    });
    document.querySelectorAll('#touch button').forEach(b => {
      if (b.dataset.hold) { b.addEventListener('pointerdown', e => { e.preventDefault(); hold[b.dataset.hold] = true; }); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { hold[b.dataset.hold] = false; }); }
      else b.addEventListener('click', () => action(b.dataset.tap));
    });
    window.addEventListener('resize', syncView);
  }

  // ---------------------------------------------------------------- main loop
  function loop(t) {
    requestAnimationFrame(loop);
    const rdt = Math.min(0.1, Math.max(0.001, (t - last) / 1000)); last = t; frameN++;
    if (mode === 'fly') simulate(rdt * set.simRate, rdt); else if (mode === 'menu') simulate(rdt, rdt);
    if (mode === 'fly' && endTimer && performance.now() > endTimer) { endTimer = 0; debrief(); }
    const moving = mode === 'fly' || mode === 'menu';
    const c = cameraPose(moving ? rdt : 0);
    scene.render({ cam: c, ac: { pos: c.acPos, q: c.acQ, vel: toR(sim.s.vel) }, sim, hour: env.hour, wx: sim.weather, dt: moving ? rdt * (mode === 'fly' ? Math.min(set.simRate, 2) : 1) : 0, showAircraft: c.show, flash: env.flash, bolt: env.bolt });
    if (mode === 'fly' || mode === 'pause' || mode === 'debrief') {
      if (!$('deck').hidden && set.panel[cam.mode]) { PANEL.pfd($('pfd'), sim); if (frameN % 2 === 0) PANEL.nd($('nd'), sim, { range: set.range, now: t / 1000 }); else PANEL.eicas($('eicas'), sim, alertList); }
      if (frameN % 6 === 0) { renderDash(); renderAlerts(); if (run && run.step !== shownStep) renderSteps(); }
    }
    const s = sim.s, d = sim.d;
    AUDIO.update({ n1: s.n1, ias: d.ias, gs: d.gs, onGround: d.onGround, cockpit: cam.mode === 'cockpit' && cam.t > 0.5, rain: cam.pos[1] < sim.weather.top ? sim.weather.rain : 0, moving: (s.gear > 0.02 && s.gear < 0.98) || Math.abs(FS.FLAPS[s.flapIdx].deg - s.flapDeg) > 0.2, stall: d.stallWarn && mode === 'fly', drag: s.gear * 0.5 + s.flapDeg / 30 * 0.5 + s.spoiler, paused: mode === 'pause' || mode === 'debrief' || mode === 'menu' });
    // adaptive resolution
    if (set.gfx === 'auto' && moving) { perf.acc += rdt; perf.n++; if (perf.n >= 90) { const avg = perf.acc / perf.n; if (avg > 0.027 && set.scale > 0.5) { set.scale = Math.max(0.5, set.scale - 0.12); scene.resize(set.scale); } else if (avg < 0.0125 && set.scale < 1) { set.scale = Math.min(1, set.scale + 0.06); scene.resize(set.scale); } perf.acc = 0; perf.n = 0; } }
  }

  function boot() {
    try { world = FS.buildWorld(); scene = createScene(canvas, world); } catch (e) { console.error(e); scene = null; $('load-msg').textContent = 'Could not start the 3D view: ' + e.message; return; }
    if (!scene) { $('load-msg').textContent = 'This simulator needs WebGL 2, which this browser or device does not provide.'; return; }
    sim = new FS.Sim(world); store.load(); AUDIO.setVol(set.vol);
    if (set.gfx !== 'auto') { set.scale = parseFloat(set.gfx); scene.resize(set.scale); }
    fillSelects(); bindUI(); attract(); cameraPose(0.016); buildMenu(); showOnly('menu'); syncView(); mode = 'menu'; $('loading').hidden = true;
    window.__sim = { get sim() { return sim; }, get run() { return run; }, startMission, MISSIONS, setCam, env, cam, action, pause, get mode() { return mode; } };
    last = performance.now(); requestAnimationFrame(loop);
  }
  setTimeout(boot, 40);
})();
