'use strict';
/* GLSL sources. All positions are camera-relative ("rel") to keep float precision. */
const GLSL = (function () {
  const COMMON = `
precision highp float; precision highp int; precision highp sampler2DShadow;
uniform vec3 uCam, uSunDir, uSunCol, uSkyAmb, uGndAmb, uZenith, uHorizon, uSunGlow, uSunPos, uCloudCol;
uniform vec4 uFog;      // x density at sea level, y scale height, z in-cloud density, w exposure
uniform float uNight, uFlash, uTime;
float hash1(vec2 p){ p = mod(p, 512.0); p = fract(p*vec2(0.1031,0.1030)); p += dot(p, p.yx+33.33); return fract((p.x+p.y)*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash1(i),hash1(i+vec2(1,0)),f.x), mix(hash1(i+vec2(0,1)),hash1(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+17.1; a*=0.5; } return s/0.9375; }
vec3 skyBase(vec3 d){
  float y = max(d.y, 0.0);
  float t = pow(1.0 - y, 4.5);
  vec3 c = mix(uZenith, uHorizon, t);
  float s = max(dot(d, uSunPos), 0.0);
  c += uSunGlow * (pow(s, 6.0)*0.22 + pow(s, 40.0)*0.45 + pow(s, 400.0)*1.2) * (0.35 + 0.65*t);
  return c;
}
float fogTau(vec3 rel){
  float dist = length(rel), k = 1.0/uFog.y;
  float x = clamp(rel.y*k, -40.0, 40.0);
  float f = abs(x) > 1e-3 ? (1.0-exp(-x))/x : 1.0 - 0.5*x;
  return uFog.x*dist*exp(-max(uCam.y,0.0)*k)*f + uFog.z*dist;
}
vec3 fogColor(vec3 dir){
  vec3 c = skyBase(normalize(vec3(dir.x, 0.03 + max(dir.y,0.0)*0.5, dir.z)));
  return mix(c, uCloudCol, clamp(uFog.z*300.0, 0.0, 1.0));
}
vec3 applyFog(vec3 col, vec3 rel){
  float t = 1.0 - exp(-fogTau(rel));
  return mix(col, fogColor(normalize(rel)), t);
}
vec3 finish(vec3 c){
  c *= uFog.w;
  c = (c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14);
  return pow(clamp(c,0.0,1.0), vec3(0.4545));
}
vec3 lin(vec3 c){ return c*c*(c*0.305306011+0.682171111)+c*0.012522878; }
`;
  const LIGHT = `
uniform sampler2DShadow uShadow; uniform mat4 uShadowMat; uniform float uShadowOn;
float shadowAt(vec3 rel, float ndl){
  if (uShadowOn < 0.5) return 1.0;
  vec4 sc = uShadowMat*vec4(rel,1.0); vec3 p = sc.xyz*0.5+0.5;
  if (p.x<0.002||p.x>0.998||p.y<0.002||p.y>0.998||p.z<0.0||p.z>1.0) return 1.0;
  float b = 0.0005 + 0.0015*(1.0-ndl);
  float s = 0.0; vec2 o = vec2(0.0007);
  s += texture(uShadow, vec3(p.xy+o*vec2(-1,-1), p.z-b)); s += texture(uShadow, vec3(p.xy+o*vec2(1,-1), p.z-b));
  s += texture(uShadow, vec3(p.xy+o*vec2(-1,1), p.z-b)); s += texture(uShadow, vec3(p.xy+o*vec2(1,1), p.z-b));
  return s*0.25;
}
vec3 shade(vec3 albedo, vec3 n, vec3 rel, float spec, float gloss, float shadow, vec3 emis){
  float ndl = max(dot(n,uSunDir),0.0);
  vec3 amb = mix(uGndAmb, uSkyAmb, n.y*0.5+0.5);
  vec3 c = albedo*(amb + uSunCol*ndl*shadow + uFlash*vec3(0.7,0.75,0.9)) + emis;
  vec3 v = normalize(-rel), h = normalize(v+uSunDir);
  c += uSunCol*spec*pow(max(dot(n,h),0.0), gloss)*shadow*step(0.001,ndl);
  // sky reflection on glossy surfaces
  float fr = pow(1.0-max(dot(n,v),0.0), 4.0);
  c += skyBase(reflect(-v,n)*vec3(1,1,1))*fr*spec*0.5;
  return c;
}
`;

  // ---------- sky + ocean, one fullscreen triangle
  const skyVS = `
layout(location=0) in vec3 aPos; uniform mat4 uInvVP; out vec3 vDir;
void main(){ vec4 p = uInvVP*vec4(aPos.xy,1.0,1.0); vDir = p.xyz/p.w; gl_Position = vec4(aPos.xy,0.9999,1.0); }`;
  const skyFS = COMMON + `
in vec3 vDir; out vec4 o; uniform vec3 uMoonPos; uniform float uStars, uSunVis, uWaveAmp;
float wave(vec2 p){ return vnoise(p) + 0.5*vnoise(p*2.1+7.3) + 0.25*vnoise(p*4.3-3.1); }
void main(){
  vec3 d = normalize(vDir); vec3 c;
  if (d.y >= 0.0) {
    c = skyBase(d);
    float s = dot(d,uSunPos);
    c += uSunGlow*smoothstep(0.99988,0.99996,s)*30.0*uSunVis;
    float m = dot(d,uMoonPos);
    c += vec3(0.75,0.8,0.9)*smoothstep(0.99975,0.9999,m)*0.9*uStars;
    c += vec3(0.5,0.6,0.8)*pow(max(m,0.0),600.0)*0.12*uStars;
    if (uStars > 0.01) {
      vec3 q = d*190.0; vec3 id = floor(q); vec3 f = fract(q)-0.5;
      float h = fract(sin(dot(id, vec3(12.9898,78.233,37.719)))*43758.5453);
      float tw = 0.7+0.3*sin(uTime*2.0+h*90.0);
      c += vec3(0.9,0.95,1.0)*step(0.9955,h)*smoothstep(0.32,0.0,length(f))*uStars*tw*smoothstep(0.0,0.12,d.y)*(0.4+0.6*fract(h*17.0));
    }
    c = applyFog(c, d*90000.0);
  } else {
    float t = uCam.y / max(-d.y, 1e-5);
    vec2 p = uCam.xz + d.xz*t;
    float att = 1.0/(1.0 + t/1800.0), att2 = 1.0/(1.0 + t/260.0);
    vec2 q = p*0.011 + uTime*vec2(0.035,0.02), q2 = p*0.13 + uTime*vec2(-0.21,0.16);
    float e = 0.4;
    float h0 = wave(q), hx = wave(q+vec2(e,0.0)), hz = wave(q+vec2(0.0,e));
    float g0 = vnoise(q2), gx = vnoise(q2+vec2(e,0.0)), gz = vnoise(q2+vec2(0.0,e));
    vec3 n = normalize(vec3(((h0-hx)*att*0.9 + (g0-gx)*att2*0.5)*uWaveAmp, 1.0, ((h0-hz)*att*0.9 + (g0-gz)*att2*0.5)*uWaveAmp));
    vec3 r = reflect(d, n); r.y = abs(r.y)+0.001; r = normalize(r);
    float fres = 0.02 + 0.98*pow(1.0 - max(dot(-d, n), 0.0), 5.0);
    vec3 light = uSkyAmb*1.1 + uSunCol*0.4*max(uSunDir.y,0.0);
    vec3 deep = vec3(0.012,0.085,0.14)*light;
    c = mix(deep, skyBase(r), fres*0.9);
    c += uSunCol*pow(max(dot(r,uSunDir),0.0), 260.0)*2.2*uSunVis;
    float foam = smoothstep(0.80,0.95, wave(q*2.7+3.0)*0.57) * att2 * (uWaveAmp-0.8)*0.5;
    c = mix(c, light*0.8, clamp(foam,0.0,0.6));
    c = applyFog(c, d*t);
  }
  o = vec4(finish(c),1.0);
}`;

  // ---------- terrain
  const terrVS = `
layout(location=0) in vec3 aPos; layout(location=1) in vec4 aNor; uniform mat4 uVP; uniform vec3 uCamV;
out vec3 vRel; out vec3 vN; out float vH;
void main(){ vRel = aPos - uCamV; vN = aNor.xyz; vH = aPos.y; gl_Position = uVP*vec4(vRel,1.0); }`;
  const terrFS = COMMON + LIGHT + `
in vec3 vRel; in vec3 vN; in float vH; out vec4 o; uniform float uWet; uniform vec4 uCity[5]; // x, z, radius, street-grid angle
void main(){
  vec3 n = normalize(vN); float dist = length(vRel); vec2 xz = vRel.xz + uCam.xz; float h = vH;
  float nL = fbm(xz/2600.0), nM = fbm(xz/310.0);
  float near = 1.0 - smoothstep(500.0, 4500.0, dist);
  float nS = vnoise(xz/21.0)*0.6 + vnoise(xz/6.0)*0.4;
  float slope = 1.0 - n.y;
  vec2 fp = mat2(0.94,-0.34,0.34,0.94)*xz/430.0; vec2 cell = floor(fp), fr = fract(fp);
  float r = hash1(cell);
  vec3 field = r<0.3 ? vec3(0.38,0.44,0.21) : r<0.55 ? vec3(0.60,0.55,0.31) : r<0.8 ? vec3(0.27,0.38,0.18) : vec3(0.47,0.39,0.27);
  float edge = smoothstep(0.0,0.03,min(min(fr.x,1.0-fr.x),min(fr.y,1.0-fr.y)));
  field *= mix(0.62,1.0,edge) * mix(1.0, 0.92+0.16*hash1(cell*3.0+vec2(floor(fr.y*14.0),7.0)), near);
  vec3 grass = mix(vec3(0.24,0.33,0.15), vec3(0.37,0.40,0.21), nM);
  vec3 forest = mix(vec3(0.085,0.18,0.085), vec3(0.14,0.26,0.12), nM);
  vec3 rock = mix(vec3(0.34,0.31,0.29), vec3(0.52,0.49,0.45), nM);
  float farm = smoothstep(0.40,0.5,nL)*(1.0-smoothstep(110.0,260.0,h))*(1.0-smoothstep(0.015,0.05,slope));
  vec3 c = mix(grass, field, farm);
  float fo = smoothstep(0.44,0.6, fbm(xz/900.0) + smoothstep(120.0,500.0,h)*0.22)*(1.0-farm);
  c = mix(c, forest, fo*(1.0-smoothstep(1050.0,1500.0,h+nM*300.0)));
  c = mix(c, mix(vec3(0.42,0.43,0.27), rock, 0.5), smoothstep(1150.0,1700.0,h+nM*300.0));
  c = mix(c, rock, smoothstep(0.17,0.36,slope+nM*0.08));
  c = mix(c, vec3(0.93,0.95,0.98), smoothstep(1700.0,2100.0,h+nM*500.0-slope*800.0));
  c = mix(vec3(0.80,0.74,0.57), c, smoothstep(1.5,9.0,h+nM*5.0));
  float nF = vnoise(xz/1.6)*0.5 + vnoise(xz/0.55)*0.5;
  // towns: paved blocks and a street grid under the buildings
  float lamp = 0.0;
  for (int i = 0; i < 5; i++) {
    vec2 dc = xz - uCity[i].xy; float dd = length(dc), rr = uCity[i].z;
    if (dd < rr*1.15 && h > 1.0) {
      float urban = smoothstep(rr*1.12, rr*0.72, dd + (nM-0.5)*rr*0.5);
      float cs = cos(uCity[i].w), sn = sin(uCity[i].w);
      vec2 g = vec2(-dc.y*cs + dc.x*sn, dc.y*sn + dc.x*cs)/78.0;
      vec2 gf = abs(fract(g)-0.5); float road = 1.0 - smoothstep(0.045, 0.075, min(gf.x, gf.y));
      float blockR = hash1(floor(g+0.5));
      vec3 block = blockR < 0.14 ? vec3(0.26,0.36,0.18) : mix(vec3(0.46,0.45,0.43), vec3(0.58,0.55,0.50), blockR);
      float lodR = 1.0 - smoothstep(2500.0, 9000.0, dist);
      c = mix(c, mix(block, vec3(0.17,0.175,0.185), road*lodR + (1.0-lodR)*0.12), urban);
      lamp = max(lamp, urban*(0.25 + 0.75*road*lodR));
    }
  }
  c *= mix(1.0, 0.80+0.40*nS, near) * mix(1.0, 0.86+0.28*nF, 1.0 - smoothstep(60.0, 420.0, dist));
  c *= 1.0 - 0.22*fo*(1.0-smoothstep(1050.0,1500.0,h))*step(0.55, vnoise(xz/34.0))*near;
  float alpha = 1.0;
  if (h < 0.3) { // shallows blend into the ocean drawn underneath
    c = mix(vec3(0.07,0.40,0.42), vec3(0.74,0.70,0.55), smoothstep(-2.2,0.3,h));
    alpha = smoothstep(-10.0,-0.6,h)*0.86 + 0.14*smoothstep(-0.6,0.3,h);
  }
  c = lin(c);
  float ndl = max(dot(n,uSunDir),0.0);
  vec3 col = shade(c, n, vRel, uWet*0.25*step(0.3,h), 60.0, shadowAt(vRel, ndl), vec3(1.0,0.62,0.28)*lamp*uNight*0.035);
  o = vec4(finish(applyFog(col, vRel)), alpha);
}`;

  // ---------- general lit meshes: aircraft parts, buildings (instanced), pavement
  const litVS = `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec4 aCol; layout(location=3) in vec2 aUV;
#ifdef INSTANCED
layout(location=4) in vec4 iPos; layout(location=5) in vec4 iSize; layout(location=6) in vec4 iCol;
#endif
uniform mat4 uVP, uModel, uPart; uniform float uFlex; uniform vec3 uCamV;
out vec3 vRel; out vec3 vN; out vec4 vCol; out vec3 vLocal; out vec2 vUV; out vec3 vBox;
void main(){
#ifdef INSTANCED
  vec3 lp = aPos*iSize.xyz; float cs = cos(iPos.w), sn = sin(iPos.w);
  vec3 wp = vec3(lp.x*cs + lp.z*sn, lp.y, -lp.x*sn + lp.z*cs) + iPos.xyz;
  vRel = wp - uCamV; vN = vec3(aNor.x*cs + aNor.z*sn, aNor.y, -aNor.x*sn + aNor.z*cs);
  vCol = iCol; vLocal = lp; vBox = aNor; vUV = vec2(iSize.w, 0.0);
#else
  vec4 p = uPart*vec4(aPos,1.0);
  p.y += uFlex*pow(max(abs(p.x)-3.0,0.0)/27.0, 2.0);
  vLocal = p.xyz;
  vec4 w = uModel*p; vRel = w.xyz;
  vN = mat3(uModel)*(mat3(uPart)*aNor); vCol = aCol; vUV = aUV; vBox = vec3(0.0);
#endif
  gl_Position = uVP*vec4(vRel,1.0);
}`;
  const litFS = COMMON + LIGHT + `
in vec3 vRel; in vec3 vN; in vec4 vCol; in vec3 vLocal; in vec2 vUV; in vec3 vBox; out vec4 o;
uniform int uMode;        // 0 vertex colour, 1 fuselage livery, 2 building, 3 runway, 4 taxiway/apron
uniform vec4 uRwy;        // length, width, number at A end, number at B end
uniform float uWet;
float seg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0); return 1.0-smoothstep(0.085,0.125,length(pa-ba*h)); }
float digit(vec2 p, int d){
  if (p.x<-0.2||p.x>1.2||p.y<-0.2||p.y>2.2) return 0.0;
  int m = d==0?63: d==1?6: d==2?91: d==3?79: d==4?102: d==5?109: d==6?125: d==7?7: d==8?127: 111;
  float r = 0.0;
  if ((m&1)!=0) r=max(r,seg(p,vec2(0.1,1.9),vec2(0.9,1.9)));
  if ((m&2)!=0) r=max(r,seg(p,vec2(0.9,1.9),vec2(0.9,1.0)));
  if ((m&4)!=0) r=max(r,seg(p,vec2(0.9,1.0),vec2(0.9,0.1)));
  if ((m&8)!=0) r=max(r,seg(p,vec2(0.1,0.1),vec2(0.9,0.1)));
  if ((m&16)!=0) r=max(r,seg(p,vec2(0.1,0.1),vec2(0.1,1.0)));
  if ((m&32)!=0) r=max(r,seg(p,vec2(0.1,1.0),vec2(0.1,1.9)));
  if ((m&64)!=0) r=max(r,seg(p,vec2(0.1,1.0),vec2(0.9,1.0)));
  return r;
}
float box1(float x, float a, float b){ return step(a,x)*step(x,b); }
float endMarks(float s, float t, float num, float w){
  float at = abs(t), m = 0.0;
  m = max(m, box1(s,6.0,36.0)*box1(at,1.5,w*0.5-3.0)*step(fract((at-1.5)/3.4),0.53));          // threshold bars
  float n = floor(num+0.5); int d1 = int(n)/10, d2 = int(n) - (int(n)/10)*10;
  vec2 p = vec2(t, s-46.0)/7.0;
  m = max(m, digit(p+vec2(1.25,0.0), d1)); m = max(m, digit(p-vec2(0.25,0.0), d2));
  m = max(m, box1(s,400.0,445.0)*box1(at,4.5,13.5));                                           // aiming point
  float tz = box1(s,150.0,172.0)*(box1(at,5.0,6.8)+box1(at,8.2,10.0)+box1(at,11.4,13.2))
           + box1(s,300.0,322.0)*(box1(at,5.0,6.8)+box1(at,8.2,10.0))
           + box1(s,600.0,622.0)*(box1(at,5.0,6.8)+box1(at,8.2,10.0)) + box1(s,750.0,772.0)*box1(at,5.0,6.8);
  return max(m, min(tz,1.0));
}
void main(){
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  vec3 alb = lin(vCol.rgb); float spec = vCol.a, gloss = 40.0 + 120.0*vCol.a; vec3 emis = vec3(0.0);
  float dist = length(vRel);
  if (uMode == 1) {            // fuselage: livery and windows from model-space position (x right, y up, z aft)
    vec3 L = vLocal;
    float yb = -1.25 + 4.7*smoothstep(7.0, 27.0, L.z);
    vec3 white = vec3(0.80,0.81,0.83), navy = vec3(0.045,0.10,0.24), aqua = vec3(0.16,0.60,0.80);
    vec3 c = L.y < yb ? navy : (L.y < yb+0.30 ? aqua : white);
    float inRow = step(-21.3,L.z)*step(L.z,17.2)*step(2.25,abs(L.x));
    float win = inRow*box1(L.y,0.52,0.92)*step(fract(L.z/0.62),0.52)*step(0.08, fract(L.z/7.9));
    if (win > 0.5 && L.y >= yb+0.30) { c = vec3(0.05,0.06,0.08); spec = 0.9; emis = vec3(1.0,0.82,0.55)*0.55*uNight; }
    float ck = box1(L.z,-26.1,-23.5)*box1(L.y, 0.28 + (L.z+23.5)*0.10, 1.12 + (L.z+23.5)*0.22);
    float pillar = step(abs(L.x),0.07) + step(abs(abs(L.x)-1.18),0.06);
    if (ck > 0.5 && pillar < 0.5) { c = vec3(0.03,0.04,0.055); spec = 1.0; }
    alb = lin(c); gloss = 120.0; spec = max(spec, 0.35);
  } else if (uMode == 2) {     // building: procedural windows
    vec3 an = abs(vBox); vec3 wall = vCol.rgb; float seed = vUV.x;
    if (an.y > 0.5) { alb = lin(wall*0.55 + 0.12); spec = 0.05; }
    else {
      float u = an.x > 0.5 ? vLocal.z : vLocal.x; vec2 g = vec2(u/3.3, vLocal.y/3.5); vec2 id = floor(g), f = fract(g);
      float win = step(0.2,f.x)*step(f.x,0.82)*step(0.28,f.y)*step(f.y,0.8);
      float fade = 1.0 - smoothstep(1500.0, 5000.0, dist);
      float lit = step(0.58, hash1(id + seed*71.0 + an.x*13.0));
      vec3 glass = mix(vec3(0.10,0.15,0.20), vec3(0.20,0.27,0.33), hash1(id*1.7+seed));
      alb = lin(mix(wall, glass, win*fade + (1.0-fade)*0.42));
      spec = mix(0.08, 0.7, win*fade);
      emis = vec3(1.0,0.74,0.42)*uNight*(win*lit*fade*0.75 + (1.0-fade)*0.03);
    }
  } else if (uMode == 3) {     // runway
    float w = uRwy.y, len = uRwy.x; float t = vUV.x, v = vUV.y;
    float sA = v + len*0.5, sB = len*0.5 - v;
    float m = max(endMarks(sA, t, uRwy.z, w), endMarks(sB, -t, uRwy.w, w));
    m = max(m, step(abs(t),0.45)*step(fract(v/60.0),0.5)*step(75.0,sA)*step(75.0,sB));
    m = max(m, step(abs(abs(t)-(w*0.5-1.2)),0.45));
    float lod = clamp(fwidth(t)*0.9, 0.0, 1.0);
    m *= 1.0 - 0.75*lod;
    float asp = 0.042 + 0.018*vnoise(vRel.xz*0.9+uCam.xz*0.9) + 0.014*vnoise((vRel.xz+uCam.xz)*0.06);
    float rubber = box1(min(sA,sB),180.0,900.0)*smoothstep(11.0,3.0,abs(t))*(0.5+0.5*vnoise(vec2(t*0.9, v*0.02)));
    asp *= 1.0 - 0.45*rubber;
    alb = mix(vec3(asp), vec3(0.62), m); spec = 0.12 + uWet*0.6; gloss = 30.0 + uWet*200.0;
  } else if (uMode == 4) {     // taxiways and aprons: vUV.x lateral metres, vUV.y kind (0 taxiway, 1 apron)
    float asp = 0.06 + 0.02*vnoise((vRel.xz+uCam.xz)*0.5);
    if (vUV.y > 0.5) { vec2 g = fract((vRel.xz+uCam.xz)/9.0); float j = step(g.x,0.02)+step(g.y,0.02); alb = vec3(0.17+0.03*vnoise((vRel.xz+uCam.xz)*0.2))*(1.0-0.25*min(j,1.0)); }
    else { float line = step(abs(vUV.x),0.22)*(1.0-clamp(fwidth(vUV.x)*1.2,0.0,0.85)); alb = mix(vec3(asp), vec3(0.75,0.55,0.03), line); }
    spec = 0.1 + uWet*0.5; gloss = 30.0 + uWet*150.0;
  }
  float ndl = max(dot(n,uSunDir),0.0);
  vec3 col = shade(alb, n, vRel, spec, gloss, shadowAt(vRel, ndl), emis);
  o = vec4(finish(applyFog(col, vRel)), 1.0);
}`;

  const depthVS = `
layout(location=0) in vec3 aPos; uniform mat4 uVP, uModel, uPart; uniform float uFlex;
void main(){ vec4 p = uPart*vec4(aPos,1.0); p.y += uFlex*pow(max(abs(p.x)-3.0,0.0)/27.0, 2.0); gl_Position = uVP*(uModel*p); }`;
  const depthFS = `precision mediump float; void main(){}`;

  // ---------- cloud deck (overcast layer), a camera-centred plane
  const deckVS = `
layout(location=0) in vec3 aPos; uniform mat4 uVP; uniform float uY, uExtent; out vec3 vRel;
void main(){ vRel = vec3(aPos.x*uExtent, uY, aPos.y*uExtent); gl_Position = uVP*vec4(vRel,1.0); }`;
  const deckFS = COMMON + `
in vec3 vRel; out vec4 o; uniform float uTopSide, uStorm; uniform vec2 uDrift;
void main(){
  vec2 p = (vRel.xz + uCam.xz + uDrift)/1900.0;
  float b = fbm(p)*0.65 + fbm(p*3.7+9.0)*0.35;
  vec3 c;
  if (uTopSide > 0.5) { float lit = 0.55 + 0.45*max(uSunDir.y,0.0); float bb = smoothstep(0.2,0.85,b); c = uSkyAmb*0.55 + uSunCol*lit*(0.13+0.26*bb); c = mix(c, c*0.6, uStorm*0.5); }
  else { c = (uSkyAmb*0.55 + uSunCol*0.10)*(0.45+0.6*b); c = mix(c, c*0.35, uStorm); c += uFlash*vec3(0.6,0.65,0.8)*b; }
  o = vec4(finish(applyFog(c, vRel)), 1.0);
}`;

  // ---------- cloud puffs: instanced billboards
  const cloudVS = `
layout(location=0) in vec3 aPos; layout(location=4) in vec4 iPos; layout(location=5) in vec4 iPar;
uniform mat4 uVP; uniform vec3 uCamV, uRight, uUp; uniform vec2 uWind; uniform vec4 uLayer; // base, top, cover, tile
out vec2 vUV; out vec3 vRel; out float vA; out float vSeed; out float vRelY;
void main(){
  float T = uLayer.w;
  vec2 xz = mod(iPos.xz + uWind - uCamV.xz + T*0.5, T) - T*0.5;
  vec3 c = vec3(xz.x, mix(uLayer.x, uLayer.y, iPos.y) - uCamV.y, xz.y);
  float dc = length(c);
  vA = smoothstep(iPar.y, iPar.y+0.07, uLayer.z) * (1.0-smoothstep(T*0.40, T*0.47, length(xz))) * smoothstep(120.0, 650.0, dc);
  float sz = iPos.w * (0.8 + 0.5*uLayer.z);
  vRel = c + (uRight*aPos.x + uUp*aPos.y*0.62)*sz;
  vUV = aPos.xy; vSeed = iPar.x; vRelY = iPos.y;
  gl_Position = vA > 0.003 ? uVP*vec4(vRel,1.0) : vec4(2.0,2.0,2.0,1.0);
}`;
  const cloudFS = COMMON + `
in vec2 vUV; in vec3 vRel; in float vA; in float vSeed; in float vRelY; out vec4 o;
uniform vec3 uRight, uUp, uFwd; uniform float uStorm;
void main(){
  float r = length(vUV);
  float n = vnoise(vUV*2.1 + vSeed*31.0)*0.6 + vnoise(vUV*5.3 + vSeed*17.0)*0.4;
  float a = smoothstep(1.0, 0.30, r + (n-0.5)*0.75);
  if (a*vA < 0.004) discard;
  vec3 nrm = normalize(uRight*vUV.x + uUp*vUV.y - uFwd*0.7);
  float sun = 0.30 + 0.70*max(dot(nrm,uSunDir),0.0);
  float under = mix(0.55, 1.0, smoothstep(-0.85, 0.45, vUV.y)) * mix(0.8, 1.05, vRelY);
  vec3 c = (uSkyAmb*0.85 + uSunCol*sun*0.75) * under * (0.86 + 0.28*n);
  c = mix(c, c*vec3(0.30,0.32,0.38), uStorm*(1.0-0.35*vRelY));
  c += uFlash*vec3(0.8,0.85,1.0)*0.9*n;
  o = vec4(finish(applyFog(c, vRel)), a*vA*0.93);
}`;

  // ---------- point lights (runway, city, aircraft)
  const lightVS = COMMON + `
layout(location=0) in vec3 aPos; layout(location=2) in vec4 aCol; layout(location=3) in vec2 aPar; // size m, class
uniform mat4 uVP; uniform vec3 uCamV, uGain; uniform float uPx;
out vec4 vC;
void main(){
  vec3 rel = aPos - uCamV; float d = length(rel);
  float px = aPar.x*uPx/max(d,1.0);
  float g = aPar.y < 0.5 ? uGain.x : (aPar.y < 1.5 ? uGain.y : uGain.z);
  float tr = exp(-fogTau(rel)*0.55);
  float b = aCol.a*g*tr*clamp(px/2.5, 0.10, 1.0);
  vC = vec4(lin(aCol.rgb)*b*1.15, 1.0);
  gl_PointSize = clamp(px, 2.5, 46.0) * (1.0 + 1.1*(1.0-tr)*step(0.5,aPar.y));
  gl_Position = uVP*vec4(rel,1.0); gl_Position.z -= 3e-5*gl_Position.w;
  if (b < 0.004) gl_Position = vec4(2.0,2.0,2.0,1.0);
}`;
  const lightFS = `precision highp float; in vec4 vC; out vec4 o;
void main(){ vec2 q = gl_PointCoord*2.0-1.0; float r2 = dot(q,q); float a = exp(-r2*10.0) + 0.16*exp(-r2*2.6); a *= smoothstep(1.0,0.6,r2); o = vec4(vC.rgb*a, 1.0); }`;

  // ---------- rain streaks
  const rainVS = `
layout(location=0) in vec3 aPos; layout(location=3) in vec2 aUV; uniform mat4 uVP; uniform vec3 uOff, uStreak; out float vA;
void main(){ float B = 70.0; vec3 p = mod(aPos*B - uOff, B) - B*0.5; p += uStreak*aUV.x; vA = (1.0-aUV.x*0.7)*smoothstep(B*0.5, B*0.3, length(p)); gl_Position = uVP*vec4(p,1.0); }`;
  const rainFS = `precision highp float; in float vA; out vec4 o; uniform vec4 uCol; void main(){ o = vec4(uCol.rgb, uCol.a*vA); }`;

  return { skyVS, skyFS, terrVS, terrFS, litVS, litFS, depthVS, depthFS, deckVS, deckFS, cloudVS, cloudFS, lightVS, lightFS, rainVS, rainFS };
})();
