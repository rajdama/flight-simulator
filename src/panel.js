'use strict';
/* Glass-cockpit instruments drawn on 2D canvases: PFD, navigation display, engine display.
   Colour conventions follow Boeing practice: green = engaged, magenta = selected targets,
   white = current values, cyan = navaids, amber = caution, red = warning. */
const PANEL = (function () {
  const { KT, FT, D2R, R2D, NM, clamp, wrapPi, wrap360 } = FS;
  const C = { white: '#eef3f7', green: '#3df58a', mag: '#ff6bf2', cyan: '#55d8ff', amber: '#ffb52e', red: '#ff4b3e', dim: '#7d8a99', bg: '#06090c', sky: '#2b7fd4', gnd: '#8a5a2a', tape: 'rgba(22,30,38,0.86)' };
  const MONO = '"B612 Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const font = (ctx, px, bold) => { ctx.font = (bold ? '700 ' : '') + px + 'px ' + MONO; };
  const txt = (ctx, s, x, y, col, align, base) => { ctx.fillStyle = col || C.white; ctx.textAlign = align || 'center'; ctx.textBaseline = base || 'middle'; ctx.fillText(s, x, y); };
  const line = (ctx, x0, y0, x1, y1) => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
  const pad = (n, w) => { let s = String(Math.round(n)); while (s.length < w) s = '0' + s; return s; };
  function fit(cv) { const dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr); if (w < 4 || h < 4) return null; if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } return { w, h }; }

  // ------------------------------------------------------------ PFD
  function pfd(cv, sim) {
    const sz = fit(cv); if (!sz) return; const ctx = cv.getContext('2d'), w = sz.w, h = sz.h, d = sim.d, ap = sim.ap, u = Math.min(w, h) / 100;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
    const ax0 = w * 0.235, ax1 = w * 0.735, ay0 = h * 0.15, ay1 = h * 0.70, acx = (ax0 + ax1) / 2, acy = (ay0 + ay1) / 2, aw = ax1 - ax0, ah = ay1 - ay0;
    // ---- attitude
    ctx.save();
    ctx.beginPath(); const r = 6 * u; ctx.moveTo(ax0 + r, ay0); ctx.arcTo(ax1, ay0, ax1, ay1, r); ctx.arcTo(ax1, ay1, ax0, ay1, r); ctx.arcTo(ax0, ay1, ax0, ay0, r); ctx.arcTo(ax0, ay0, ax1, ay0, r); ctx.clip();
    const ppd = ah / 44; // pixels per degree of pitch
    ctx.translate(acx, acy); ctx.rotate(-d.roll); ctx.translate(0, d.pitch * R2D * ppd);
    ctx.fillStyle = C.sky; ctx.fillRect(-w * 2, -h * 4, w * 4, h * 4); ctx.fillStyle = C.gnd; ctx.fillRect(-w * 2, 0, w * 4, h * 4);
    ctx.strokeStyle = C.white; ctx.lineWidth = 0.5 * u; line(ctx, -w * 2, 0, w * 2, 0);
    font(ctx, 3.3 * u);
    for (let p = -90; p <= 90; p += 2.5) {
      if (p === 0) continue; const y = -p * ppd, len = p % 10 === 0 ? aw * 0.17 : p % 5 === 0 ? aw * 0.09 : aw * 0.045;
      ctx.lineWidth = 0.4 * u; line(ctx, -len, y, len, y);
      if (p % 10 === 0) { txt(ctx, String(Math.abs(p)), -len - 3.2 * u, y); txt(ctx, String(Math.abs(p)), len + 3.2 * u, y); }
    }
    ctx.restore();
    // bank scale and pointer
    ctx.save(); ctx.translate(acx, acy);
    const br = ah * 0.44; ctx.strokeStyle = C.white; ctx.lineWidth = 0.45 * u;
    for (const a of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) { const t = a * D2R, l = Math.abs(a) === 30 || Math.abs(a) === 60 ? 3.2 * u : 1.8 * u; line(ctx, Math.sin(t) * br, -Math.cos(t) * br, Math.sin(t) * (br + l), -Math.cos(t) * (br + l)); }
    ctx.fillStyle = C.white; ctx.beginPath(); ctx.moveTo(0, -br); ctx.lineTo(-1.8 * u, -br - 3 * u); ctx.lineTo(1.8 * u, -br - 3 * u); ctx.fill();
    ctx.rotate(-d.roll);
    const bankAmber = Math.abs(d.roll) > 35 * D2R; ctx.strokeStyle = ctx.fillStyle = bankAmber ? C.amber : C.white;
    ctx.beginPath(); ctx.moveTo(0, -br + 0.4 * u); ctx.lineTo(-2 * u, -br + 3.6 * u); ctx.lineTo(2 * u, -br + 3.6 * u); ctx.closePath(); bankAmber ? ctx.fill() : ctx.stroke();
    const slip = clamp(-d.beta * R2D * 0.9, -6, 6) * u; ctx.strokeRect(-2 * u + slip, -br + 4.2 * u, 4 * u, 1.4 * u);
    ctx.restore();
    // aircraft symbol
    ctx.fillStyle = '#0a0a0a'; ctx.strokeStyle = C.white; ctx.lineWidth = 0.45 * u;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(acx + s * aw * 0.33, acy - 0.9 * u); ctx.lineTo(acx + s * aw * 0.12, acy - 0.9 * u); ctx.lineTo(acx + s * aw * 0.12, acy + 3.2 * u); ctx.lineTo(acx + s * aw * 0.12 + s * 1.8 * u, acy + 3.2 * u); ctx.lineTo(acx + s * aw * 0.12 + s * 1.8 * u, acy + 0.9 * u); ctx.lineTo(acx + s * aw * 0.33, acy + 0.9 * u); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.fillRect(acx - 0.9 * u, acy - 0.9 * u, 1.8 * u, 1.8 * u); ctx.strokeRect(acx - 0.9 * u, acy - 0.9 * u, 1.8 * u, 1.8 * u);
    // radio altitude
    if (d.agl < 760) { font(ctx, 4.4 * u, true); txt(ctx, String(Math.max(0, Math.round(d.agl * FT / (d.agl * FT > 100 ? 10 : 2)) * (d.agl * FT > 100 ? 10 : 2))), acx, ay1 - 4.5 * u, d.agl * FT < 200 ? C.amber : C.white); }
    // ---- ILS deviation scales
    const il = sim.ilsDev();
    if (il && il.valid) {
      const ly = ay1 + 3.6 * u; ctx.strokeStyle = C.white; ctx.lineWidth = 0.35 * u;
      for (const k of [-2, -1, 1, 2]) { ctx.beginPath(); ctx.arc(acx + k * aw * 0.11, ly, 0.9 * u, 0, 7); ctx.stroke(); }
      line(ctx, acx, ly - 2 * u, acx, ly + 2 * u);
      const lx = acx + clamp(-il.locDeg / 1.0, -2.4, 2.4) * aw * 0.11;
      diamond(ctx, lx, ly, 1.9 * u, Math.abs(il.locDeg) < 2.4);
      const gx = ax1 + 3.4 * u;
      for (const k of [-2, -1, 1, 2]) { ctx.beginPath(); ctx.arc(gx, acy + k * ah * 0.12, 0.9 * u, 0, 7); ctx.stroke(); }
      line(ctx, gx - 2 * u, acy, gx + 2 * u, acy);
      diamond(ctx, gx, acy + clamp(il.gsDeg / 0.35, -2.4, 2.4) * ah * 0.12, 1.9 * u, Math.abs(il.gsDeg) < 0.84);
      font(ctx, 2.9 * u); txt(ctx, 'ILS ' + sim.nav.ils.id, ax0, ay0 - 5.6 * u, C.white, 'left'); txt(ctx, 'DME ' + (Math.hypot(il.along < 0 ? il.along : 0, il.cross) / NM).toFixed(1), ax0, ay0 - 2.2 * u, C.white, 'left');
    }
    // ---- speed tape
    const sx0 = w * 0.03, sx1 = w * 0.195, sw = sx1 - sx0, kt = d.ias * KT, ppk = ah / 120;
    ctx.save(); ctx.beginPath(); ctx.rect(sx0, ay0, sw, ah); ctx.clip(); ctx.fillStyle = C.tape; ctx.fillRect(sx0, ay0, sw, ah);
    ctx.strokeStyle = C.white; ctx.lineWidth = 0.35 * u; font(ctx, 3.5 * u);
    for (let v = Math.max(30, Math.floor((kt - 70) / 10) * 10); v <= kt + 70; v += 10) { const y = acy - (v - kt) * ppk; line(ctx, sx1 - 2.6 * u, y, sx1, y); if (v % 20 === 0) txt(ctx, String(v), sx1 - 4 * u, y, C.white, 'right'); }
    const vs1 = sim.vStall() * KT, vmo = [350, 255, 235, 215, 205, 190, 180][sim.s.flapIdx];
    const yS = acy - (vs1 - kt) * ppk, yA = acy - (vs1 * 1.2 - kt) * ppk, yV = acy - (vmo - kt) * ppk;
    ctx.fillStyle = C.amber; ctx.fillRect(sx1 - 1.3 * u, yA, 1.3 * u, yS - yA);
    barber(ctx, sx1 - 1.9 * u, yS, 1.9 * u, ay1 - yS + 4, u); barber(ctx, sx1 - 1.9 * u, ay0 - 4, 1.9 * u, yV - ay0 + 4, u);
    const tr = clamp(d.iasDot * KT * 10, -60, 60); if (Math.abs(tr) > 3) { ctx.strokeStyle = C.green; ctx.lineWidth = 0.6 * u; line(ctx, sx1 - 0.9 * u, acy, sx1 - 0.9 * u, acy - tr * ppk); ctx.beginPath(); ctx.moveTo(sx1 - 0.9 * u, acy - tr * ppk - Math.sign(tr) * 1.5 * u); ctx.lineTo(sx1 - 2.2 * u, acy - tr * ppk); ctx.lineTo(sx1 + 0.4 * u, acy - tr * ppk); ctx.fillStyle = C.green; ctx.fill(); }
    if (ap.at || ap.on) { const y = clamp(acy - (ap.spd * KT - kt) * ppk, ay0, ay1); bug(ctx, sx1, y, u, -1); }
    ctx.restore();
    readout(ctx, sx0 + 0.6 * u, acy, sw - 3 * u, 7.4 * u, pad(kt, 3), 5.2 * u, u, d.stallWarn ? C.red : C.white);
    font(ctx, 3.6 * u); txt(ctx, (ap.at || ap.on) ? pad(ap.spd * KT, 3) : '---', (sx0 + sx1) / 2, ay0 - 3.2 * u, C.mag);
    txt(ctx, d.mach > 0.4 ? '.' + pad(d.mach * 1000, 3) : 'GS ' + Math.round(d.gs * KT), (sx0 + sx1) / 2, ay1 + 3.4 * u, C.white);
    // ---- altitude tape
    const tx0 = w * 0.775, tx1 = w * 0.93, tw = tx1 - tx0, ft = d.alt * FT, ppf = ah / 1300;
    ctx.save(); ctx.beginPath(); ctx.rect(tx0, ay0, tw, ah); ctx.clip(); ctx.fillStyle = C.tape; ctx.fillRect(tx0, ay0, tw, ah);
    ctx.strokeStyle = C.white; ctx.lineWidth = 0.35 * u; font(ctx, 3.2 * u);
    for (let v = Math.floor((ft - 750) / 100) * 100; v <= ft + 750; v += 100) { const y = acy - (v - ft) * ppf; line(ctx, tx0, y, tx0 + (v % 500 === 0 ? 3 : 1.8) * u, y); if (v % 200 === 0) txt(ctx, String(v), tx1 - 1 * u, y, C.white, 'right'); }
    const gy = acy - (d.gndAlt * FT + 17 - ft) * ppf; if (gy < ay1 + 2) { ctx.fillStyle = 'rgba(255,181,46,0.35)'; ctx.fillRect(tx0, gy, tw, ay1 - gy + 4); ctx.strokeStyle = C.amber; line(ctx, tx0, gy, tx1, gy); }
    if (ap.on) bug(ctx, tx0, clamp(acy - (ap.alt * FT - ft) * ppf, ay0, ay1), u, 1);
    ctx.restore();
    readout(ctx, tx0 + 2.4 * u, acy, tw - 2 * u, 7.4 * u, String(Math.round(ft / 10) * 10), 4.6 * u, u, C.white);
    font(ctx, 3.6 * u); txt(ctx, ap.on ? String(Math.round(ap.alt * FT / 100) * 100) : '-----', (tx0 + tx1) / 2, ay0 - 3.2 * u, C.mag);
    font(ctx, 2.9 * u); txt(ctx, '1013 HPA', (tx0 + tx1) / 2, ay1 + 3.4 * u, C.green);
    // ---- vertical speed
    const vx = w * 0.965, vsf = d.vs * 196.85, vy = v => acy - Math.sign(v) * (Math.min(Math.abs(v), 1000) / 1000 * 0.5 + clamp((Math.abs(v) - 1000) / 5000, 0, 1) * 0.5) * ah * 0.42;
    ctx.fillStyle = C.tape; ctx.beginPath(); ctx.moveTo(vx - 2.6 * u, acy - ah * 0.46); ctx.lineTo(vx + 2.4 * u, acy - ah * 0.46); ctx.lineTo(vx + 2.4 * u, acy + ah * 0.46); ctx.lineTo(vx - 2.6 * u, acy + ah * 0.46); ctx.fill();
    ctx.strokeStyle = C.white; ctx.lineWidth = 0.3 * u; font(ctx, 2.5 * u);
    for (const v of [-6000, -2000, -1000, -500, 500, 1000, 2000, 6000]) { const y = vy(v); line(ctx, vx - 2.2 * u, y, vx - 0.8 * u, y); if (Math.abs(v) !== 500) txt(ctx, String(Math.abs(v) / 1000), vx + 1.1 * u, y, C.white); }
    ctx.lineWidth = 0.7 * u; line(ctx, vx + 2.4 * u, acy, vx - 2.2 * u, vy(vsf));
    if (ap.on && ap.vert === 'VS') { ctx.strokeStyle = C.mag; line(ctx, vx - 2.6 * u, vy(ap.vs * 196.85), vx - 0.4 * u, vy(ap.vs * 196.85)); }
    if (Math.abs(vsf) > 300) { font(ctx, 3 * u); txt(ctx, String(Math.round(Math.abs(vsf) / 50) * 50), vx, vsf > 0 ? acy - ah * 0.5 : acy + ah * 0.5, C.white); }
    // ---- heading rose (lower arc)
    const hcx = acx, hcy = h * 1.20, hr = h * 0.40, hd = d.hdg;
    ctx.save(); ctx.beginPath(); ctx.rect(0, ay1 + 7.5 * u, w, h); ctx.clip();
    ctx.fillStyle = C.tape; ctx.beginPath(); ctx.arc(hcx, hcy, hr, 0, 7); ctx.fill();
    ctx.strokeStyle = C.white; ctx.lineWidth = 0.35 * u; font(ctx, 3.3 * u);
    for (let a = 0; a < 360; a += 5) { const rel = wrapPi((a - hd) * D2R); if (Math.abs(rel) > 0.75) continue; const sn = Math.sin(rel), cs = Math.cos(rel), l = a % 10 === 0 ? 2.6 * u : 1.4 * u; line(ctx, hcx + sn * hr, hcy - cs * hr, hcx + sn * (hr - l), hcy - cs * (hr - l)); if (a % 30 === 0) { ctx.save(); ctx.translate(hcx + sn * (hr - 6 * u), hcy - cs * (hr - 6 * u)); ctx.rotate(rel); txt(ctx, String(a / 10), 0, 0); ctx.restore(); } }
    const tk = wrapPi((d.track - hd) * D2R); ctx.strokeStyle = C.white; ctx.lineWidth = 0.3 * u; if (d.gs > 20) line(ctx, hcx + Math.sin(tk) * hr, hcy - Math.cos(tk) * hr, hcx + Math.sin(tk) * (hr - 9 * u), hcy - Math.cos(tk) * (hr - 9 * u));
    if (ap.on || true) { const rel = clamp(wrapPi((ap.hdg - hd) * D2R), -0.62, 0.62); ctx.save(); ctx.translate(hcx + Math.sin(rel) * hr, hcy - Math.cos(rel) * hr); ctx.rotate(rel); ctx.strokeStyle = C.mag; ctx.lineWidth = 0.5 * u; ctx.beginPath(); ctx.moveTo(-3 * u, 0); ctx.lineTo(-3 * u, -2.2 * u); ctx.lineTo(-1.2 * u, -2.2 * u); ctx.lineTo(0, -0.4 * u); ctx.lineTo(1.2 * u, -2.2 * u); ctx.lineTo(3 * u, -2.2 * u); ctx.lineTo(3 * u, 0); ctx.stroke(); ctx.restore(); }
    ctx.restore();
    ctx.fillStyle = C.white; ctx.beginPath(); ctx.moveTo(hcx, hcy - hr - 0.3 * u); ctx.lineTo(hcx - 1.7 * u, hcy - hr - 3.2 * u); ctx.lineTo(hcx + 1.7 * u, hcy - hr - 3.2 * u); ctx.fill();
    font(ctx, 3.4 * u); txt(ctx, pad(ap.hdg, 3) + ' H', hcx - aw * 0.36, h - 3.2 * u, C.mag); txt(ctx, 'MAG', hcx + aw * 0.36, h - 3.2 * u, C.green);
    font(ctx, 4.2 * u, true); txt(ctx, pad(wrap360(hd) < 0.5 ? 360 : hd, 3), hcx, h - 3.6 * u, C.white);
    // ---- flight mode annunciator
    const fy = h * 0.012, fh = h * 0.085, fx0 = ax0 - 2 * u, fw = (ax1 - ax0 + 4 * u) / 3;
    ctx.fillStyle = C.tape; ctx.fillRect(fx0, fy, fw * 3, fh); ctx.strokeStyle = '#3a4653'; ctx.lineWidth = 0.25 * u; line(ctx, fx0 + fw, fy, fx0 + fw, fy + fh); line(ctx, fx0 + fw * 2, fy, fx0 + fw * 2, fy + fh);
    font(ctx, 3.6 * u, true);
    const vert = ap.vert === 'GS' ? (ap.flare ? 'FLARE' : 'G/S') : ap.vert === 'VS' ? 'V/S' : 'ALT';
    txt(ctx, ap.at ? 'SPD' : '', fx0 + fw * 0.5, fy + fh * 0.36, C.green); txt(ctx, ap.on ? ap.lat : '', fx0 + fw * 1.5, fy + fh * 0.36, C.green); txt(ctx, ap.on ? vert : '', fx0 + fw * 2.5, fy + fh * 0.36, C.green);
    font(ctx, 2.7 * u);
    if (ap.appArmed && !ap.locCap) txt(ctx, 'LOC', fx0 + fw * 1.5, fy + fh * 0.8, C.white); if (ap.appArmed && !ap.gsCap) txt(ctx, 'G/S', fx0 + fw * 2.5, fy + fh * 0.8, C.white);
    font(ctx, 3.1 * u, true); txt(ctx, ap.on ? 'A/P' : (sim.apInop ? 'NO AUTOPILOT' : ''), acx, (fy + fh + ay0) / 2 + 0.3 * u, ap.on ? C.green : C.amber);
    if (d.stallWarn) { font(ctx, 5 * u, true); txt(ctx, 'STALL', acx, acy - ah * 0.2, C.red); }
  }
  function diamond(ctx, x, y, s, filled) { ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.8, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s * 0.8, y); ctx.closePath(); ctx.strokeStyle = C.mag; ctx.fillStyle = C.mag; filled ? ctx.fill() : ctx.stroke(); }
  function barber(ctx, x, y, w, hgt, u) { if (hgt <= 0) return; ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, hgt); ctx.clip(); ctx.fillStyle = C.red; ctx.fillRect(x, y, w, hgt); ctx.fillStyle = '#111'; for (let k = y - (y % (3 * u)); k < y + hgt; k += 3 * u) ctx.fillRect(x, k, w, 1.5 * u); ctx.restore(); }
  function bug(ctx, x, y, u, dir) { ctx.strokeStyle = C.mag; ctx.lineWidth = 0.5 * u; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dir * 2.2 * u, y - 1.8 * u); ctx.lineTo(x + dir * 5 * u, y - 1.8 * u); ctx.lineTo(x + dir * 5 * u, y + 1.8 * u); ctx.lineTo(x + dir * 2.2 * u, y + 1.8 * u); ctx.closePath(); ctx.stroke(); }
  function readout(ctx, x, y, w, hgt, s, px, u, col) { ctx.fillStyle = '#000'; ctx.strokeStyle = col; ctx.lineWidth = 0.45 * u; ctx.fillRect(x, y - hgt / 2, w, hgt); ctx.strokeRect(x, y - hgt / 2, w, hgt); font(ctx, px, true); txt(ctx, s, x + w - 1.2 * u, y + 0.2 * u, col, 'right'); }

  // ------------------------------------------------------------ navigation display
  const terr = { cv: null, t: 0 };
  function nd(cv, sim, st) {
    const sz = fit(cv); if (!sz) return; const ctx = cv.getContext('2d'), w = sz.w, h = sz.h, d = sim.d, s = sim.s, u = Math.min(w, h) / 100;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
    const cx = w * 0.5, cy = h * 0.80, R = h * 0.66, range = st.range * NM, ppm = R / range, hd = d.hdg * D2R;
    const map = (n, e) => { const dn = n - s.pos[0], de = e - s.pos[1]; const x = (de * Math.cos(hd) - dn * Math.sin(hd)) * ppm, y = -(dn * Math.cos(hd) + de * Math.sin(hd)) * ppm; return [cx + x, cy + y]; };
    // terrain picture, refreshed a few times a second
    if (!terr.cv) terr.cv = document.createElement('canvas');
    if (st.now - terr.t > 0.35 || terr.cv.width !== 48) {
      terr.t = st.now; terr.cv.width = 48; terr.cv.height = 48; const tc = terr.cv.getContext('2d'), img = tc.createImageData(48, 48), world = sim.world;
      for (let j = 0; j < 48; j++) for (let i = 0; i < 48; i++) {
        const x = (i - 23.5) / 24 * range * 1.05, y = (38 - j) / 24 * range * 1.05; // right, ahead
        const n = s.pos[0] + y * Math.cos(hd) - x * Math.sin(hd), e = s.pos[1] + y * Math.sin(hd) + x * Math.cos(hd), ht = world.heightAt(n, e), k = (j * 48 + i) * 4, rel = ht - d.alt - clamp(700 - d.agl, 0, 700); // low to the ground only terrain well above is flagged
        let c;
        if (ht <= 0) c = [8, 30, 58]; else if (rel > -150) c = [150, 38, 30]; else if (rel > -600) c = [150, 118, 28]; else c = [14 + Math.min(40, ht / 40), 52 + Math.min(40, ht / 30), 30];
        img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
      }
      tc.putImageData(img, 0, 0); terr.range = range; terr.hd = hd; terr.n = s.pos[0]; terr.e = s.pos[1];
    }
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R * 1.02, Math.PI, 2 * Math.PI); ctx.lineTo(cx + R * 1.02, h); ctx.lineTo(cx - R * 1.02, h); ctx.clip();
    { // draw the cached picture at the pose it was sampled for
      const p0 = map(terr.n, terr.e); ctx.save(); ctx.translate(p0[0], p0[1]); ctx.rotate(terr.hd - hd); const sc = terr.range * 1.05 / 24 * ppm; ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 0.9;
      ctx.drawImage(terr.cv, -24 * sc, -38.5 * sc, 48 * sc, 48 * sc); ctx.restore();
    }
    // range arcs
    ctx.strokeStyle = 'rgba(238,243,247,0.55)'; ctx.lineWidth = 0.3 * u; ctx.setLineDash([1.2 * u, 1.6 * u]);
    for (const k of [0.5]) { ctx.beginPath(); ctx.arc(cx, cy, R * k, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke(); } ctx.setLineDash([]);
    font(ctx, 2.9 * u); txt(ctx, String(st.range / 2), cx - R * 0.5 - 3 * u, cy - 2 * u, C.white);
    // route
    const rt = sim.nav.route;
    if (rt.length) {
      ctx.strokeStyle = C.mag; ctx.lineWidth = 0.55 * u; ctx.beginPath(); let p = [cx, cy];
      for (let i = sim.nav.wp; i < rt.length; i++) { const q = map(rt[i].n, rt[i].e); if (i === sim.nav.wp) ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); } ctx.stroke();
      for (let i = 0; i < rt.length; i++) { const q = map(rt[i].n, rt[i].e), act = i === sim.nav.wp; star(ctx, q[0], q[1], 1.9 * u, act ? C.mag : C.white); font(ctx, 2.8 * u); txt(ctx, rt[i].name, q[0] + 3 * u, q[1] - 2.4 * u, act ? C.mag : C.white, 'left'); }
    }
    // airports and the tuned runway
    for (const a of sim.world.airports) {
      const pa = map(a.a[0], a.a[1]), pb = map(a.b[0], a.b[1]); ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(0.5 * u, a.width * ppm); line(ctx, pa[0], pa[1], pb[0], pb[1]);
      const c = map(a.n, a.e); ctx.strokeStyle = C.cyan; ctx.lineWidth = 0.4 * u; ctx.beginPath(); ctx.arc(c[0], c[1], 2.2 * u, 0, 7); ctx.stroke(); font(ctx, 2.8 * u); txt(ctx, a.id, c[0] + 3.4 * u, c[1] + 2.6 * u, C.cyan, 'left');
    }
    const rw = sim.nav.ils;
    if (rw) { const t = map(rw.thr[0], rw.thr[1]), f = map(rw.thr[0] - rw.dn * 22000, rw.thr[1] - rw.de * 22000); ctx.strokeStyle = C.white; ctx.lineWidth = 0.3 * u; ctx.setLineDash([2 * u, 1.5 * u]); line(ctx, t[0], t[1], f[0], f[1]); ctx.setLineDash([]); }
    ctx.restore();
    // compass arc
    ctx.strokeStyle = C.white; ctx.lineWidth = 0.4 * u; ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI * 1.06, Math.PI * 1.94); ctx.stroke();
    font(ctx, 3 * u);
    for (let a = 0; a < 360; a += 5) { const rel = wrapPi(a * D2R - hd); if (Math.abs(rel) > 1.3) continue; const sn = Math.sin(rel), cs = Math.cos(rel), l = a % 10 === 0 ? 2.4 * u : 1.2 * u; line(ctx, cx + sn * R, cy - cs * R, cx + sn * (R + l), cy - cs * (R + l)); if (a % 30 === 0) { ctx.save(); ctx.translate(cx + sn * (R + 5 * u), cy - cs * (R + 5 * u)); ctx.rotate(rel); txt(ctx, String(a / 10), 0, 0); ctx.restore(); } }
    { const rel = clamp(wrapPi(sim.ap.hdg * D2R - hd), -1.25, 1.25); ctx.strokeStyle = C.mag; ctx.lineWidth = 0.35 * u; ctx.setLineDash([1.5 * u, 1.5 * u]); line(ctx, cx, cy, cx + Math.sin(rel) * R, cy - Math.cos(rel) * R); ctx.setLineDash([]); }
    { const rel = wrapPi(d.track * D2R - hd); if (d.gs > 20) { ctx.strokeStyle = C.white; ctx.lineWidth = 0.35 * u; line(ctx, cx, cy - 4 * u, cx + Math.sin(rel) * R, cy - Math.cos(rel) * R); } }
    // own ship
    ctx.strokeStyle = C.white; ctx.lineWidth = 0.5 * u; ctx.beginPath(); ctx.moveTo(cx, cy - 3.6 * u); ctx.lineTo(cx - 2.6 * u, cy + 2.6 * u); ctx.lineTo(cx + 2.6 * u, cy + 2.6 * u); ctx.closePath(); ctx.stroke();
    // data blocks
    font(ctx, 3 * u);
    txt(ctx, 'GS ' + Math.round(d.gs * KT) + '  TAS ' + Math.round(d.tas * KT), 2 * u, 3.4 * u, C.white, 'left');
    const wsp = Math.hypot(d.windN, d.windE), wdir = wrap360(Math.atan2(-d.windE, -d.windN) * R2D);
    txt(ctx, pad(wdir, 3) + '°/' + Math.round(wsp * KT), 2 * u, 7.6 * u, C.white, 'left');
    if (wsp > 0.5) { const rel = wdir * D2R - hd + Math.PI; ctx.save(); ctx.translate(6 * u, 13.5 * u); ctx.rotate(rel); ctx.strokeStyle = C.white; ctx.lineWidth = 0.4 * u; line(ctx, 0, 3.4 * u, 0, -3.4 * u); line(ctx, 0, -3.4 * u, -1.4 * u, -1.4 * u); line(ctx, 0, -3.4 * u, 1.4 * u, -1.4 * u); ctx.restore(); }
    font(ctx, 3.6 * u, true); txt(ctx, pad(wrap360(d.hdg) < 0.5 ? 360 : d.hdg, 3), cx, cy - R - 9.5 * u, C.white); font(ctx, 2.6 * u); txt(ctx, 'HDG', cx - 9 * u, cy - R - 9.5 * u, C.green); txt(ctx, 'MAG', cx + 9 * u, cy - R - 9.5 * u, C.green);
    let tgt = rt.length && sim.nav.wp < rt.length ? rt[sim.nav.wp] : null;
    if (!tgt && rw) tgt = { name: rw.id, n: rw.thr[0], e: rw.thr[1] };
    if (tgt) { const dist = Math.hypot(tgt.n - s.pos[0], tgt.e - s.pos[1]), brg = wrap360(Math.atan2(tgt.e - s.pos[1], tgt.n - s.pos[0]) * R2D), ete = d.gs > 20 ? dist / d.gs : 0; font(ctx, 3 * u); txt(ctx, tgt.name, w - 2 * u, 3.4 * u, C.mag, 'right'); txt(ctx, (dist / NM).toFixed(1) + ' NM', w - 2 * u, 7.6 * u, C.white, 'right'); txt(ctx, pad(brg, 3) + '°  ' + Math.floor(ete / 60) + ':' + pad(ete % 60, 2), w - 2 * u, 11.8 * u, C.white, 'right'); }
    font(ctx, 2.6 * u); txt(ctx, 'RANGE ' + st.range + ' NM  [ ]', 2 * u, h - 3 * u, C.cyan, 'left'); txt(ctx, 'TERR', w - 2 * u, h - 3 * u, C.cyan, 'right');
  }
  function star(ctx, x, y, r, col) { ctx.strokeStyle = col; ctx.lineWidth = r * 0.22; ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, rr = i % 2 ? r * 0.4 : r; ctx[i ? 'lineTo' : 'moveTo'](x + Math.sin(a) * rr, y - Math.cos(a) * rr); } ctx.closePath(); ctx.stroke(); }

  // ------------------------------------------------------------ engine and systems display
  function eicas(cv, sim, alerts) {
    const sz = fit(cv); if (!sz) return; const ctx = cv.getContext('2d'), w = sz.w, h = sz.h, s = sim.s, d = sim.d, u = Math.min(w, h * 1.25) / 100;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
    const gauge = (x, y, r, val, max, red, cmd, label, digits, fail) => {
      const a0 = 0, a1 = Math.PI * 1.17, ang = v => a0 + clamp(v / max, 0, 1.05) * a1;
      ctx.lineWidth = 0.5 * u; ctx.strokeStyle = C.white; ctx.beginPath(); ctx.arc(x, y, r, a0, a1); ctx.stroke();
      ctx.strokeStyle = C.red; ctx.lineWidth = 0.9 * u; ctx.beginPath(); ctx.arc(x, y, r, ang(red), a1 * 1.0 + 0.02); ctx.stroke();
      const col = fail ? C.amber : val > red ? C.red : C.white;
      ctx.fillStyle = 'rgba(238,243,247,0.16)'; ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r - 0.6 * u, a0, ang(val)); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 0.7 * u; line(ctx, x, y, x + Math.cos(ang(val)) * r, y + Math.sin(ang(val)) * r);
      if (cmd !== null) { const a = ang(cmd); ctx.strokeStyle = C.green; ctx.lineWidth = 0.5 * u; line(ctx, x + Math.cos(a) * (r - 0.5 * u), y + Math.sin(a) * (r - 0.5 * u), x + Math.cos(a) * (r + 2.2 * u), y + Math.sin(a) * (r + 2.2 * u)); }
      ctx.strokeStyle = col; ctx.lineWidth = 0.35 * u; ctx.strokeRect(x + 1.5 * u, y - 6.6 * u, r + 1 * u, 5.4 * u); font(ctx, 3.9 * u, true); txt(ctx, digits, x + r + 1.6 * u, y - 3.8 * u, col, 'right');
      if (label) { font(ctx, 2.7 * u); txt(ctx, label, x - r * 0.45, y - r * 0.5, C.cyan); }
    };
    const gx = [w * 0.24, w * 0.66], r1 = Math.min(w * 0.145, h * 0.15), cmd = FS.AC.N1idle + (100 - FS.AC.N1idle) * sim.inp.throttle;
    font(ctx, 2.8 * u); txt(ctx, 'N1', w * 0.47, h * 0.17, C.cyan); txt(ctx, 'EGT', w * 0.47, h * 0.42, C.cyan);
    for (let i = 0; i < 2; i++) {
      gauge(gx[i], h * 0.17, r1, s.n1[i], 104, 100.5, s.engOn[i] ? cmd : null, '', s.n1[i].toFixed(1), !s.engOn[i]);
      gauge(gx[i], h * 0.42, r1 * 0.72, s.egt[i], 1000, 900, null, '', String(Math.round(s.egt[i])), !s.engOn[i]);
      font(ctx, 2.7 * u); txt(ctx, s.engOn[i] ? 'ENG ' + (i + 1) : 'ENG ' + (i + 1) + ' FAIL', gx[i] + r1 * 0.3, h * 0.045, s.engOn[i] ? C.dim : C.amber);
    }
    // fuel flow, fuel, systems
    const y0 = h * 0.585, rowH = h * 0.058; font(ctx, 3 * u);
    const row = (k, label, a, b, col) => { const y = y0 + k * rowH; txt(ctx, label, w * 0.47, y, C.cyan); txt(ctx, a, gx[0] + r1 * 0.55, y, col || C.white, 'right'); txt(ctx, b, gx[1] + r1 * 0.55, y, col || C.white, 'right'); };
    row(0, 'FF', (d.ff[0] * 3.6).toFixed(1), (d.ff[1] * 3.6).toFixed(1));
    ctx.strokeStyle = '#2a3541'; ctx.lineWidth = 0.25 * u; line(ctx, 2 * u, y0 + rowH * 0.75, w - 2 * u, y0 + rowH * 0.75);
    const fl = s.fuel, low = fl < 1500; font(ctx, 2.7 * u); txt(ctx, 'FUEL KG', 2.5 * u, y0 + rowH * 1.55, C.cyan, 'left'); font(ctx, 4 * u, true); txt(ctx, String(Math.round(fl / 10) * 10), 2.5 * u, y0 + rowH * 2.6, low ? C.amber : C.white, 'left');
    // gear
    const gxc = w * 0.50, gyc = y0 + rowH * 2.0, bw = 8.2 * u, bh = 4.4 * u; font(ctx, 2.5 * u); txt(ctx, 'GEAR', gxc, y0 + rowH * 1.25, C.cyan);
    const gst = s.gear > 0.98 ? 'DOWN' : s.gear < 0.02 ? 'UP' : '////', gcol = s.gear > 0.98 ? C.green : s.gear < 0.02 ? C.white : C.amber;
    for (const p of [[0, 0], [-1, 1], [1, 1]]) { const x = gxc + p[0] * (bw * 0.56) - bw / 2, y = gyc + p[1] * (bh + 0.8 * u) - bh / 2; ctx.strokeStyle = gcol; ctx.lineWidth = 0.35 * u; ctx.strokeRect(x, y, bw, bh); font(ctx, 2.5 * u); txt(ctx, gst, x + bw / 2, y + bh / 2 + 0.2 * u, gcol); }
    // flaps
    const fx = w - 9 * u, fy0 = y0 + rowH * 1.3, fh = rowH * 3.3; font(ctx, 2.5 * u); txt(ctx, 'FLAPS', fx - 1 * u, y0 + rowH * 0.95 + 1.2 * u, C.cyan);
    ctx.strokeStyle = C.white; ctx.lineWidth = 0.35 * u; ctx.strokeRect(fx - 1.6 * u, fy0 + 2 * u, 3.2 * u, fh - 2 * u);
    ctx.fillStyle = C.white; ctx.fillRect(fx - 1.6 * u, fy0 + 2 * u, 3.2 * u, (fh - 2 * u) * s.flapDeg / 30);
    const tgtY = fy0 + 2 * u + (fh - 2 * u) * FS.FLAPS[s.flapIdx].deg / 30; ctx.strokeStyle = C.green; ctx.lineWidth = 0.5 * u; line(ctx, fx - 3 * u, tgtY, fx + 3 * u, tgtY);
    font(ctx, 3.2 * u, true); txt(ctx, FS.FLAPS[s.flapIdx].name, fx - 3.6 * u, tgtY, C.green, 'right');
    // status lines
    font(ctx, 2.7 * u); let sy = y0 + rowH * 3.85; const stat = [];
    if (s.parkBrake) stat.push(['PARK BRAKE SET', C.white]); if (s.spoiler > 0.1) stat.push(['SPEEDBRAKE EXT', C.white]);
    stat.push(['TRIM ' + (s.trim >= 0 ? '+' : '') + (s.trim * 5).toFixed(1), C.dim]);
    for (const m of alerts) stat.unshift([m.text, m.level === 2 ? C.red : C.amber]);
    for (const m of stat.slice(0, 5)) { txt(ctx, m[0], 2.5 * u, sy, m[1], 'left'); sy += rowH * 0.78; }
  }
  return { pfd, nd, eicas, C };
})();
