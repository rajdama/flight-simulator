'use strict';
/* Small WebGL2 toolkit: matrices, shader programs, mesh builder. No dependencies. */
const M4 = {
  ident() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },
  mul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  },
  trans(x, y, z) { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]; },
  scale(x, y, z) { return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]; },
  rotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; },
  rotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; },
  rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },
  // quaternion [x,y,z,w] -> rotation matrix
  fromQuat(q) {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1];
  },
  basis(X, Y, Z, O) { return [X[0], X[1], X[2], 0, Y[0], Y[1], Y[2], 0, Z[0], Z[1], Z[2], 0, O[0], O[1], O[2], 1]; },
  persp(fovy, asp, n, f) { const t = 1 / Math.tan(fovy / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; },
  ortho(l, r, b, t, n, f) { return [2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]; },
  // rotation-only view matrix from camera basis (right, up, back)
  viewRot(R, U, B) { return [R[0], U[0], B[0], 0, R[1], U[1], B[1], 0, R[2], U[2], B[2], 0, 0, 0, 0, 1]; },
  point(m, p) { return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]; },
  dir(m, p) { return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2], m[1] * p[0] + m[5] * p[1] + m[9] * p[2], m[2] * p[0] + m[6] * p[1] + m[10] * p[2]]; },
  invert(m) {
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7], a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12,
      b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06; det = 1 / det;
    return [(a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det, (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det, (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det, (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det, (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det];
  }
};
const V3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]), norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
};
// quaternion helpers for cameras: [x,y,z,w]
const Q4 = {
  mul(a, b) { return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]; },
  axis(ax, ang) { const s = Math.sin(ang / 2); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(ang / 2)]; },
  rot(q, v) { const x = q[0], y = q[1], z = q[2], w = q[3]; const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]); return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]; },
  slerp(a, b, t) {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; let bb = b; if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]]; }
    let s0, s1; if (d > 0.9995) { s0 = 1 - t; s1 = t; } else { const th = Math.acos(d), sn = Math.sin(th); s0 = Math.sin((1 - t) * th) / sn; s1 = Math.sin(t * th) / sn; }
    const q = [a[0] * s0 + bb[0] * s1, a[1] * s0 + bb[1] * s1, a[2] * s0 + bb[2] * s1, a[3] * s0 + bb[3] * s1]; const l = Math.hypot(q[0], q[1], q[2], q[3]); return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  },
  // orientation whose -Z looks along fwd with the given up hint
  look(fwd, up) {
    const B = V3.norm(V3.mul(fwd, -1)), R = V3.norm(V3.cross(up, B)), U = V3.cross(B, R);
    const m00 = R[0], m11 = U[1], m22 = B[2], tr = m00 + m11 + m22; let q;
    if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(U[2] - B[1]) / s, (B[0] - R[2]) / s, (R[1] - U[0]) / s, 0.25 * s]; }
    else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [0.25 * s, (U[0] + R[1]) / s, (B[0] + R[2]) / s, (U[2] - B[1]) / s]; }
    else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(U[0] + R[1]) / s, 0.25 * s, (B[1] + U[2]) / s, (B[0] - R[2]) / s]; }
    else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(B[0] + R[2]) / s, (B[1] + U[2]) / s, 0.25 * s, (R[1] - U[0]) / s]; }
    return q;
  }
};

function GLX(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  function shader(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); console.error(log, '\n', src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n')); throw new Error('Shader compile failed: ' + log); }
    return s;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, '#version 300 es\n' + vs)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, '#version 300 es\n' + fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program link failed: ' + gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); const name = info.name.replace(/\[0\]$/, ''); u[name] = { loc: gl.getUniformLocation(p, info.name), type: info.type }; }
    return {
      p, u,
      use() { gl.useProgram(p); },
      set(name, v) {
        const e = u[name]; if (!e) return;
        switch (e.type) {
          case gl.FLOAT: gl.uniform1f(e.loc, v); break;
          case gl.FLOAT_VEC2: gl.uniform2fv(e.loc, v); break;
          case gl.FLOAT_VEC3: gl.uniform3fv(e.loc, v); break;
          case gl.FLOAT_VEC4: gl.uniform4fv(e.loc, v); break;
          case gl.FLOAT_MAT4: gl.uniformMatrix4fv(e.loc, false, v); break;
          default: gl.uniform1i(e.loc, v);
        }
      },
      setAll(o) { for (const k in o) this.set(k, o[k]); }
    };
  }
  // attribute slots: 0 position, 1 normal, 2 colour, 3 uv/extra, 4.. instance data
  function mesh(g) {
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const buf = (data, loc, size, type, norm) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, type || gl.FLOAT, !!norm, 0, 0); return b; };
    buf(g.pos instanceof Float32Array ? g.pos : new Float32Array(g.pos), 0, 3);
    if (g.nor) { if (g.nor instanceof Int8Array) buf(g.nor, 1, 4, gl.BYTE, true); else buf(new Float32Array(g.nor), 1, 3); }
    if (g.col) buf(g.col instanceof Uint8Array ? g.col : new Uint8Array(g.col), 2, 4, gl.UNSIGNED_BYTE, true);
    if (g.uv) buf(new Float32Array(g.uv), 3, g.uvSize || 2);
    let count = g.pos.length / 3, indexed = false, itype = gl.UNSIGNED_SHORT;
    if (g.idx) { const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); const big = count > 65535; const arr = g.idx instanceof Uint32Array ? g.idx : (big ? new Uint32Array(g.idx) : new Uint16Array(g.idx)); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, arr, gl.STATIC_DRAW); indexed = true; itype = arr instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT; count = arr.length; }
    gl.bindVertexArray(null);
    return {
      vao, count, indexed, itype,
      draw(mode, first, n, inst) {
        gl.bindVertexArray(vao); const m = mode === undefined ? gl.TRIANGLES : mode;
        if (indexed) { const bytes = itype === gl.UNSIGNED_INT ? 4 : 2; if (inst) gl.drawElementsInstanced(m, n || count, itype, (first || 0) * bytes, inst); else gl.drawElements(m, n || count, itype, (first || 0) * bytes); }
        else if (inst) gl.drawArraysInstanced(m, first || 0, n || count, inst); else gl.drawArrays(m, first || 0, n || count);
      }
    };
  }
  // add a per-instance (or dynamic per-vertex) float buffer to an existing mesh
  function attrib(m, loc, size, data, divisor, dynamic) {
    gl.bindVertexArray(m.vao); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); if (divisor) gl.vertexAttribDivisor(loc, divisor);
    gl.bindVertexArray(null); return b;
  }
  // interleaved float buffer with several attributes: layout = [[loc,size],...]
  function interleaved(m, data, layout, divisor, dynamic) {
    gl.bindVertexArray(m.vao); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    let stride = 0; for (const l of layout) stride += l[1]; let off = 0;
    for (const l of layout) { gl.enableVertexAttribArray(l[0]); gl.vertexAttribPointer(l[0], l[1], gl.FLOAT, false, stride * 4, off * 4); if (divisor) gl.vertexAttribDivisor(l[0], divisor); off += l[1]; }
    gl.bindVertexArray(null); return b;
  }
  function emptyMesh() { const vao = gl.createVertexArray(); return { vao, count: 0 }; }
  return { gl, program, mesh, attrib, interleaved, emptyMesh };
}

/* Mesh builder: flat-shaded quads/tris and lofted surfaces. */
class Geo {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.idx = []; }
  get n() { return this.pos.length / 3; }
  v(p, n, c) { this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.col.push(c[0] * 255, c[1] * 255, c[2] * 255, (c[3] === undefined ? 0.25 : c[3]) * 255); return this.n - 1; }
  // flat triangle; `inside` is any point on the inner side so the face points away from it
  tri(a, b, c, col, inside) {
    let n = V3.cross(V3.sub(b, a), V3.sub(c, a)); const l = V3.len(n); if (l < 1e-9) return; n = V3.mul(n, 1 / l);
    if (inside && V3.dot(n, V3.sub(a, inside)) < 0) { n = V3.mul(n, -1); const t = b; b = c; c = t; }
    const i = this.n; this.v(a, n, col); this.v(b, n, col); this.v(c, n, col); this.idx.push(i, i + 1, i + 2);
  }
  quad(a, b, c, d, col, inside) { this.tri(a, b, c, col, inside); this.tri(a, c, d, col, inside); }
  // rings: array of rings (each an array of points, same length, closed loop). colFn(ringIndex, pointIndex, point) -> colour
  loft(rings, o) {
    o = o || {}; const colFn = typeof o.col === 'function' ? o.col : () => o.col;
    const cen = rings.map(r => { let c = [0, 0, 0]; for (const p of r) c = V3.add(c, p); return V3.mul(c, 1 / r.length); });
    const m = rings[0].length;
    if (o.smooth) {
      const base = this.n;
      for (let i = 0; i < rings.length; i++) for (let j = 0; j < m; j++) this.v(rings[i][j], [0, 0, 0], colFn(i, j, rings[i][j]));
      const acc = new Float64Array(rings.length * m * 3);
      for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < m; j++) {
        const j2 = (j + 1) % m, A = i * m + j, B = i * m + j2, C = (i + 1) * m + j2, D = (i + 1) * m + j;
        const inside = V3.lerp(cen[i], cen[i + 1], 0.5);
        for (const t of [[A, B, C], [A, C, D]]) {
          const pa = this.pt(base + t[0]), pb = this.pt(base + t[1]), pc = this.pt(base + t[2]);
          let n = V3.cross(V3.sub(pb, pa), V3.sub(pc, pa)); if (V3.len(n) < 1e-10) continue;
          let order = t; if (V3.dot(n, V3.sub(pa, inside)) < 0) { n = V3.mul(n, -1); order = [t[0], t[2], t[1]]; }
          this.idx.push(base + order[0], base + order[1], base + order[2]);
          for (const k of t) { acc[k * 3] += n[0]; acc[k * 3 + 1] += n[1]; acc[k * 3 + 2] += n[2]; }
        }
      }
      for (let k = 0; k < rings.length * m; k++) { const n = V3.norm([acc[k * 3], acc[k * 3 + 1], acc[k * 3 + 2]]); this.nor[(base + k) * 3] = n[0]; this.nor[(base + k) * 3 + 1] = n[1]; this.nor[(base + k) * 3 + 2] = n[2]; }
    } else {
      for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < m; j++) {
        const j2 = (j + 1) % m; const inside = V3.lerp(cen[i], cen[i + 1], 0.5);
        this.quad(rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j], colFn(i, j, rings[i][j]), inside);
      }
    }
    const cap = (i, other) => { const r = rings[i], c = cen[i], inside = V3.add(c, V3.sub(cen[other], c)); for (let j = 0; j < m; j++) this.tri(c, r[j], r[(j + 1) % m], colFn(i, j, r[j]), V3.lerp(c, cen[other], 0.5)); };
    if (o.capStart) cap(0, 1); if (o.capEnd) cap(rings.length - 1, rings.length - 2);
    return this;
  }
  pt(i) { return [this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]]; }
  box(mn, mx, col, skipBottom) {
    const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    const P = (x, y, z) => [x ? mx[0] : mn[0], y ? mx[1] : mn[1], z ? mx[2] : mn[2]];
    this.quad(P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0), col, c); this.quad(P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1), col, c);
    this.quad(P(0, 0, 0), P(0, 0, 1), P(0, 1, 1), P(0, 1, 0), col, c); this.quad(P(1, 0, 0), P(1, 0, 1), P(1, 1, 1), P(1, 1, 0), col, c);
    this.quad(P(0, 1, 0), P(1, 1, 0), P(1, 1, 1), P(0, 1, 1), col, c); if (!skipBottom) this.quad(P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1), col, c);
    return this;
  }
  // append another Geo, transformed by matrix m
  add(g, m) {
    const base = this.n;
    for (let i = 0; i < g.n; i++) {
      const p = m ? M4.point(m, g.pt(i)) : g.pt(i), n0 = [g.nor[i * 3], g.nor[i * 3 + 1], g.nor[i * 3 + 2]], n = m ? V3.norm(M4.dir(m, n0)) : n0;
      this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.col.push(g.col[i * 4], g.col[i * 4 + 1], g.col[i * 4 + 2], g.col[i * 4 + 3]);
    }
    for (const k of g.idx) this.idx.push(base + k);
    return this;
  }
  data() { return { pos: this.pos, nor: this.nor, col: this.col, idx: this.idx }; }
}
