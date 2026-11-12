'use strict';
/* ============================================================
   Flight simulation core: math, terrain, atmosphere, 6-DOF
   rigid-body flight model, landing gear, autopilot.
   No rendering here. Physics frame is NED (north, east, down),
   body frame is FRD (forward, right, down). Runs in Node for tests.
   ============================================================ */
const FS = (function () {
  const D2R = Math.PI / 180, R2D = 180 / Math.PI, G = 9.80665;
  const KT = 1.943844, FT = 3.28084, NM = 1852;
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { let t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const wrapPi = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
  const wrap360 = a => { a %= 360; return a < 0 ? a + 360 : a; };

  // ---------- quaternions [w,x,y,z], body -> world
  function qMul(a, b) {
    return [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
      a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
      a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
      a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
  }
  function qRot(q, v) { // body -> world
    const w = q[0], x = q[1], y = q[2], z = q[3];
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
  }
  function qRotInv(q, v) { return qRot([q[0], -q[1], -q[2], -q[3]], v); }
  function qFromEuler(phi, th, psi) {
    const cf = Math.cos(phi / 2), sf = Math.sin(phi / 2), ct = Math.cos(th / 2), st = Math.sin(th / 2), cp = Math.cos(psi / 2), sp = Math.sin(psi / 2);
    return [cf * ct * cp + sf * st * sp, sf * ct * cp - cf * st * sp, cf * st * cp + sf * ct * sp, cf * ct * sp - sf * st * cp];
  }
  function eulerFromQ(q) {
    const w = q[0], x = q[1], y = q[2], z = q[3];
    return {
      phi: Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)),
      theta: Math.asin(clamp(2 * (w * y - z * x), -1, 1)),
      psi: Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
    };
  }
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  // ---------- deterministic noise
  function hash2(ix, iy, seed) {
    let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, oct, seed) {
    let s = 0, a = 0.5, n = 0;
    for (let i = 0; i < oct; i++) { s += a * vnoise(x, y, seed + i * 7); n += a; x = x * 2.03 + 11.7; y = y * 2.03 - 5.3; a *= 0.5; }
    return s / n;
  }
  function ridged(x, y, oct, seed) {
    let s = 0, a = 0.5, n = 0, w = 1;
    for (let i = 0; i < oct; i++) {
      let r = 1 - Math.abs(2 * vnoise(x, y, seed + i * 13) - 1); r *= r;
      s += a * r * w; n += a; w = clamp(r * 1.6, 0, 1); x = x * 2.07 + 3.1; y = y * 2.07 + 9.4; a *= 0.5;
    }
    return s / n;
  }
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

  // ---------- world definition
  const WORLD_HALF = 64000, NG = 513, CELL = 2 * WORLD_HALF / (NG - 1);
  const AIRPORTS = [
    { id: 'MRD', name: 'Meridian International', n: -24000, e: -20000, elev: 14, hdg: 90, len: 3600, width: 60 },
    { id: 'HLB', name: 'Halcyon Bay', n: 23000, e: 30000, elev: 9, hdg: 30, len: 2900, width: 45 },
    { id: 'KVA', name: 'Kestrel Valley', n: 10000, e: -6000, elev: 640, hdg: 140, len: 2700, width: 45 }
  ];
  AIRPORTS.forEach(a => {
    a.dn = Math.cos(a.hdg * D2R); a.de = Math.sin(a.hdg * D2R);
    a.a = [a.n - a.dn * a.len / 2, a.e - a.de * a.len / 2];
    a.b = [a.n + a.dn * a.len / 2, a.e + a.de * a.len / 2];
  });
  const CITIES = [
    { name: 'Meridian City', n: -17500, e: -12500, r: 5200, tall: 1.0, count: 2600 },
    { name: 'Port Halcyon', n: 27800, e: 29200, r: 2600, tall: 0.45, count: 800 },
    { name: 'Kestrel', n: 6600, e: -2400, r: 1500, tall: 0.25, count: 350 },
    { name: 'Saltmarsh', n: -30500, e: 4000, r: 2000, tall: 0.3, count: 450 },
    { name: 'Eastwick', n: -4000, e: 30000, r: 2300, tall: 0.4, count: 550 }
  ];
  const BAYS = [{ n: -35500, e: -19000, r: 10500 }, { n: 31500, e: 38500, r: 9500 }];
  function runwayName(h) { let r = Math.round(wrap360(h) / 10); if (r === 0) r = 36; return (r < 10 ? '0' : '') + r; }
  // A runway end: threshold position, course flown when landing/departing on it.
  function runway(apId, recip) {
    const a = AIRPORTS.find(x => x.id === apId);
    const course = wrap360(a.hdg + (recip ? 180 : 0));
    const thr = recip ? a.b : a.a, far = recip ? a.a : a.b;
    return { ap: a, id: apId + ' ' + runwayName(course), name: runwayName(course), course, thr, far, elev: a.elev, len: a.len, width: a.width, dn: Math.cos(course * D2R), de: Math.sin(course * D2R), recip: !!recip };
  }
  function segDist(n, e, a, b) {
    const vn = b[0] - a[0], ve = b[1] - a[1], wn = n - a[0], we = e - a[1];
    const t = clamp((wn * vn + we * ve) / (vn * vn + ve * ve), 0, 1);
    return Math.hypot(wn - t * vn, we - t * ve);
  }

  function rawHeight(n, e) {
    const x = e / WORLD_HALF, y = n / WORLD_HALF;
    const warp = fbm(n / 30000 + 3.1, e / 30000 + 7.7, 3, 11) - 0.5;
    const warp2 = fbm(n / 9000 + 1.7, e / 9000 + 2.9, 3, 17) - 0.5;
    const dc = Math.sqrt(x * x * 1.0 + y * y * 1.12) + warp * 0.55 + warp2 * 0.17;
    let land = sstep(0.88, 0.60, dc);
    // offshore islands, and two bays that bring the sea up to the coastal airports
    land = Math.max(land, sstep(0.66, 0.78, fbm(n / 6500 + 4.4, e / 6500 + 9.1, 3, 61)) * sstep(0.86, 0.98, dc) * sstep(1.45, 1.2, dc));
    for (const b of BAYS) land *= 1 - sstep(b.r * 1.25, b.r * 0.7, Math.hypot(n - b.n, e - b.e) * (1 + warp2 * 0.5));
    for (const a of AIRPORTS) land = Math.max(land, sstep(9000, 3500, segDist(n, e, a.a, a.b)));
    for (const c of CITIES) land = Math.max(land, sstep(c.r * 1.6, c.r * 0.9, Math.hypot(n - c.n, e - c.e)));
    const base = 20 + 150 * fbm(n / 16000 + 1.3, e / 16000 + 4.2, 4, 21);
    const hills = 150 * Math.pow(fbm(n / 4200, e / 4200, 4, 31), 2);
    // mountain range: band around an axis through (14k,-8k) heading 105 deg, fading to the east
    const un = Math.cos(105 * D2R), ue = Math.sin(105 * D2R);
    const rn = n - 14000, re = e + 8000;
    const perp = rn * ue - re * un, along = rn * un + re * ue;
    const band = Math.exp(-Math.pow(perp / 14500, 2)) * sstep(40000, 12000, along) * sstep(-52000, -30000, along);
    const mm = fbm(n / 34000 + 8.5, e / 34000 + 2.5, 3, 41);
    const mtn = band * (0.45 + 0.55 * sstep(0.3, 0.62, mm)) * (240 + 3500 * Math.pow(ridged(n / 10500, e / 10500, 5, 51), 1.35));
    let h = base + hills + mtn;
    h = lerp(-90, 2.5, sstep(0, 0.5, land)) + h * Math.pow(sstep(0.42, 1, land), 1.4);
    for (const a of AIRPORTS) {
      // valley along the extended centreline keeps approaches clear, then a flat pad
      const ext = 15000;
      const ea = [a.a[0] - a.dn * ext, a.a[1] - a.de * ext], eb = [a.b[0] + a.dn * ext, a.b[1] + a.de * ext];
      const v = sstep(8500, 2200, segDist(n, e, ea, eb));
      if (h > a.elev) h = a.elev + (h - a.elev) * (1 - 0.93 * v);
      const t = sstep(4200, 1500, segDist(n, e, a.a, a.b));
      h = lerp(h, a.elev, t);
    }
    for (const c of CITIES) { // cities sit on gently graded ground
      const t = sstep(c.r * 1.3, c.r * 0.6, Math.hypot(n - c.n, e - c.e)) * 0.8;
      const lvl = Math.max(6, Math.min(h, c.name === 'Kestrel' ? 660 : 60));
      h = lerp(h, lvl, t);
    }
    return h;
  }

  function buildWorld() {
    const H = new Float32Array(NG * NG);
    for (let i = 0; i < NG; i++) {
      const n = -WORLD_HALF + i * CELL;
      for (let j = 0; j < NG; j++) H[i * NG + j] = rawHeight(n, -WORLD_HALF + j * CELL);
    }
    function heightAt(n, e) {
      let fi = (n + WORLD_HALF) / CELL, fj = (e + WORLD_HALF) / CELL;
      if (fi < 0 || fj < 0 || fi > NG - 1 || fj > NG - 1) return -90;
      let i = Math.min(Math.floor(fi), NG - 2), j = Math.min(Math.floor(fj), NG - 2);
      const ti = fi - i, tj = fj - j, k = i * NG + j;
      // same diagonal split as the rendered mesh
      const h00 = H[k], h01 = H[k + 1], h10 = H[k + NG], h11 = H[k + NG + 1];
      return (ti + tj <= 1) ? h00 + (h10 - h00) * ti + (h01 - h00) * tj : h11 + (h01 - h11) * (1 - ti) + (h10 - h11) * (1 - tj);
    }
    function surfaceAt(n, e) {
      for (const a of AIRPORTS) {
        const rn = n - a.n, re = e - a.e, al = rn * a.dn + re * a.de, cr = -rn * a.de + re * a.dn;
        if (Math.abs(al) <= a.len / 2 + 90 && Math.abs(cr) <= a.width / 2 + 3) return 'runway';
        if (segDist(n, e, a.a, a.b) < 1300) return 'airport';
      }
      return heightAt(n, e) <= 0.2 ? 'water' : 'terrain';
    }
    return { H, NG, CELL, HALF: WORLD_HALF, heightAt, surfaceAt, airports: AIRPORTS, cities: CITIES };
  }

  // ---------- ISA atmosphere
  function atmosphere(alt) {
    const h = clamp(alt, -500, 20000);
    let T, p;
    if (h < 11000) { T = 288.15 - 0.0065 * h; p = 101325 * Math.pow(T / 288.15, 5.2559); }
    else { T = 216.65; p = 22632 * Math.exp(-(h - 11000) / 6341.6); }
    return { rho: p / (287.05 * T), a: Math.sqrt(1.4 * 287.05 * T), T };
  }

  // ---------- aircraft constants (twin-engine widebody, 787-8 class)
  const AC = {
    S: 361, b: 60.1, c: 6.3, mZeroFuel: 150000, fuelMax: 101000,
    Ixx: 1.45e7, Iyy: 2.7e7, Izz: 3.9e7, mRef: 180000,
    Tmax: 320000, engY: 9.7, engZ: 2.2,
    CL0: 0.20, CLa: 5.0, aStall: 15 * D2R, aStallNeg: -11 * D2R,
    CD0: 0.0175, kInd: 0.041, CDgear: 0.021, CDspoil: 0.045,
    CYb: -0.9, CYdr: -0.16,
    Clb: -0.10, Clp: -0.48, Clr: 0.10, Clda: 0.085,
    Cm0: 0.05, Cma: -1.5, Cmq: -34, Cmde: 0.39, CmTrim: 0.30,
    Cnb: 0.14, Cnr: -0.30, Cnp: -0.03, Cndr: 0.04, Cnda: -0.004,
    N1idle: 22
  };
  const FLAPS = [
    { name: 'UP', deg: 0, dCL: 0, dCD: 0 }, { name: '1', deg: 1, dCL: 0.08, dCD: 0.004 },
    { name: '5', deg: 5, dCL: 0.21, dCD: 0.010 }, { name: '15', deg: 15, dCL: 0.36, dCD: 0.024 },
    { name: '20', deg: 20, dCL: 0.45, dCD: 0.034 }, { name: '25', deg: 25, dCL: 0.55, dCD: 0.050 },
    { name: '30', deg: 30, dCL: 0.65, dCD: 0.068 }
  ];
  function flapCoef(deg) {
    for (let i = 1; i < FLAPS.length; i++) if (deg <= FLAPS[i].deg) {
      const a = FLAPS[i - 1], b = FLAPS[i], t = (deg - a.deg) / (b.deg - a.deg);
      return { dCL: lerp(a.dCL, b.dCL, t), dCD: lerp(a.dCD, b.dCD, t) };
    }
    return { dCL: FLAPS[6].dCL, dCD: FLAPS[6].dCD };
  }
  // contact points in body frame (x fwd, y right, z down), origin at CG on fuselage axis
  const GEAR = [
    { id: 'nose', r: [22.6, 0, 5.6], k: 6.0e5, c: 1.7e5, steer: true },
    { id: 'left', r: [-2.6, -4.9, 5.6], k: 2.7e6, c: 4.6e5, brake: true },
    { id: 'right', r: [-2.6, 4.9, 5.6], k: 2.7e6, c: 4.6e5, brake: true }
  ];
  const SOFT = [
    { id: 'belly', r: [14, 0, 2.95] }, { id: 'belly', r: [0, 0, 3.1] }, { id: 'belly', r: [-14, 0, 2.9] },
    { id: 'tail', r: [-29, 0, 0.5] }, { id: 'engine', r: [4, -9.7, 4.5] }, { id: 'engine', r: [4, 9.7, 4.5] }
  ];
  const HARD = [
    { id: 'Left wingtip', r: [-13, -30, -1.6] }, { id: 'Right wingtip', r: [-13, 30, -1.6] }, { id: 'Nose', r: [27, 0, 1.2] }
  ];

  const WEATHER = {
    clear: { name: 'Clear', cover: 0.12, base: 2400, top: 3300, vis: 90000, windDir: 110, windSpd: 3, turb: 0.25, rain: 0, storm: 0 },
    scattered: { name: 'Scattered cloud', cover: 0.42, base: 1700, top: 3200, vis: 60000, windDir: 240, windSpd: 7, turb: 0.8, rain: 0, storm: 0 },
    overcast: { name: 'Overcast', cover: 0.85, base: 1100, top: 2600, vis: 22000, windDir: 200, windSpd: 9, turb: 1.2, rain: 0.25, storm: 0 },
    storm: { name: 'Thunderstorm', cover: 1.0, base: 900, top: 5200, vis: 9000, windDir: 250, windSpd: 19, turb: 5.2, rain: 1, storm: 1 },
    fog: { name: 'Fog', cover: 0.95, base: 90, top: 700, vis: 1100, windDir: 290, windSpd: 2, turb: 0.2, rain: 0, storm: 0 },
    crosswind: { name: 'Gusting crosswind', cover: 0.5, base: 1300, top: 2600, vis: 35000, windDir: 120, windSpd: 14, turb: 2.3, rain: 0, storm: 0 }
  };

  // ============================================================
  class Sim {
    constructor(world) {
      this.world = world;
      this.rand = rng(12345);
      this.weather = Object.assign({}, WEATHER.clear);
      this.inp = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0 };
      this.reset();
    }
    reset() {
      this.s = {
        pos: [0, 0, -1000], vel: [0, 0, 0], q: [1, 0, 0, 0], om: [0, 0, 0],
        fuel: 30000, n1: [22, 22], engOn: [true, true], egt: [400, 400],
        flapIdx: 0, flapDeg: 0, gearTarget: 1, gear: 1, spoilerLever: 0, spoiler: 0, parkBrake: false,
        ail: 0, elev: 0, rud: 0, trim: 0.1, steer: 0,
        wow: [false, false, false], comp: [0, 0, 0], wheelSpin: 0,
        t: 0, dist: 0, airTime: 0, ditched: false
      };
      this.gust = [0, 0, 0]; this.pg = 0; this.draft = 0;
      this.ap = { on: false, at: false, lat: 'HDG', vert: 'ALT', appArmed: false, hdg: 0, alt: 1000, vs: 0, spd: 120, thInt: 0, thrInt: 0.5, locCap: false, gsCap: false, flare: false };
      this.nav = { ils: null, route: [], wp: 0 };
      this.inp.pitch = this.inp.roll = this.inp.yaw = 0; this.inp.throttle = 0; this.inp.brake = 0;
      this.crashed = null; this.events = []; this.lastTouch = null; this.fuelLeak = 0;
      this.d = { ias: 0, tas: 0, mach: 0, alt: 0, agl: 0, vs: 0, gs: 0, track: 0, hdg: 0, pitch: 0, roll: 0, alpha: 0, beta: 0, nz: 1, stall: 0, stallWarn: false, onGround: false, thrust: [0, 0], ff: [0, 0], iasDot: 0, windN: 0, windE: 0, surface: 'terrain' };
      this._iasPrev = 0;
    }
    mass() { return AC.mZeroFuel + this.s.fuel; }

    // ----- placement helpers
    placeOnRunway(apId, recip) {
      const r = runway(apId, recip), s = this.s;
      s.pos = [r.thr[0] + r.dn * 70, r.thr[1] + r.de * 70, -(r.elev + 5.3)];
      s.vel = [0, 0, 0]; s.om = [0, 0, 0]; s.q = qFromEuler(0, 0, r.course * D2R);
      s.gear = s.gearTarget = 1; s.parkBrake = true; s.n1 = [22, 22]; s.trim = 0.22;
      this.inp.throttle = 0;
      for (let i = 0; i < 240; i++) this.step(1 / 120);
      s.t = 0; s.dist = 0; s.airTime = 0; this.events.length = 0; this.lastTouch = null;
    }
    placeInAir(o) {
      const s = this.s, P = AC;
      const atm = atmosphere(o.alt), ias = o.ias, tas = ias / Math.sqrt(atm.rho / 1.225);
      const gam = o.gamma || 0, psi = o.hdg * D2R;
      s.flapIdx = o.flapIdx || 0; s.flapDeg = FLAPS[s.flapIdx].deg;
      s.gear = s.gearTarget = o.gear ? 1 : 0; s.parkBrake = false;
      const fc = flapCoef(s.flapDeg), qbar = 0.5 * atm.rho * tas * tas, W = this.mass() * G;
      const CL = W * Math.cos(gam) / (qbar * P.S), alpha = (CL - P.CL0 - fc.dCL) / P.CLa;
      const CD = P.CD0 + fc.dCD + s.gear * P.CDgear + P.kInd * CL * CL;
      const Treq = Math.max(0, qbar * P.S * CD + W * Math.sin(gam));
      const lapse = Math.pow(atm.rho / 1.225, 0.8) * (1 - 0.28 * tas / atm.a);
      const frac = clamp(Treq / (2 * P.Tmax * lapse), 0, 1);
      const x = Math.pow(clamp((frac - 0.04) / 0.96, 0, 1), 1 / 1.5);
      this.inp.throttle = x; s.n1 = [P.N1idle + (100 - P.N1idle) * x, P.N1idle + (100 - P.N1idle) * x];
      const cmThrust = Treq * P.engZ / (qbar * P.S * P.c);
      s.trim = clamp(-(P.Cm0 + P.Cma * alpha + cmThrust - 0.03 * (s.flapDeg / 30)) / P.CmTrim, -0.6, 1.3);
      s.q = qFromEuler(0, alpha + gam, psi);
      s.vel = [tas * Math.cos(gam) * Math.cos(psi), tas * Math.cos(gam) * Math.sin(psi), -tas * Math.sin(gam)];
      // add steady wind so the aircraft starts at the requested airspeed
      const w = this.weather, wn = -w.windSpd * Math.cos(w.windDir * D2R), we = -w.windSpd * Math.sin(w.windDir * D2R);
      s.vel[0] += wn; s.vel[1] += we;
      s.pos = [o.n, o.e, -o.alt]; s.om = [0, 0, 0];
      s.ail = s.elev = s.rud = 0; s.t = 0; s.dist = 0; s.airTime = 0;
      this.step(1 / 120);
      if (o.ap) this.apEngage(true);
    }

    // ----- autopilot
    apEngage(withAT) {
      const ap = this.ap, d = this.d;
      ap.on = true; ap.lat = 'HDG'; ap.vert = 'ALT'; ap.locCap = ap.gsCap = ap.flare = false;
      ap.hdg = Math.round(d.hdg); ap.alt = Math.round(d.alt * FT / 100) * 100 / FT; ap.vs = 0;
      ap.thInt = d.pitch;
      if (withAT) this.atEngage();
    }
    atEngage() { const ap = this.ap; ap.at = true; ap.spd = Math.round(this.d.ias * KT) / KT; ap.thrInt = this.inp.throttle; }
    apDisengage() { const ap = this.ap; ap.on = false; ap.appArmed = false; ap.locCap = ap.gsCap = ap.flare = false; if (ap.lat !== 'NAV') ap.lat = 'HDG'; if (ap.vert === 'GS' || ap.vert === 'FLARE') ap.vert = 'ALT'; }
    ilsDev(rw) {
      rw = rw || this.nav.ils; if (!rw) return null;
      const s = this.s, rn = s.pos[0] - rw.thr[0], re = s.pos[1] - rw.thr[1];
      const along = rn * rw.dn + re * rw.de, crossT = -rn * rw.de + re * rw.dn;
      const dLoc = rw.len + 300 - along; // distance to the localizer antenna past the far end
      const locDeg = Math.atan2(crossT, Math.max(dLoc, 50)) * R2D;
      const dGs = 300 - along; // glide path aims 300 m past the threshold
      const h = -s.pos[2] - rw.elev;
      const gsDeg = Math.atan2(h, Math.max(dGs, 1)) * R2D - 3;
      return { along, cross: crossT, locDeg, gsDeg, dist: Math.max(0, -along), pathAlt: rw.elev + Math.max(dGs, 0) * Math.tan(3 * D2R), valid: dLoc > 0 && dLoc < 60000 && Math.abs(locDeg) < 35 };
    }
    apUpdate(dt) {
      const s = this.s, ap = this.ap, d = this.d, inp = this.inp;
      const engines = (s.engOn[0] || s.engOn[1]) && s.fuel > 0;
      if (ap.at && engines) {
        const err = ap.spd - d.ias;
        let thr = ap.thrInt + err * 0.07 - d.iasDot * 0.16;
        if (thr > 0 && thr < 1 || (thr >= 1 && err < 0) || (thr <= 0 && err > 0)) ap.thrInt = clamp(ap.thrInt + err * 0.010 * dt, 0, 1);
        if (ap.flare && d.agl < 6) thr = 0;
        thr = clamp(thr, 0, 1);
        inp.throttle += clamp(thr - inp.throttle, -0.35 * dt, 0.35 * dt);
      }
      if (!ap.on) return null;
      const il = this.ilsDev();
      // approach capture logic
      if (ap.appArmed && il && il.valid) {
        const rw = this.nav.ils;
        if (!ap.locCap && Math.abs(il.locDeg) < 2.2 && Math.abs(wrapPi(d.track * D2R - rw.course * D2R)) < 1.5) { ap.locCap = true; ap.lat = 'LOC'; this.events.push({ type: 'msg', text: 'LOC captured' }); }
        if (ap.locCap && !ap.gsCap && il.gsDeg > -0.2 && il.gsDeg < 1.6 && Math.abs(il.locDeg) < 1.2 && il.dist > 1500) { ap.gsCap = true; ap.vert = 'GS'; this.events.push({ type: 'msg', text: 'Glideslope captured' }); }
      }
      // ---- lateral
      let trackC;
      const useTrack = d.gs > 40 ? d.track : d.hdg;
      if (ap.lat === 'LOC' && il) {
        const rw = this.nav.ils;
        const crossDot = d.gs * Math.sin((d.track - rw.course) * D2R);
        trackC = rw.course - clamp(0.0016 * il.cross + 0.016 * crossDot, -0.52, 0.52) * R2D;
      } else if (ap.lat === 'NAV' && this.nav.route.length) {
        const wp = this.nav.route[Math.min(this.nav.wp, this.nav.route.length - 1)];
        trackC = Math.atan2(wp.e - s.pos[1], wp.n - s.pos[0]) * R2D;
      } else { trackC = null; }
      let err;
      if (trackC === null) err = wrapPi((ap.hdg - d.hdg) * D2R); else err = wrapPi((trackC - useTrack) * D2R);
      const bankLim = (ap.lat === 'LOC' ? 22 : 25) * D2R;
      const phiC = clamp(err * 1.4, -bankLim, bankLim);
      const roll = clamp(3.2 * (phiC - d.roll) - 1.6 * s.om[0], -1, 1);
      // ---- vertical
      let vsT;
      if (ap.vert === 'GS' && il) {
        const dz = d.alt - il.pathAlt;
        vsT = -d.gs * Math.tan(3 * D2R) - clamp(0.22 * dz, -5, 5);
        if (d.agl < 21) { ap.flare = true; }
        if (ap.flare) vsT = Math.max(vsT, -(0.3 + 0.17 * Math.max(d.agl, 0)));
      } else if (ap.vert === 'VS') {
        vsT = ap.vs;
        if (Math.abs(ap.alt - d.alt) < 50 && Math.sign(ap.alt - d.alt) !== -Math.sign(ap.vs || 1)) { ap.vert = 'ALT'; }
      } else {
        const lim = 10.5;
        vsT = clamp(0.14 * (ap.alt - d.alt), -lim, lim);
      }
      const vsErr = vsT - d.vs;
      ap.thInt = clamp(ap.thInt + vsErr * 0.0030 * dt, -0.16, 0.30);
      let thC = clamp(ap.thInt + vsErr * (ap.flare ? 0.03 : 0.011), -0.2, 0.32);
      if (d.alpha > 10.5 * D2R) thC -= (d.alpha - 10.5 * D2R) * 2.5;
      const pitch = clamp(5.5 * (thC - d.pitch) - 3.2 * s.om[1], -1, 1);
      return { pitch, roll };
    }

    // ----- wind field
    windAt(agl) {
      const w = this.weather, s = this.s;
      const bl = 0.55 + 0.45 * clamp(agl / 350, 0, 1);
      const spd = w.windSpd * bl;
      let wd = 0;
      if (w.storm > 0 && agl > 150) { // convective up/downdrafts fixed in space
        wd = -(vnoise(s.pos[0] / 1700, s.pos[1] / 1700, 77) - 0.5) * 2 * 11 * w.storm * clamp((agl - 150) / 600, 0, 1);
      }
      return [-spd * Math.cos(w.windDir * D2R), -spd * Math.sin(w.windDir * D2R), wd];
    }
    gauss() { return (this.rand() + this.rand() + this.rand() + this.rand() - 2) * 1.732; }

    // ----- main physics step
    step(dt) {
      if (this.crashed) return;
      const s = this.s, P = AC, inp = this.inp, w = this.weather, d = this.d;
      s.t += dt;
      const alt = -s.pos[2];
      const gh = this.world.heightAt(s.pos[0], s.pos[1]);
      const ground = Math.max(gh, 0), agl = alt - ground;
      const atm = atmosphere(alt);
      const m = this.mass(), kI = m / P.mRef;
      const eu = eulerFromQ(s.q);

      // ---- turbulence (Ornstein-Uhlenbeck gusts)
      const Vref = Math.max(d.tas, 30), tau = 420 / Vref;
      const sig = w.turb * (0.55 + 0.45 * clamp(agl / 300, 0, 1)) * (agl < 2 ? 0.3 : 1);
      const kq = Math.sqrt(2 * dt / tau);
      for (let i = 0; i < 3; i++) this.gust[i] += -this.gust[i] * dt / tau + sig * (i === 2 ? 0.8 : 1) * kq * this.gauss();
      this.pg += -this.pg * dt / 1.2 + sig * 0.014 * Math.sqrt(2 * dt / 1.2) * this.gauss();
      const wind = this.windAt(agl);
      const wn = wind[0] + this.gust[0], we = wind[1] + this.gust[1], wd = wind[2] + this.gust[2];

      // ---- air data
      const vb = qRotInv(s.q, [s.vel[0] - wn, s.vel[1] - we, s.vel[2] - wd]);
      const V = Math.hypot(vb[0], vb[1], vb[2]), Vs = Math.max(V, 6);
      const alpha = V > 1 ? Math.atan2(vb[2], vb[0]) : 0;
      const beta = V > 1 ? Math.asin(clamp(vb[1] / V, -1, 1)) : 0;
      const qbar = 0.5 * atm.rho * V * V, mach = V / atm.a;
      const ias = V * Math.sqrt(atm.rho / 1.225);

      // ---- autopilot / control mixing
      const apc = this.apUpdate(dt);
      let cp = inp.pitch, cr = inp.roll, cy = inp.yaw;
      if (apc) { cp = apc.pitch; cr = apc.roll; }
      const onGround = s.wow[0] || s.wow[1] || s.wow[2];
      // yaw damper + turn coordination (fly-by-wire), fades out with pilot rudder
      if (!onGround && V > 40) cy = clamp(cy + (1 - Math.min(1, Math.abs(inp.yaw) * 1.5)) * (2.2 * beta - 1.1 * (s.om[2] - G * Math.sin(eu.phi) * Math.cos(eu.theta) / Vs)), -1, 1);
      const rate = 2.6 * dt;
      s.elev += clamp(cp - s.elev, -rate, rate); s.ail += clamp(cr - s.ail, -rate, rate); s.rud += clamp(cy - s.rud, -rate, rate);
      // auto-trim: trim follows held pitch input so attitude roughly stays where it is left
      // (inhibited near the stall so trim cannot wind the aircraft into one)
      if (!onGround && !(s.elev > 0 && alpha > 9.5 * D2R) && !(s.elev < 0 && alpha < -3 * D2R)) s.trim = clamp(s.trim + s.elev * (apc ? 0.30 : 0.14) * dt, -0.7, 1.4);
      // high-speed feel: less deflection as dynamic pressure rises
      const feel = clamp(Math.pow(105 / Math.max(ias, 1), 1.6), 0.22, 1);
      // nose-up authority tapers as angle of attack nears the stall (stall is still reachable)
      const aProt = s.elev > 0 ? clamp((14.5 * D2R - alpha) / (6 * D2R), 0.45, 1) : 1;
      const de = s.elev * feel * aProt, da = s.ail * clamp(Math.pow(120 / Math.max(ias, 1), 1.2), 0.3, 1) * 20 * D2R, dr = s.rud * clamp(Math.pow(90 / Math.max(ias, 1), 2), 0.12, 1) * 26 * D2R;

      // ---- systems: flaps, gear, spoilers
      const fT = FLAPS[s.flapIdx].deg; s.flapDeg += clamp(fT - s.flapDeg, -2.6 * dt, 2.6 * dt);
      s.gear += clamp(s.gearTarget - s.gear, -dt / 7, dt / 7);
      let spT = s.spoilerLever;
      if (onGround && inp.throttle < 0.12 && d.gs > 18) spT = 1; // auto ground spoilers
      s.spoiler += clamp(spT - s.spoiler, -1.6 * dt, 1.6 * dt);
      const fc = flapCoef(s.flapDeg);

      // ---- engines
      let T = [0, 0], ffTot = 0;
      const lapse = Math.pow(atm.rho / 1.225, 0.8) * (1 - 0.28 * Math.min(mach, 0.95));
      if (s.fuel <= 0 && (s.engOn[0] || s.engOn[1])) { s.engOn = [false, false]; this.events.push({ type: 'alert', text: 'FUEL EXHAUSTED — both engines flamed out' }); }
      for (let i = 0; i < 2; i++) {
        const run = s.engOn[i];
        const tgt = run ? P.N1idle + (100 - P.N1idle) * clamp(inp.throttle, 0, 1) : clamp(ias * 0.085, 0, 14);
        const tc = run ? 1.3 + 3.2 * (1 - s.n1[i] / 100) : 4;
        s.n1[i] += (tgt - s.n1[i]) * dt / tc;
        if (run) {
          const x = clamp((s.n1[i] - P.N1idle) / (100 - P.N1idle), 0, 1);
          T[i] = P.Tmax * lapse * (0.04 + 0.96 * Math.pow(x, 1.5));
          d.ff[i] = 0.28 + 1.05e-5 * T[i]; ffTot += d.ff[i];
        } else { d.ff[i] = 0; }
        const egtT = run ? 330 + 5.3 * s.n1[i] : 60 + s.n1[i] * 6;
        s.egt[i] += (egtT - s.egt[i]) * dt / 6;
      }
      s.fuel = Math.max(0, s.fuel - (ffTot + this.fuelLeak) * dt);
      d.thrust = T;
      const Ttot = T[0] + T[1];

      // ---- aerodynamic coefficients
      const hb = clamp(agl / P.b, 0, 2), ge = 1 - 0.55 * Math.exp(-5.5 * hb); // ground effect on induced drag
      const Mk = 42, aS = P.aStall, aN = P.aStallNeg;
      const e1 = Math.exp(-Mk * (alpha - aS)), e2 = Math.exp(Mk * (alpha - aN));
      const sg = (1 + e1 + e2) / ((1 + e1) * (1 + e2)); // 0 attached .. 1 stalled
      const CLlin = P.CL0 + fc.dCL + P.CLa * alpha - 0.30 * s.spoiler * (onGround ? 2 : 1);
      const CLpost = 0.95 * Math.sin(2 * alpha) + (alpha > 0 ? 0.25 * fc.dCL : 0);
      const CL = (1 - sg) * CLlin + sg * CLpost;
      const CDp = P.CD0 + fc.dCD + s.gear * P.CDgear + s.spoiler * P.CDspoil + (s.engOn[0] ? 0 : 0.004) + (s.engOn[1] ? 0 : 0.004)
        + (mach > 0.86 ? 22 * (mach - 0.86) * (mach - 0.86) : 0) + 0.7 * Math.sin(beta) * Math.sin(beta);
      const CD = CDp + (1 - sg) * P.kInd * ge * CLlin * CLlin + sg * (0.06 + 1.7 * Math.sin(alpha) * Math.sin(alpha));
      const CY = P.CYb * beta + P.CYdr * dr;
      const b2v = P.b / (2 * Vs), c2v = P.c / (2 * Vs);
      const stallRoll = sg * 0.035 * Math.sin(s.t * 1.7 + 1.3) + sg * 0.02 * Math.sign(s.om[0] || 1);
      const Cl = P.Clb * beta + (P.Clp * (1 - 0.6 * sg) * (s.om[0] - this.pg) + P.Clr * s.om[2]) * b2v + P.Clda * (1 - 0.75 * sg) * da + stallRoll;
      const Cm = P.Cm0 + P.Cma * alpha + P.Cmq * s.om[1] * c2v + P.Cmde * de + P.CmTrim * s.trim - 0.03 * (s.flapDeg / 30) - 0.06 * sg;
      const Cn = P.Cnb * beta + (P.Cnr * s.om[2] + P.Cnp * s.om[0]) * b2v + P.Cndr * (dr / (26 * D2R)) + P.Cnda * s.ail;

      // ---- forces (body) and moments
      const L = qbar * P.S * CL, D = qbar * P.S * CD, Y = qbar * P.S * CY;
      const sa = Math.sin(alpha), ca = Math.cos(alpha);
      const Fb = [L * sa - D * vb[0] / Vs + Ttot, Y - D * vb[1] / Vs, -L * ca - D * vb[2] / Vs];
      const Mb = [qbar * P.S * P.b * Cl, qbar * P.S * P.c * Cm + Ttot * P.engZ, qbar * P.S * P.b * Cn + (T[0] - T[1]) * P.engY];
      const nz = -Fb[2] / (m * G);
      const Fw = qRot(s.q, Fb);
      Fw[2] += m * G;

      // ---- ground contact
      const surf = agl < 40 ? this.world.surfaceAt(s.pos[0], s.pos[1]) : 'air';
      d.surface = surf;
      const fwd = qRot(s.q, [1, 0, 0]); const fl = Math.hypot(fwd[0], fwd[1]) || 1; const f0 = [fwd[0] / fl, fwd[1] / fl];
      const gs = Math.hypot(s.vel[0], s.vel[1]);
      const wet = w.rain > 0.3;
      const brakeCmd = Math.max(inp.brake, s.parkBrake ? 1 : 0);
      s.steer = s.rud * lerp(62, 5, clamp(gs / 45, 0, 1)) * D2R;
      let anyContact = false, wowNow = [false, false, false];
      const contact = (pt, kind, gi) => {
        const rw = qRot(s.q, pt.r);
        const pn = s.pos[0] + rw[0], pe = s.pos[1] + rw[1];
        const gnd = Math.max(this.world.heightAt(pn, pe), 0);
        const pen = (s.pos[2] + rw[2]) + gnd; // down-positive penetration
        if (pen <= 0) { if (kind === 'gear') s.comp[gi] = 0; return; }
        const vp = qRot(s.q, cross(s.om, pt.r)); vp[0] += s.vel[0]; vp[1] += s.vel[1]; vp[2] += s.vel[2];
        const water = surf === 'water';
        if (kind === 'hard') { this.crash(pt.id + ' struck the ' + (water ? 'water' : 'ground')); return; }
        if (!anyContact && !onGround) { // first contact after flight: judge the arrival
          const sink = vp[2];
          if (water) {
            const ok = s.gear < 0.3 && sink < 4.6 && gs < 92 && Math.abs(eu.phi) < 12 * D2R && eu.theta > -1.5 * D2R && eu.theta < 15 * D2R;
            if (!ok) { this.crash(s.gear > 0.3 ? 'Ditched with the gear down — the aircraft broke up' : 'Hit the water too hard'); return; }
            if (!s.ditched) { s.ditched = true; this.events.push({ type: 'touchdown', water: true, vs: sink }); }
          } else {
            if (kind === 'gear' && sink > 6.2) { this.crash('Landing gear collapsed — touchdown at ' + Math.round(sink * 196.85) + ' fpm'); return; }
            if (kind === 'soft' && sink > 4.2) { this.crash('Fuselage impact at ' + Math.round(sink * 196.85) + ' fpm'); return; }
            if (surf === 'terrain' && gs > 38) { this.crash('Controlled flight into terrain'); return; }
          }
        }
        anyContact = true;
        let N, k, c;
        if (kind === 'gear') { k = pt.k; c = pt.c; s.comp[gi] = Math.min(pen, 0.7); wowNow[gi] = true; } else { k = 3.2e6; c = 7e5; }
        N = k * pen + c * vp[2] + (pen > 0.62 ? 2e7 * (pen - 0.62) : 0);
        if (N < 0) N = 0;
        let Fn = 0, Fe = 0;
        if (kind === 'gear' && !water) {
          let fn = f0[0], fe = f0[1];
          if (pt.steer) { const cs = Math.cos(s.steer), sn = Math.sin(s.steer); fn = f0[0] * cs - f0[1] * sn; fe = f0[0] * sn + f0[1] * cs; }
          const rn = -fe, re = fn;
          const vl = vp[0] * fn + vp[1] * fe, vt = vp[0] * rn + vp[1] * re;
          const mur = surf === 'runway' ? 0.016 : surf === 'airport' ? 0.035 : 0.12;
          const mub = pt.brake ? brakeCmd * (wet ? 0.36 : 0.50) : 0;
          const Fl = -N * (mur + mub) * Math.tanh(vl / 0.5);
          const slip = Math.atan2(vt, Math.abs(vl) + 2.5);
          const Ft = -N * (wet ? 0.55 : 0.8) * clamp(slip / 0.13, -1, 1);
          Fn = Fl * fn + Ft * rn; Fe = Fl * fe + Ft * re;
        } else {
          const mu = water ? 1.6 : 0.5, vh = Math.hypot(vp[0], vp[1]);
          Fn = -mu * N * vp[0] / (vh + 0.6); Fe = -mu * N * vp[1] / (vh + 0.6);
        }
        const F = [Fn, Fe, -N];
        Fw[0] += F[0]; Fw[1] += F[1]; Fw[2] += F[2];
        const mb = cross(pt.r, qRotInv(s.q, F));
        Mb[0] += mb[0]; Mb[1] += mb[1]; Mb[2] += mb[2];
      };
      if (agl < 45) {
        if (s.gear > 0.9) for (let i = 0; i < 3; i++) { contact(GEAR[i], 'gear', i); if (this.crashed) return; }
        for (const p of SOFT) { contact(p, 'soft'); if (this.crashed) return; }
        for (const p of HARD) { contact(p, 'hard'); if (this.crashed) return; }
      }
      const mainNow = wowNow[1] || wowNow[2], mainWas = s.wow[1] || s.wow[2];
      if (mainNow && !mainWas && s.airTime > 3) {
        this.lastTouch = { vs: s.vel[2], ias, gs, n: s.pos[0], e: s.pos[1], pitch: eu.theta, roll: eu.phi, t: s.t, hdg: wrap360(eu.psi * R2D), track: wrap360(Math.atan2(s.vel[1], s.vel[0]) * R2D) };
        this.events.push({ type: 'touchdown', vs: s.vel[2] });
        if (this.ap.on) { this.apDisengage(); this.ap.at = false; this.events.push({ type: 'alert', text: 'AUTOPILOT DISCONNECT — brake and steer' }); }
      }
      s.wow = wowNow;
      const nowGround = anyContact;
      if (!nowGround) s.airTime += dt; else if (!mainNow && !s.ditched) { /* belly */ }

      // ---- integrate
      const ax = Fw[0] / m, ay = Fw[1] / m, az = Fw[2] / m;
      s.vel[0] += ax * dt; s.vel[1] += ay * dt; s.vel[2] += az * dt;
      const Ix = P.Ixx * kI, Iy = P.Iyy * kI, Iz = P.Izz * kI, p = s.om[0], q = s.om[1], r = s.om[2];
      s.om[0] += (Mb[0] - (Iz - Iy) * q * r) / Ix * dt;
      s.om[1] += (Mb[1] - (Ix - Iz) * p * r) / Iy * dt;
      s.om[2] += (Mb[2] - (Iy - Ix) * p * q) / Iz * dt;
      if (nowGround && brakeCmd > 0.5 && gs < 0.35 && Ttot < 4e5) { s.vel[0] = 0; s.vel[1] = 0; s.om[2] = 0; }
      if (s.ditched && gs < 1.5) { s.vel[0] = s.vel[1] = 0; }
      s.pos[0] += s.vel[0] * dt; s.pos[1] += s.vel[1] * dt; s.pos[2] += s.vel[2] * dt;
      const h = 0.5 * dt, o = s.om, qq = s.q;
      const dq = qMul(qq, [0, o[0], o[1], o[2]]);
      qq[0] += dq[0] * h; qq[1] += dq[1] * h; qq[2] += dq[2] * h; qq[3] += dq[3] * h;
      const ql = Math.hypot(qq[0], qq[1], qq[2], qq[3]); qq[0] /= ql; qq[1] /= ql; qq[2] /= ql; qq[3] /= ql;
      s.dist += gs * dt;
      s.wheelSpin += (nowGround ? gs : Math.max(0, 1 - s.t)) * dt / 0.6;

      // ---- structural limits
      if (!nowGround && (nz > 4.2 || nz < -1.9)) { this.crash('Airframe overstressed at ' + nz.toFixed(1) + ' g'); return; }
      if (ias * KT > 445) { this.crash('Structural failure — exceeded maximum airspeed'); return; }

      // ---- derived values for instruments
      d.iasDot += ((ias - this._iasPrev) / dt - d.iasDot) * Math.min(1, dt * 1.5); this._iasPrev = ias;
      d.ias = ias; d.tas = V; d.mach = mach; d.alt = -s.pos[2]; d.agl = agl - (s.gear > 0.9 ? 5.3 : 3); d.vs = -s.vel[2]; d.gs = gs;
      d.track = gs > 1 ? wrap360(Math.atan2(s.vel[1], s.vel[0]) * R2D) : wrap360(eu.psi * R2D);
      d.hdg = wrap360(eu.psi * R2D); d.pitch = eu.theta; d.roll = eu.phi; d.alpha = alpha; d.beta = beta; d.nz = nz; d.stall = sg;
      d.stallWarn = !nowGround && alpha > aS - 2.6 * D2R; d.onGround = nowGround; d.windN = wn; d.windE = we;
      d.gndAlt = ground;
    }
    crash(reason) { if (!this.crashed) { this.crashed = { reason, t: this.s.t }; this.events.push({ type: 'crash', text: reason }); } }

    // stall speed estimate (m/s IAS) for current weight and flap setting
    vStall() { const fc = flapCoef(this.s.flapDeg); return Math.sqrt(2 * this.mass() * G / (1.225 * AC.S * (AC.CL0 + fc.dCL + AC.CLa * AC.aStall))); }
  }

  return { D2R, R2D, G, KT, FT, NM, clamp, lerp, sstep, wrapPi, wrap360, qMul, qRot, qRotInv, qFromEuler, eulerFromQ, cross, hash2, vnoise, fbm, ridged, rng, buildWorld, rawHeight, atmosphere, AC, FLAPS, GEAR, SOFT, HARD, WEATHER, AIRPORTS, CITIES, runway, runwayName, segDist, Sim, WORLD_HALF, NG, CELL };
})();
if (typeof module !== 'undefined') module.exports = FS;
