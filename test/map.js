const FS=require('../src/core.js');
const t0=Date.now(); const w=FS.buildWorld(); console.log('world ms',Date.now()-t0);
const chars=' .:-=+*#%@';
let maxH=0,land=0;
for(let k=0;k<w.H.length;k++){ if(w.H[k]>maxH)maxH=w.H[k]; if(w.H[k]>0)land++; }
console.log('maxH',maxH.toFixed(0),'land frac',(land/w.H.length).toFixed(2));
const R=64, C=128;
const marks={};
for(const a of FS.AIRPORTS) marks[Math.round((1-(a.n+64000)/128000)*(R-1))+','+Math.round((a.e+64000)/128000*(C-1))]=a.id[0];
for(const c of FS.CITIES) marks[Math.round((1-(c.n+64000)/128000)*(R-1))+','+Math.round((c.e+64000)/128000*(C-1))]=c.name[0].toLowerCase();
for(let r=0;r<R;r++){ let line='';
  for(let c=0;c<C;c++){ const n=64000-r/(R-1)*128000, e=-64000+c/(C-1)*128000; const h=w.heightAt(n,e);
    const m=marks[r+','+c]; line+= m? m : h<=0?' ': chars[Math.min(9,1+Math.floor(h/330))]; }
  console.log(line); }
for(const a of FS.AIRPORTS){ let mn=1e9,mx=-1e9; for(let t=-0.5;t<=0.5;t+=0.05){const h=w.heightAt(a.n+a.dn*a.len*t,a.e+a.de*a.len*t); mn=Math.min(mn,h);mx=Math.max(mx,h);} 
  // approach terrain clearance both ends
  let worst=1e9; for(const sgn of [-1,1]) for(let dd=500;dd<16000;dd+=250){ const n=a.n+sgn*a.dn*(a.len/2+dd), e=a.e+sgn*a.de*(a.len/2+dd); const path=a.elev+(dd+300)*Math.tan(3*Math.PI/180); worst=Math.min(worst,path-Math.max(0,w.heightAt(n,e))); }
  console.log(a.id,'rwy h',mn.toFixed(1),mx.toFixed(1),'min approach clearance',worst.toFixed(0)); }
