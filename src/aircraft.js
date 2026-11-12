'use strict';
/* Procedural twin-engine widebody (787-class proportions).
   Model space: x = right, y = up, z = aft; origin at the centre of gravity. */
function buildAircraft(glx) {
  const P = (xf, yr, zu) => [yr, zu, -xf];
  const lerp = FS.lerp, D2R = FS.D2R;
  const WING = [0.70, 0.72, 0.75, 0.35], WHITE = [0.80, 0.81, 0.83, 0.4], NAVY = [0.045, 0.10, 0.24, 0.5], METAL = [0.70, 0.72, 0.75, 0.9], DARK = [0.10, 0.10, 0.11, 0.3], TIRE = [0.05, 0.05, 0.055, 0.05];
  const pw = (pts, x) => { for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const a = pts[i - 1], b = pts[i], t = (x - a[0]) / (b[0] - a[0]); return a.map((v, k) => lerp(v, b[k], t)); } return pts[pts.length - 1].slice(); };
  // airfoil thickness distribution (fractions of chord) for a 10 % section
  const UP = [[0, 0], [0.03, 0.026], [0.12, 0.048], [0.3, 0.06], [0.55, 0.048], [0.8, 0.022], [1, 0]];
  const LO = [[0, 0], [0.03, 0.019], [0.12, 0.033], [0.3, 0.04], [0.55, 0.03], [0.8, 0.012], [1, 0]];
  function airfoil(le, chord, th, frac, thick) {
    const k = th / 0.10, us = [0, 0.03, 0.12, 0.3, 0.55, 0.55 + (frac - 0.55) * 0.6, frac], ring = [];
    const pt = (u, t) => [le[0] + thick[0] * t * k * chord, le[1] + thick[1] * t * k * chord, le[2] + u * chord];
    for (let i = 0; i < us.length; i++) ring.push(pt(us[i], pw(UP, us[i])[1]));
    for (let i = us.length - 1; i >= 1; i--) ring.push(pt(us[i], -pw(LO, us[i])[1]));
    return ring;
  }
  // spanwise definitions: [station, leading edge xf, trailing edge xf, height zu, thickness]
  const wingAt = yr => { const w = pw([[2.0, 7.9, -5.2, -1.31, 0.13], [2.6, 7.6, -5.2, -1.25, 0.13], [9.7, 2.99, -5.2, -0.5, 0.105], [28.0, -8.9, -11.0, 1.42, 0.09], [30.05, -11.9, -12.4, 1.63, 0.08]], yr); return { le: w[1], te: w[2], z: w[3], th: w[4] }; };
  const stabAt = yr => { const w = pw([[0.6, -22.5, -28.1, 1.0, 0.09], [9.9, -28.3, -30.3, 1.95, 0.09]], yr); return { le: w[1], te: w[2], z: w[3], th: w[4] }; };
  const finAt = zu => { const w = pw([[1.8, -19.3, -27.5, 0, 0.10], [11.6, -27.3, -30.1, 0, 0.10]], zu); return { le: w[1], te: w[2], z: zu, th: w[4] }; };

  const parts = [];
  const airframe = new Geo();
  function liftSurface(geo, at, stations, mk, thick, col) {
    const rings = stations.map(s => { const w = at(s[0]); return airfoil(mk(w.le, s[0], w.z), w.le - w.te, w.th, s[1], thick); });
    geo.loft(rings, { col: typeof col === 'function' ? (i) => col(stations[Math.min(i, stations.length - 1)][0]) : col, capEnd: true, capStart: true });
  }
  // hinged trailing-edge surface between two stations; returns geometry in hinge frame + the frame
  function hinged(at, sA, sB, mk, thick, fracH, col, fracEnd) {
    const st = s => { const w = at(s), ch = w.le - w.te, k = w.th / 0.10; const h = mk(w.le - fracH * ch, s, w.z); return { h: [h[0] + thick[0] * (pw(UP, fracH)[1] - pw(LO, fracH)[1]) * 0.5 * k * ch, h[1] + thick[1] * (pw(UP, fracH)[1] - pw(LO, fracH)[1]) * 0.5 * k * ch, h[2]], c: ((fracEnd || 1) - fracH) * ch, t: (pw(UP, fracH)[1] + pw(LO, fracH)[1]) * 0.5 * k * ch }; };
    let A = st(sA), B = st(sB);
    let X = V3.norm(V3.sub(B.h, A.h));
    if (X[0] < -0.01 || (Math.abs(X[0]) < 0.01 && X[1] < 0)) { const t = A; A = B; B = t; X = V3.mul(X, -1); }
    const Y = V3.norm(V3.cross([0, 0, 1], X)), Z = V3.cross(X, Y);
    const loc = p => { const d = V3.sub(p, A.h); return [V3.dot(d, X), V3.dot(d, Y), V3.dot(d, Z)]; };
    const ring = e => { const s = loc(e.h)[0], te = loc([e.h[0], e.h[1], e.h[2] + e.c]); return [[s, e.t, 0], [te[0], 0.012, te[2]], [te[0], -0.012, te[2]], [s, -e.t, 0]]; };
    const g = new Geo(); g.loft([ring(A), ring(B)], { col, capStart: true, capEnd: true });
    return { geo: g, frame: M4.basis(X, Y, Z, A.h) };
  }
  const addPart = (geo, mode, mat) => { const p = { mesh: glx.mesh(geo.data()), mode: mode || 0, mat: mat || (() => M4.ident()) }; parts.push(p); return p; };

  // ---------- fuselage
  {
    const st = [[27.4, 0.06, -0.66], [27.25, 0.5, -0.62], [26.8, 0.98, -0.54], [26.0, 1.5, -0.42], [24.9, 1.98, -0.28], [23.4, 2.44, -0.14], [21.5, 2.79, -0.04], [19.2, 2.95, 0], [8, 2.95, 0], [-4, 2.95, 0], [-13, 2.95, 0], [-17, 2.76, 0.24], [-21, 2.3, 0.7], [-24.5, 1.7, 1.15], [-27.5, 1.02, 1.55], [-29.6, 0.3, 1.82]];
    const rings = st.map(s => { const r = []; for (let j = 0; j < 28; j++) { const a = j / 28 * Math.PI * 2; r.push(P(s[0], s[1] * Math.sin(a), s[2] + s[1] * Math.cos(a))); } return r; });
    const g = new Geo(); g.loft(rings, { smooth: true, col: WHITE, capEnd: true });
    addPart(g, 1);
  }
  // ---------- wings, stabilisers, fin (fixed structure) and their moving surfaces
  const surf = {};
  for (const sg of [-1, 1]) {
    const mkW = (xf, yr, zu) => P(xf, sg * yr, zu), up = [0, 1, 0];
    liftSurface(airframe, wingAt, [[2.0, 1], [3.1, 1], [3.1, 0.72], [9.1, 0.72], [9.1, 1], [10.3, 1], [10.3, 0.72], [19.6, 0.72], [19.6, 1], [20.0, 1], [20.0, 0.72], [26.6, 0.72], [26.6, 1], [28.0, 1], [30.05, 1]], mkW, up, WING);
    liftSurface(airframe, stabAt, [[0.6, 1], [1.6, 1], [1.6, 0.70], [9.5, 0.70], [9.5, 1], [9.9, 1]], mkW, up, WING);
    const side = sg < 0 ? 'L' : 'R';
    surf['flapIn' + side] = hinged(wingAt, 3.15, 9.05, mkW, up, 0.72, WING);
    surf['flapOut' + side] = hinged(wingAt, 10.35, 19.55, mkW, up, 0.72, WING);
    surf['ail' + side] = hinged(wingAt, 20.05, 26.55, mkW, up, 0.72, WING);
    surf['elev' + side] = hinged(stabAt, 1.65, 9.45, mkW, up, 0.70, WING);
    // spoilers sit on the upper surface ahead of the flaps
    const spAt = yr => { const w = wingAt(yr), ch = w.le - w.te; return { le: w.le, te: w.te, z: w.z + pw(UP, 0.6)[1] * (w.th / 0.1) * ch + 0.035, th: 0.012 }; };
    surf['spOut' + side] = hinged(spAt, 10.6, 19.2, mkW, up, 0.585, [0.74, 0.76, 0.79, 0.3], 0.715);
    surf['spIn' + side] = hinged(spAt, 3.6, 8.8, mkW, up, 0.60, [0.74, 0.76, 0.79, 0.3], 0.715);
    // engine nacelle + pylon
    const ex = sg * 9.7, ey = -2.85, prof = [[0.9, 1.34, 0], [0.16, 1.37, 0], [0.0, 1.47, 1], [0.22, 1.62, 1], [1.2, 1.74, 2], [3.4, 1.72, 2], [5.2, 1.5, 2], [6.2, 1.22, 2], [6.2, 0.96, 3], [7.3, 0.62, 3], [7.3, 0.40, 4], [8.5, 0.05, 4]];
    const ncol = [[0.07, 0.07, 0.08, 0.2], [0.78, 0.79, 0.81, 0.95], [0.78, 0.79, 0.81, 0.45], [0.24, 0.24, 0.26, 0.7], [0.36, 0.35, 0.34, 0.6]];
    const rings = prof.map(p => { const r = []; for (let j = 0; j < 22; j++) { const a = j / 22 * Math.PI * 2; r.push([ex + p[1] * Math.sin(a), ey + p[1] * Math.cos(a), -(10.2 - p[0])]); } return r; });
    airframe.loft(rings, { smooth: true, col: (i) => ncol[prof[i][2]] });
    const py = new Geo(); py.box([ex - 0.26, -1.42, -8.7], [ex + 0.26, -0.42, -2.4], WING); airframe.add(py);
  }
  {
    const mkF = (xf, zu) => P(xf, 0, zu);
    liftSurface(airframe, finAt, [[1.8, 1], [2.9, 1], [2.9, 0.68], [7.4, 0.68], [8.2, 0.68], [11.2, 0.68], [11.2, 1], [11.6, 1]], mkF, [1, 0, 0], z => (z >= 7.4 && z < 8.2) ? [0.16, 0.60, 0.80, 0.5] : NAVY);
    surf.rudder = hinged(finAt, 2.95, 11.15, mkF, [1, 0, 0], 0.68, NAVY);
  }
  addPart(airframe, 0);

  // moving surface parts: frame * fowler translation * rotation about the hinge
  const hingePart = (h, fn) => addPart(h.geo, 0, s => { const r = fn(s); return M4.mul(h.frame, M4.mul(M4.trans(0, r[2] || 0, r[1] || 0), M4.rotX(r[0]))); });
  for (const side of ['L', 'R']) {
    const sgn = side === 'L' ? 1 : -1; // left aileron goes down for a right roll
    hingePart(surf['flapIn' + side], s => [s.flapDeg * D2R * 1.05, s.flapDeg / 30 * 0.95, -s.flapDeg / 30 * 0.28]);
    hingePart(surf['flapOut' + side], s => [s.flapDeg * D2R * 1.05, s.flapDeg / 30 * 0.75, -s.flapDeg / 30 * 0.22]);
    hingePart(surf['ail' + side], s => [sgn * s.ail * 20 * D2R + Math.min(s.flapDeg, 10) * 0.6 * D2R]);
    hingePart(surf['elev' + side], s => [-s.elev * 24 * D2R - s.trim * 2 * D2R]);
    hingePart(surf['spOut' + side], s => [(7 - s.spoiler * 48 - Math.max(0, -sgn * s.ail) * 14) * D2R]);
    hingePart(surf['spIn' + side], s => [(8 - s.spoiler * 48) * D2R]);
  }
  hingePart(surf.rudder, s => [s.rud * 26 * D2R]);

  // ---------- engine fans
  {
    const g = new Geo(), N = 22;
    for (let j = 0; j < N; j++) { const a0 = j / N * 6.2832, a1 = (j + 0.72) / N * 6.2832, c = j % 2 ? [0.16, 0.16, 0.18, 0.6] : [0.30, 0.31, 0.33, 0.7]; g.tri([0, 0, -0.05], [1.33 * Math.sin(a0), 1.33 * Math.cos(a0), 0.06], [1.33 * Math.sin(a1), 1.33 * Math.cos(a1), -0.06], c); }
    const sp = []; for (const p of [[-0.75, 0.02], [-0.45, 0.2], [0, 0.36]]) { const r = []; for (let j = 0; j < 10; j++) { const a = j / 10 * 6.2832; r.push([p[1] * Math.sin(a), p[1] * Math.cos(a), p[0]]); } sp.push(r); }
    g.loft(sp, { col: (i, j) => j === 0 || j === 1 ? [0.95, 0.95, 0.95, 0.5] : [0.13, 0.13, 0.15, 0.6] });
    const m = glx.mesh(g.data());
    for (const sg of [-1, 1]) parts.push({ mesh: m, mode: 0, twoSided: true, mat: s => M4.mul(M4.trans(sg * 9.7, -2.85, -(10.2 - 0.9)), M4.rotZ(s.fan[sg < 0 ? 0 : 1])) });
  }
  // ---------- landing gear
  const cyl = (g, a, b, r, col, n) => { const ax = V3.norm(V3.sub(b, a)), u = V3.norm(V3.cross(ax, Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), v = V3.cross(ax, u), ring = c => { const o = []; for (let j = 0; j < (n || 10); j++) { const t = j / (n || 10) * 6.2832; o.push(V3.add(c, V3.add(V3.mul(u, r * Math.cos(t)), V3.mul(v, r * Math.sin(t))))); } return o; }; g.loft([ring(a), ring(b)], { col, capStart: true, capEnd: true }); };
  const wheelPair = (r, w, gap) => {
    const g = new Geo();
    for (const sx of [-1, 1]) {
      const x0 = sx * gap - w / 2, x1 = sx * gap + w / 2, N = 14, ring = x => { const o = []; for (let j = 0; j < N; j++) { const t = j / N * 6.2832; o.push([x, r * Math.cos(t), r * Math.sin(t)]); } return o; };
      g.loft([ring(x0), ring(x1)], { col: TIRE });
      for (const x of [x0, x1]) for (let j = 0; j < N; j++) { const t0 = j / N * 6.2832, t1 = (j + 1) / N * 6.2832, c = j % 2 ? [0.55, 0.56, 0.58, 0.5] : [0.2, 0.2, 0.22, 0.3]; g.tri([x, 0, 0], [x, r * 0.62 * Math.cos(t0), r * 0.62 * Math.sin(t0)], [x, r * 0.62 * Math.cos(t1), r * 0.62 * Math.sin(t1)], c, [sx * gap, 0, 0]); g.quad([x, r * 0.62 * Math.cos(t0), r * 0.62 * Math.sin(t0)], [x, r * 0.62 * Math.cos(t1), r * 0.62 * Math.sin(t1)], [x, r * Math.cos(t1), r * Math.sin(t1)], [x, r * Math.cos(t0), r * Math.sin(t0)], TIRE, [sx * gap, 0, 0]); }
    }
    cyl(g, [-gap, 0, 0], [gap, 0, 0], 0.09, METAL, 8);
    return glx.mesh(g.data());
  };
  {
    const noseW = wheelPair(0.5, 0.28, 0.3), mainW = wheelPair(0.65, 0.42, 0.52);
    const ng = new Geo(); cyl(ng, [0, 0, 0], [0, -2.25, 0], 0.13, METAL, 10); cyl(ng, [0, -0.3, 0], [0, -1.2, 0.9], 0.07, METAL, 6);
    const nosePivot = P(22.6, 0, -2.5);
    const noseM = s => M4.mul(M4.trans(nosePivot[0], nosePivot[1], nosePivot[2]), M4.rotX((1 - s.gear) * 100 * D2R));
    parts.push({ mesh: glx.mesh(ng.data()), mode: 0, gear: true, mat: noseM });
    parts.push({ mesh: noseW, mode: 0, gear: true, mat: s => M4.mul(noseM(s), M4.mul(M4.trans(0, -2.6 + s.comp[0], 0), M4.rotX(-s.wheelSpin / 0.5 * 0.6))) });
    for (const sg of [-1, 1]) {
      const mg = new Geo(); cyl(mg, [0, 0, 0], [0, -3.0, 0], 0.19, METAL, 10); cyl(mg, [0, -0.5, 0], [-sg * 1.3, 0.2, 0], 0.09, METAL, 6); mg.box([-0.14, -3.42, -1.05], [0.14, -3.12, 1.05], [0.35, 0.36, 0.38, 0.5]);
      const piv = P(-2.6, sg * 4.9, -1.7), gi = sg < 0 ? 1 : 2;
      const mM = s => M4.mul(M4.trans(piv[0], piv[1], piv[2]), M4.rotZ(-sg * (1 - s.gear) * 86 * D2R));
      parts.push({ mesh: glx.mesh(mg.data()), mode: 0, gear: true, mat: s => M4.mul(mM(s), M4.trans(0, s.comp[gi], 0)) });
      for (const z of [-0.75, 0.75]) parts.push({ mesh: mainW, mode: 0, gear: true, mat: s => M4.mul(mM(s), M4.mul(M4.trans(0, -3.25 + s.comp[gi], z), M4.rotX(-s.wheelSpin / 0.65 * 0.6))) });
    }
  }
  // navigation, strobe, beacon and landing lights in model space: [pos, colour, intensity, size, kind]
  const lights = [
    { p: P(-12.6, -30.0, 1.7), c: [1, 0.1, 0.08], i: 1.4, s: 2.6, k: 'nav', tip: 1 }, { p: P(-12.6, 30.0, 1.7), c: [0.15, 1, 0.3], i: 1.4, s: 2.6, k: 'nav', tip: 1 }, { p: P(-29.8, 0, 1.9), c: [1, 1, 1], i: 1.0, s: 2.2, k: 'nav' },
    { p: P(-12.3, -30.05, 1.72), c: [1, 1, 1], i: 3, s: 3.2, k: 'strobe', tip: 1 }, { p: P(-12.3, 30.05, 1.72), c: [1, 1, 1], i: 3, s: 3.2, k: 'strobe', tip: 1 },
    { p: P(3, 0, 3.05), c: [1, 0.1, 0.05], i: 2.2, s: 3, k: 'beacon' }, { p: P(0, 0, -3.2), c: [1, 0.1, 0.05], i: 2.2, s: 3, k: 'beacon' },
    { p: P(7.4, -3.3, -1.0), c: [1, 0.97, 0.9], i: 4, s: 4.5, k: 'land' }, { p: P(7.4, 3.3, -1.0), c: [1, 0.97, 0.9], i: 4, s: 4.5, k: 'land' }, { p: P(22.7, 0, -3.5), c: [1, 0.97, 0.9], i: 3, s: 3.5, k: 'taxi' }
  ];
  return { parts, lights };
}
