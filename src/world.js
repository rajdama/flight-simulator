'use strict';
/* Builds GPU geometry for the static world: terrain, airports, cities, lights, clouds.
   Render space: x = east, y = altitude, z = -north. */
function buildWorldGfx(glx, world) {
  const gl = glx.gl, NG = world.NG, W = world.HALF, CELL = world.CELL, H = world.H;
  const R = (n, e, y) => [e, y, -n];
  const rand = FS.rng(9871);
  const out = {};

  // ---------------- terrain: one vertex buffer, index ranges per chunk for culling
  {
    const pos = new Float32Array(NG * NG * 3), nor = new Int8Array(NG * NG * 4);
    for (let i = 0; i < NG; i++) for (let j = 0; j < NG; j++) {
      const k = i * NG + j;
      pos[k * 3] = -W + j * CELL; pos[k * 3 + 1] = H[k]; pos[k * 3 + 2] = W - i * CELL;
      const hE = H[i * NG + Math.min(j + 1, NG - 1)], hW = H[i * NG + Math.max(j - 1, 0)], hN = H[Math.min(i + 1, NG - 1) * NG + j], hS = H[Math.max(i - 1, 0) * NG + j];
      const nx = -(hE - hW) / (2 * CELL), nz = (hN - hS) / (2 * CELL), l = Math.hypot(nx, 1, nz);
      nor[k * 4] = nx / l * 127; nor[k * 4 + 1] = 1 / l * 127; nor[k * 4 + 2] = nz / l * 127;
    }
    const CH = 32, NC = (NG - 1) / CH, idx = [], chunks = [];
    for (let ci = 0; ci < NC; ci++) for (let cj = 0; cj < NC; cj++) {
      const first = idx.length; let mn = 1e9, mx = -1e9;
      for (let i = ci * CH; i < (ci + 1) * CH; i++) for (let j = cj * CH; j < (cj + 1) * CH; j++) {
        const a = i * NG + j, b = a + 1, c = a + NG, d = c + 1;
        const hm = Math.max(H[a], H[b], H[c], H[d]); if (hm < -10) continue;
        idx.push(a, b, c, d, c, b); mn = Math.min(mn, H[a], H[b], H[c], H[d]); mx = Math.max(mx, hm);
      }
      if (idx.length > first) {
        const cx = -W + (cj + 0.5) * CH * CELL, cz = W - (ci + 0.5) * CH * CELL, cy = (mn + mx) / 2;
        chunks.push({ first, count: idx.length - first, c: [cx, cy, cz], r: Math.hypot(CH * CELL * 0.7072, (mx - mn) / 2) });
      }
    }
    out.terrain = glx.mesh({ pos, nor, idx: new Uint32Array(idx) });
    out.chunks = chunks; out.terrainTris = idx.length / 3;
  }

  // ---------------- unit cube for instanced buildings (no bottom face)
  const cube = new Geo(); cube.box([-0.5, 0, -0.5], [0.5, 1, 0.5], [1, 1, 1], true);
  const inst = []; // x,y,z,yaw, sx,sy,sz,seed, r,g,b,a
  const lights = []; // x,y,z, r,g,b,int, size,class
  const addBox = (p, yaw, sx, sy, sz, col) => inst.push(p[0], p[1], p[2], yaw, sx, sy, sz, rand(), col[0], col[1], col[2], 1);
  const addLight = (p, col, int, size, cls) => lights.push(p[0], p[1], p[2], col[0], col[1], col[2], int, size, cls);
  const WHITE = [1, 0.96, 0.86], WARM = [1, 0.72, 0.38], GREEN = [0.2, 1, 0.35], RED = [1, 0.12, 0.08], BLUE = [0.25, 0.4, 1], AMBER = [1, 0.62, 0.15];

  // ---------------- airports
  const pave = new Geo(), paveUV = [];
  const rwyMeshes = [], papi = [], beacons = [];
  for (const a of world.airports) {
    const rn = -a.de, re = a.dn; // unit vector to the right of the runway course
    const at = (v, u, y) => R(a.n + a.dn * v + rn * u, a.e + a.de * v + re * u, a.elev + (y || 0));
    const yaw = Math.atan2(a.de, -a.dn);
    // runway (own mesh, procedural markings from uv = lateral, along)
    const g = new Geo(), hw = a.width / 2, hl = a.len / 2 + 60;
    const q = [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]];
    const uv = []; const base = g.n;
    for (const c of q) { g.v(at(c[1], c[0], 0.3), [0, 1, 0], [0.1, 0.1, 0.1, 0.1]); uv.push(c[0], c[1]); }
    g.idx.push(0, 1, 2, 0, 2, 3);
    const d = g.data(); d.uv = uv;
    rwyMeshes.push({ mesh: glx.mesh(d), ap: a, rwy: [a.len, a.width, parseInt(FS.runwayName(a.hdg), 10), parseInt(FS.runwayName(a.hdg + 180), 10)] });
    // taxiways and apron (shared mesh), uv.x = lateral metres from centreline, uv.y = kind
    const strip = (v0, u0, v1, u1, halfW, kind) => {
      const dv = v1 - v0, du = u1 - u0, l = Math.hypot(dv, du), pv = -du / l * halfW, pu = dv / l * halfW, b = pave.n;
      const pts = [[v0 - pv, u0 - pu, -halfW], [v0 + pv, u0 + pu, halfW], [v1 + pv, u1 + pu, halfW], [v1 - pv, u1 - pu, -halfW]];
      for (const p of pts) { pave.v(at(p[0], p[1], 0.22), [0, 1, 0], [0.12, 0.12, 0.12, 0.1]); paveUV.push(p[2], kind); }
      pave.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    const side = a.id === 'KVA' ? -1 : 1, tu = side * 190;
    strip(-a.len / 2, tu, a.len / 2, tu, 11.5, 0);
    for (const v of [-a.len / 2 + 35, -a.len / 4, 0, a.len / 4, a.len / 2 - 35]) strip(v, side * hw, v, tu - side * 11.5, 11.5, 0);
    for (const v of [-300, 0, 300]) strip(v, tu + side * 11.5, v, side * 232, 11.5, 0);
    strip(-460, side * 330, 460, side * 330, 100, 1);
    // terminal, piers, tower, hangars
    const wall = [0.72, 0.74, 0.76], glass = [0.42, 0.52, 0.6];
    addBox(at(0, side * 470), yaw, 62, 21, 520, glass);
    for (const v of [-190, 0, 190]) addBox(at(v, side * 425), yaw, 46, 12, 26, wall);
    addBox(at(-420, side * 485), yaw, 12, 58, 12, wall); addBox(at(-420, side * 485, 58), yaw, 19, 8, 19, [0.2, 0.26, 0.3]);
    for (const v of [600, 720, 840]) addBox(at(v, side * 400), yaw, 80, 24, 95, [0.6, 0.62, 0.6]);
    beacons.push({ p: at(-420, side * 485, 70) });
    // lights
    for (let v = -a.len / 2; v <= a.len / 2 + 1; v += 60) { addLight(at(v, hw + 1.5, 0.8), WHITE, 1, 3.2, 1); addLight(at(v, -hw - 1.5, 0.8), WHITE, 1, 3.2, 1); }
    for (let v = -a.len / 2 + 30; v < a.len / 2; v += 30) addLight(at(v, 0, 0.5), WHITE, 0.55, 2.2, 1);
    for (const end of [-1, 1]) {
      const v0 = end * a.len / 2;
      for (let u = -hw + 2; u <= hw - 2; u += (a.width - 4) / 13) addLight(at(v0 + end * 3, u, 0.8), GREEN, 1.2, 3.4, 1);
      for (let s = 30; s <= 720; s += 30) for (const u of [-1.6, 0, 1.6]) addLight(at(v0 + end * s, u, 1.2 + s * 0.004), WHITE, 1.25, 3.6, 1);
      for (let u = -13.5; u <= 13.5; u += 3) addLight(at(v0 + end * 300, u, 2.4), WHITE, 1.25, 3.6, 1);
      for (let s = 30; s <= 270; s += 30) for (const u of [-9, -7.5, 7.5, 9]) addLight(at(v0 + end * s, u, 1.2), RED, 0.9, 3.0, 1);
      // PAPI: four units left of the runway (as seen on approach), 400 m past the threshold
      for (let k = 0; k < 4; k++) papi.push({ p: at(v0 - end * 400, end * (hw + 15 + k * 9), 1), k, elev: a.elev, aim: at(v0 - end * 300, 0, 0) });
    }
    for (let v = -a.len / 2; v <= a.len / 2; v += 60) for (const s of [-13, 13]) addLight(at(v, tu + s, 0.5), BLUE, 0.5, 2.0, 1);
    for (const v of [-400, -200, 0, 200, 400]) { addLight(at(v, side * 440, 24), WARM, 2.2, 7, 1); addLight(at(v, side * 235, 20), WARM, 1.6, 6, 1); }
  }
  { const d = pave.data(); d.uv = paveUV; out.pave = glx.mesh(d); }
  out.runways = rwyMeshes; out.papi = papi; out.beacons = beacons;

  // ---------------- cities
  const palette = [[0.74, 0.70, 0.62], [0.62, 0.63, 0.66], [0.66, 0.50, 0.42], [0.80, 0.78, 0.74], [0.50, 0.55, 0.60], [0.70, 0.66, 0.58]];
  for (const c of world.cities) {
    const ga = rand() * Math.PI, cs = Math.cos(ga), sn = Math.sin(ga), grid = 78; c.ga = ga;
    const used = new Set();
    for (let k = 0, tries = 0; k < c.count && tries < c.count * 6; tries++) {
      const rr = c.r * Math.pow(rand(), 0.75), th = rand() * Math.PI * 2;
      let gx = Math.round(rr * Math.cos(th) / grid), gy = Math.round(rr * Math.sin(th) / grid);
      const key = gx + ',' + gy; if (used.has(key)) continue;
      const n = c.n + (gx * cs - gy * sn) * grid, e = c.e + (gx * sn + gy * cs) * grid;
      const h = world.heightAt(n, e); if (h < 2) continue;
      if (Math.abs(world.heightAt(n + 40, e) - h) > 6 || Math.abs(world.heightAt(n, e + 40) - h) > 6) continue;
      let nearAp = false; for (const a of world.airports) if (FS.segDist(n, e, a.a, a.b) < 900) nearAp = true; if (nearAp) continue;
      used.add(key); k++;
      const dn = Math.hypot(n - c.n, e - c.e) / c.r, core = Math.pow(Math.max(0, 1 - dn * 1.9), 2);
      const tall = 7 + rand() * 16 + core * c.tall * (60 + rand() * 190);
      const fx = tall > 60 ? 28 + rand() * 22 : 22 + rand() * 40, fz = tall > 60 ? 28 + rand() * 22 : 22 + rand() * 40;
      const col = tall > 70 ? [0.40 + rand() * 0.15, 0.50 + rand() * 0.12, 0.60 + rand() * 0.1] : palette[Math.floor(rand() * palette.length)];
      addBox(R(n, e, h - 1.5), -ga, fx, tall + 1.5, fz, col);
      if (rand() < 0.9) addLight(R(n + (rand() - 0.5) * 60, e + (rand() - 0.5) * 60, h + 9), WARM, 0.8 + rand() * 0.5, 4.5, 0);
      if (rand() < 0.35) addLight(R(n + (rand() - 0.5) * 70, e + (rand() - 0.5) * 70, h + 8), rand() < 0.8 ? WARM : WHITE, 0.7, 4, 0);
      if (tall > 110) addLight(R(n, e, h + tall + 3), RED, 1.3, 5, 0);
    }
  }
  // scattered rural lights so the countryside is not black at night
  for (let k = 0; k < 1500; k++) {
    const n = (rand() * 2 - 1) * W * 0.8, e = (rand() * 2 - 1) * W * 0.8, h = world.heightAt(n, e);
    if (h > 3 && h < 500) addLight(R(n, e, h + 6), WARM, 0.6, 4, 0);
  }
  {
    const d = cube.data(); out.buildings = glx.mesh(d);
    glx.interleaved(out.buildings, new Float32Array(inst), [[4, 4], [5, 4], [6, 4]], 1);
    out.buildingCount = inst.length / 12;
    const lm = glx.emptyMesh();
    glx.interleaved(lm, new Float32Array(lights), [[0, 3], [2, 4], [3, 2]], 0);
    out.lights = lm; out.lightCount = lights.length / 9;
    const dm = glx.emptyMesh(); out.dynData = new Float32Array(160 * 9);
    out.dynBuf = glx.interleaved(dm, out.dynData, [[0, 3], [2, 4], [3, 2]], 0, true); out.dynLights = dm;
  }

  // ---------------- clouds: puffs in a wrapping tile
  {
    const T = 52000, NCELL = 26, cs = T / NCELL, puffs = [];
    for (let i = 0; i < NCELL; i++) for (let j = 0; j < NCELL; j++) {
      const f = FS.fbm(i / 5.2 + 3, j / 5.2 + 8, 3, 91);
      const thr = FS.clamp((0.72 - f) / 0.44, 0, 1) * 0.72 + rand() * 0.25;
      const cx = (i + 0.5) * cs, cz = (j + 0.5) * cs, np = 3 + Math.floor(rand() * 3);
      for (let k = 0; k < np; k++) {
        const hi = k >= 3 || (k === 2 && rand() < 0.5);
        puffs.push({ x: cx + (rand() - 0.5) * 1900, z: cz + (rand() - 0.5) * 1900, y: hi ? 0.35 + rand() * 0.65 : rand() * 0.38, size: hi ? 500 + rand() * 500 : 750 + rand() * 750, seed: rand(), thr: Math.min(0.99, thr + (hi ? 0.08 : 0) + rand() * 0.06) });
      }
    }
    const quad = glx.mesh({ pos: [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], idx: [0, 1, 2, 0, 2, 3] });
    out.puffs = puffs; out.puffData = new Float32Array(puffs.length * 8);
    out.puffBuf = glx.interleaved(quad, out.puffData, [[4, 4], [5, 4]], 1, true);
    out.cloudQuad = quad; out.cloudTile = T;
    out.deck = glx.mesh({ pos: [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], idx: [0, 1, 2, 0, 2, 3] });
  }
  // ---------------- rain: line segments with a random seed per line
  {
    const N = 1600, pos = new Float32Array(N * 6), uv = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) { const a = rand(), b = rand(), c = rand(); pos.set([a, b, c, a, b, c], i * 6); uv.set([0, 0, 1, 0], i * 4); }
    out.rain = glx.mesh({ pos, uv }); out.rainCount = N * 2;
  }
  out.sky = glx.mesh({ pos: [-1, -1, 0, 3, -1, 0, -1, 3, 0] });
  return out;
}
