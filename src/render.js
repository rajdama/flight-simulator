'use strict';
/* Scene renderer: sky and ocean, terrain, airports, cities, aircraft, clouds, lights, weather. */
function createScene(canvas, world) {
  const glx = GLX(canvas); if (!glx) return null;
  const gl = glx.gl, D2R = FS.D2R, sstep = FS.sstep, clamp = FS.clamp;
  const prog = {
    sky: glx.program(GLSL.skyVS, GLSL.skyFS), terr: glx.program(GLSL.terrVS, GLSL.terrFS),
    lit: glx.program(GLSL.litVS, GLSL.litFS), litI: glx.program('#define INSTANCED\n' + GLSL.litVS, GLSL.litFS),
    depth: glx.program(GLSL.depthVS, GLSL.depthFS), deck: glx.program(GLSL.deckVS, GLSL.deckFS),
    cloud: glx.program(GLSL.cloudVS, GLSL.cloudFS), light: glx.program(GLSL.lightVS, GLSL.lightFS), rain: glx.program(GLSL.rainVS, GLSL.rainFS)
  };
  const Wd = buildWorldGfx(glx, world), AC = buildAircraft(glx);

  // shadow map
  const SH = 2048, shTex = gl.createTexture(), shFbo = gl.createFramebuffer();
  gl.bindTexture(gl.TEXTURE_2D, shTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SH, SH, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  gl.bindFramebuffer(gl.FRAMEBUFFER, shFbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shTex, 0);
  gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const cityU = new Float32Array(20); world.cities.forEach((c, i) => cityU.set([c.e, -c.n, c.r, c.ga || 0], i * 4));
  const st = { wind: [0, 0], rainOff: [0, 0, 0], fan: [0, 0], flex: 0.3, inCloud: 0, frame: 0, t: 0, scale: 1, drawn: 0 };
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

  function skyParams(hour, wx, camY) {
    const ang = (hour - 6) / 12 * Math.PI, sinEl = Math.sin(ang) * 0.9, cosEl = Math.sqrt(1 - sinEl * sinEl), az = (90 + (hour - 6) / 12 * 180) * D2R;
    const sunPos = [Math.sin(az) * cosEl, sinEl, -Math.cos(az) * cosEl];
    const moonPos = V3.norm([-sunPos[0] * 0.8 + 0.2, Math.max(0.32, -sunPos[1] * 0.9), -sunPos[2] * 0.8]);
    const dayK = sstep(-0.18, 0.28, sinEl), tw = sstep(-0.30, -0.02, sinEl) * (1 - sstep(0.02, 0.38, sinEl));
    let zen = mix3([0.002, 0.004, 0.012], [0.095, 0.25, 0.66], dayK); zen = mix3(zen, [0.09, 0.11, 0.30], tw * 0.5);
    let hor = mix3([0.008, 0.013, 0.028], [0.48, 0.65, 0.86], dayK); hor = mix3(hor, [0.95, 0.50, 0.26], tw * 0.6);
    const glow = mix3([1, 0.36, 0.11], [1, 0.86, 0.62], sstep(0, 0.4, sinEl)); let glowK = sstep(-0.14, 0.03, sinEl) * (1 + tw * 1.3);
    const useSun = sinEl > -0.035;
    let lightCol = useSun ? mul3(mix3([1, 0.45, 0.2], [1, 0.95, 0.85], sstep(0.02, 0.38, sinEl)), 2.7 * sstep(-0.035, 0.14, sinEl)) : mul3([0.20, 0.26, 0.42], 0.27 * sstep(0, -0.16, sinEl));
    const under = 1 - sstep(wx.top - 150, wx.top + 50, camY), o = sstep(0.55, 0.9, wx.cover) * under;
    const lz = 0.3 * hor[0] + 0.59 * hor[1] + 0.11 * hor[2];
    zen = mix3(zen, [lz * 0.60, lz * 0.62, lz * 0.66], o * 0.92); hor = mix3(hor, [lz * 0.88, lz * 0.9, lz * 0.95], o * 0.85);
    const dark = 1 - 0.62 * wx.storm * under; zen = mul3(zen, dark); hor = mul3(hor, dark);
    lightCol = mul3(lightCol, (1 - 0.86 * o) * dark); glowK *= (1 - o);
    const skyAmb = [zen[0] * 0.75 + hor[0] * 0.5 + 0.006, zen[1] * 0.75 + hor[1] * 0.5 + 0.008, zen[2] * 0.75 + hor[2] * 0.5 + 0.014];
    const gndAmb = [skyAmb[0] * 0.3 + lightCol[0] * 0.05, skyAmb[1] * 0.3 + lightCol[1] * 0.05, skyAmb[2] * 0.3 + lightCol[2] * 0.045];
    const night = 1 - sstep(-0.14, 0.10, sinEl);
    const cloudCol = mul3([skyAmb[0] + lightCol[0] * 0.42, skyAmb[1] + lightCol[1] * 0.42, skyAmb[2] + lightCol[2] * 0.42], 1 - 0.55 * wx.storm);
    return { sunPos, moonPos, lightDir: useSun ? sunPos : moonPos, lightCol, zen, hor, glow: mul3(glow, glowK), skyAmb, gndAmb, night, cloudCol, sunVis: (1 - o) * (useSun ? 1 : 0), stars: night * (1 - o), sinEl, exposure: 0.9 + 1.4 * night };
  }

  function planes(m) {
    const row = i => [m[i], m[4 + i], m[8 + i], m[12 + i]], r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3), out = [];
    for (const p of [[r3, r0, 1], [r3, r0, -1], [r3, r1, 1], [r3, r1, -1], [r3, r2, 1], [r3, r2, -1]]) { const a = p[0], b = p[1], s = p[2], v = [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2], a[3] + s * b[3]], l = Math.hypot(v[0], v[1], v[2]); out.push([v[0] / l, v[1] / l, v[2] / l, v[3] / l]); }
    return out;
  }

  function resize(scale) {
    st.scale = scale || st.scale;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * st.scale;
    const w = Math.max(2, Math.round(canvas.clientWidth * dpr)), h = Math.max(2, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  let dynN = 0;
  function pushLight(p, c, i, size, cls) { if (dynN >= 160) return; Wd.dynData.set([p[0], p[1], p[2], c[0], c[1], c[2], i, size, cls], dynN * 9); dynN++; }

  function render(f) {
    resize();
    const w = canvas.width, h = canvas.height, dt = f.dt, wx = f.wx, cam = f.cam, sim = f.sim, s = sim.s, d = sim.d;
    st.t += dt; st.frame++;
    const sp = skyParams(f.hour, wx, cam.pos[1]);
    // ---- camera matrices (rotation only; everything is drawn relative to the camera)
    const Rv = Q4.rot(cam.q, [1, 0, 0]), Uv = Q4.rot(cam.q, [0, 1, 0]), Bv = Q4.rot(cam.q, [0, 0, 1]), Fv = V3.mul(Bv, -1);
    const proj = M4.persp(cam.fov, w / h, cam.near || 2, 240000); proj[9] = -(cam.shift || 0); // lens shift keeps the horizon clear of the instrument panel
    const VP = M4.mul(proj, M4.viewRot(Rv, Uv, Bv)), invVP = M4.invert(VP);
    const acRel = V3.sub(f.ac.pos, cam.pos), acModel = M4.mul(M4.trans(acRel[0], acRel[1], acRel[2]), M4.fromQuat(f.ac.q));
    const camT = M4.trans(-cam.pos[0], -cam.pos[1], -cam.pos[2]);

    // ---- animation state
    st.wind[0] += -wx.windSpd * Math.sin(wx.windDir * D2R) * dt; st.wind[1] += wx.windSpd * Math.cos(wx.windDir * D2R) * dt;
    st.fan[0] += s.n1[0] * 0.55 * dt; st.fan[1] += s.n1[1] * 0.55 * dt;
    st.flex += ((d.onGround ? 0.1 : 0.2) + 1.35 * clamp(d.nz, -1, 2.6) - st.flex) * Math.min(1, dt * 5);
    const ps = { flapDeg: s.flapDeg, ail: s.ail, elev: s.elev, rud: s.rud, trim: s.trim, spoiler: s.spoiler, gear: s.gear, comp: s.comp, wheelSpin: s.wheelSpin, fan: st.fan };

    // ---- clouds: layer state and whether the camera is inside one
    const deckOn = wx.cover >= 0.8, T = Wd.cloudTile, puffK = 0.8 + 0.5 * wx.cover;
    let inC = deckOn ? sstep(wx.base - 15, wx.base + 60, cam.pos[1]) * sstep(wx.top + 15, wx.top - 60, cam.pos[1]) : 0;
    const puffs = Wd.puffs, sortNow = st.frame % 6 === 1 || !st.sorted;
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i];
      let dx = (p.x + st.wind[0] - cam.pos[0] + T * 0.5) % T; if (dx < 0) dx += T; dx -= T * 0.5;
      let dz = (p.z + st.wind[1] - cam.pos[2] + T * 0.5) % T; if (dz < 0) dz += T; dz -= T * 0.5;
      const dy = wx.base + (wx.top - wx.base) * p.y - cam.pos[1];
      p.d2 = dx * dx + dy * dy + dz * dz;
      if (!deckOn && wx.cover > p.thr) { const r = p.size * puffK, q = (dx * dx + dz * dz) / (r * r) + dy * dy / (r * r * 0.38); if (q < 0.45) inC = Math.max(inC, sstep(0.45, 0.15, q) * sstep(p.thr, p.thr + 0.07, wx.cover)); }
    }
    if (sortNow) {
      puffs.sort((a, b) => b.d2 - a.d2); const pd = Wd.puffData;
      for (let i = 0; i < puffs.length; i++) { const p = puffs[i]; pd[i * 8] = p.x; pd[i * 8 + 1] = p.y; pd[i * 8 + 2] = p.z; pd[i * 8 + 3] = p.size; pd[i * 8 + 4] = p.seed; pd[i * 8 + 5] = p.thr; }
      gl.bindBuffer(gl.ARRAY_BUFFER, Wd.puffBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, pd); st.sorted = true;
    }
    st.inCloud += (inC - st.inCloud) * Math.min(1, dt * 4);

    const common = {
      uCam: cam.pos, uCamV: cam.pos, uSunDir: sp.lightDir, uSunCol: sp.lightCol, uSkyAmb: sp.skyAmb, uGndAmb: sp.gndAmb, uZenith: sp.zen, uHorizon: sp.hor,
      uSunGlow: sp.glow, uSunPos: sp.sunPos, uCloudCol: sp.cloudCol, uFog: [3 / wx.vis, wx.hz || 2400, st.inCloud / 120, sp.exposure],
      uNight: sp.night, uFlash: f.flash || 0, uTime: st.t, uVP: VP
    };

    // ---- shadow pass (aircraft only; lands on terrain, runway and the airframe itself)
    const shadowOn = sp.lightDir[1] > 0.06 && V3.len(acRel) < 4000 && f.shadows !== false;
    let shadowMat = M4.ident();
    if (shadowOn) {
      const Z = sp.lightDir, X = V3.norm(V3.cross(Math.abs(Z[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0], Z)), Y = V3.cross(Z, X);
      const far = clamp((f.ac.pos[1] - (d.gndAlt || 0)) / Math.max(Z[1], 0.12) + 90, 90, 3200);
      shadowMat = M4.mul(M4.ortho(-46, 46, -46, 46, -60, far), M4.mul(M4.viewRot(X, Y, Z), M4.trans(-acRel[0], -acRel[1], -acRel[2])));
      gl.bindFramebuffer(gl.FRAMEBUFFER, shFbo); gl.viewport(0, 0, SH, SH); gl.depthMask(true); gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3);
      prog.depth.use(); prog.depth.setAll({ uVP: shadowMat, uModel: acModel, uFlex: st.flex });
      for (const p of AC.parts) { if (p.gear && s.gear < 0.03) continue; prog.depth.set('uPart', p.mat(ps)); p.mesh.draw(); }
      gl.disable(gl.POLYGON_OFFSET_FILL); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    gl.viewport(0, 0, w, h); gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, shTex);
    const lightU = { uShadow: 0, uShadowMat: shadowMat, uShadowOn: shadowOn ? 1 : 0, uWet: wx.rain > 0.2 ? Math.min(1, wx.rain) : 0 };

    // ---- sky and ocean
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    prog.sky.use(); prog.sky.setAll(common); prog.sky.setAll({ uInvVP: invVP, uMoonPos: sp.moonPos, uStars: sp.stars, uSunVis: sp.sunVis, uWaveAmp: 0.9 + wx.windSpd * 0.06 });
    Wd.sky.draw();

    // ---- terrain (alpha only in the shallows)
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    prog.terr.use(); prog.terr.setAll(common); prog.terr.setAll(lightU); gl.uniform4fv(prog.terr.u.uCity.loc, cityU);
    const pl = planes(VP); let drawn = 0;
    const fogRange = cam.pos[1] < (wx.hz || 2400) ? 7 / (3 / wx.vis) : 1e9;
    for (const c of Wd.chunks) {
      const cx = c.c[0] - cam.pos[0], cy = c.c[1] - cam.pos[1], cz = c.c[2] - cam.pos[2]; let vis = true;
      for (let k = 0; k < 6; k++) if (pl[k][0] * cx + pl[k][1] * cy + pl[k][2] * cz + pl[k][3] < -c.r) { vis = false; break; }
      if (!vis || Math.hypot(cx, cy, cz) - c.r > fogRange || st.inCloud > 0.97 && Math.hypot(cx, cy, cz) - c.r > 2500) continue;
      Wd.terrain.draw(gl.TRIANGLES, c.first, c.count); drawn++;
    }
    st.drawn = drawn;
    gl.disable(gl.BLEND);

    // ---- pavement
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -4);
    prog.lit.use(); prog.lit.setAll(common); prog.lit.setAll(lightU); prog.lit.setAll({ uModel: camT, uPart: M4.ident(), uFlex: 0 });
    prog.lit.set('uMode', 4); Wd.pave.draw();
    gl.polygonOffset(-4, -8); prog.lit.set('uMode', 3);
    for (const r of Wd.runways) { prog.lit.set('uRwy', r.rwy); r.mesh.draw(); }
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // ---- buildings
    prog.litI.use(); prog.litI.setAll(common); prog.litI.setAll(lightU); prog.litI.set('uMode', 2);
    Wd.buildings.draw(gl.TRIANGLES, 0, 0, Wd.buildingCount);

    // ---- aircraft
    if (f.showAircraft) {
      gl.disable(gl.CULL_FACE);
      prog.lit.use(); prog.lit.setAll({ uModel: acModel, uFlex: st.flex });
      for (const p of AC.parts) { if (p.gear && s.gear < 0.03) continue; prog.lit.set('uMode', p.mode); prog.lit.set('uPart', p.mat(ps)); p.mesh.draw(); }
      gl.enable(gl.CULL_FACE);
    }

    // ---- overcast deck
    if (deckOn && st.inCloud < 0.98) {
      const below = cam.pos[1] < wx.base + 30, above = cam.pos[1] > wx.top - 30;
      if (below || above) {
        gl.disable(gl.CULL_FACE); prog.deck.use(); prog.deck.setAll(common);
        prog.deck.setAll({ uY: (below ? wx.base : wx.top) - cam.pos[1], uExtent: 110000, uTopSide: above ? 1 : 0, uStorm: wx.storm, uDrift: st.wind });
        Wd.deck.draw(); gl.enable(gl.CULL_FACE);
      }
    }

    // ---- dynamic lights: aircraft, PAPI, tower beacons, lightning
    dynN = 0;
    const tt = st.t, lowVis = sstep(14000, 3000, wx.vis);
    if (f.showAircraft || true) for (const L of AC.lights) {
      let i = L.i;
      if (L.k === 'strobe') { const ph = tt % 1.25; i = (ph < 0.05 || (ph > 0.13 && ph < 0.18)) ? L.i : 0; }
      else if (L.k === 'beacon') i = (tt % 1.1) < 0.13 ? L.i : 0;
      else if (L.k === 'land' || L.k === 'taxi') i = s.gear > 0.6 ? L.i * (0.35 + 0.65 * Math.max(sp.night, lowVis)) : 0;
      else i = L.i * (0.5 + 0.5 * sp.night);
      if (i <= 0 || (!f.showAircraft && L.k !== 'land')) continue;
      const mp = [L.p[0], L.p[1] + (L.tip ? st.flex : 0), L.p[2]];
      pushLight(V3.add(f.ac.pos, Q4.rot(f.ac.q, mp)), L.c, i, L.s, 2);
    }
    for (const p of Wd.papi) {
      const dx = cam.pos[0] - p.aim[0], dz = cam.pos[2] - p.aim[2], dh = Math.hypot(dx, dz); if (dh > 30000) continue;
      const angle = Math.atan2(cam.pos[1] - p.elev, dh) / D2R;
      const nWhite = angle > 3.5 ? 4 : angle > 3.17 ? 3 : angle > 2.83 ? 2 : angle > 2.5 ? 1 : 0;
      pushLight(p.p, p.k >= 4 - nWhite ? [1, 1, 0.95] : [1, 0.06, 0.04], 2.4, 4.2, 1);
    }
    for (const b of Wd.beacons) { const ph = (tt % 3) / 3; if (ph < 0.08) pushLight(b.p, [1, 1, 1], 4, 8, 1); else if (ph > 0.5 && ph < 0.58) pushLight(b.p, [0.2, 1, 0.3], 4, 8, 1); }
    if (f.bolt) for (const p of f.bolt) pushLight(p, [0.8, 0.85, 1], 9, 60, 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, Wd.dynBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, Wd.dynData, 0, dynN * 9);

    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
    prog.light.use(); prog.light.setAll(common);
    prog.light.setAll({ uPx: h / (2 * Math.tan(cam.fov / 2)), uGain: [sp.night, Math.max(sp.night, 0.16 + 0.84 * lowVis, wx.storm * 0.8), 1] });
    gl.bindVertexArray(Wd.lights.vao); gl.drawArrays(gl.POINTS, 0, Wd.lightCount);

    // ---- cloud puffs
    // under a solid deck the puffs are hidden; above it they ride on top as bumps
    const puffsOn = wx.cover > 0.01 && (!deckOn || cam.pos[1] > wx.top - 30);
    if (puffsOn) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.CULL_FACE);
      prog.cloud.use(); prog.cloud.setAll(common);
      prog.cloud.setAll({ uRight: Rv, uUp: Uv, uFwd: Fv, uWind: st.wind, uLayer: deckOn ? [wx.top - 260, wx.top + 380, 0.55, T] : [wx.base, wx.top, wx.cover, T], uStorm: wx.storm * 0.5 });
      Wd.cloudQuad.draw(gl.TRIANGLES, 0, 6, puffs.length); gl.enable(gl.CULL_FACE);
    }
    // aircraft and other dynamic lights go on top of the clouds
    if (dynN) { gl.blendFunc(gl.ONE, gl.ONE); prog.light.use(); gl.bindVertexArray(Wd.dynLights.vao); gl.drawArrays(gl.POINTS, 0, dynN); }

    // ---- rain
    if (wx.rain > 0.05 && cam.pos[1] < wx.top) {
      const rv = [-wx.windSpd * Math.sin(wx.windDir * D2R) - f.ac.vel[0], -9 - f.ac.vel[1], wx.windSpd * Math.cos(wx.windDir * D2R) - f.ac.vel[2]];
      for (let k = 0; k < 3; k++) st.rainOff[k] = (st.rainOff[k] - rv[k] * dt) % 70;
      let sl = V3.len(rv) * 0.03, sv = V3.mul(rv, 0.03); if (sl > 7) sv = V3.mul(sv, 7 / sl);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
      prog.rain.use(); prog.rain.setAll({ uVP: VP, uOff: st.rainOff, uStreak: sv, uCol: [0.72, 0.78, 0.88, 0.32 * Math.min(1, wx.rain) * (0.4 + 0.6 * (1 - sp.night))] });
      Wd.rain.draw(gl.LINES, 0, Math.floor(Wd.rainCount * Math.min(1, wx.rain) / 2) * 2); gl.enable(gl.DEPTH_TEST);
    }
    gl.disable(gl.BLEND); gl.depthMask(true); gl.bindVertexArray(null);
    return sp;
  }
  return { render, resize, gl, st, skyParams };
}
