global.FS=require('../src/core.js'); const M=require('../src/missions.js'); const FS=global.FS; const {KT,FT,R2D,D2R}=FS;
const world=FS.buildWorld(); const def=M.list.find(m=>m.id==='crossing');
let prev={n:-24000,e:-18200,name:'MRD'};
for(const w of def.route){ let mx=0; for(let t=0;t<=1;t+=0.01){ mx=Math.max(mx,world.heightAt(prev.n+(w.n-prev.n)*t,prev.e+(w.e-prev.e)*t)); } console.log(prev.name,'->',w.name,'dist km',(Math.hypot(w.n-prev.n,w.e-prev.e)/1000).toFixed(1),'max terrain ft',Math.round(mx*FT)); prev=w; }
// fly the whole crossing with the autopilot: takeoff scripted, then NAV, descent, APP
const sim=new FS.Sim(world); const run=new M.Run(def,sim,{}); const s=sim.s; s.parkBrake=false; let rot=false, phase=0, ev=[];
for(let i=0;i<120*1100;i++){ const d=sim.d, t=i/120;
  if(phase===0){ sim.inp.throttle=1; if(d.ias*KT>150)rot=true; if(rot){const tgt=d.onGround?9:12; sim.inp.pitch=FS.clamp(0.25*(tgt-d.pitch*R2D)-0.6*s.om[1]*R2D*0.2,-1,1);} sim.inp.roll=FS.clamp(-2*d.roll-s.om[0],-1,1); if(d.agl>15)s.gearTarget=0; if(d.alt*FT>1500){ s.flapIdx=0; sim.apEngage(true); sim.ap.alt=5000/FT; sim.ap.spd=250/KT; sim.ap.lat='NAV'; phase=1; } }
  else if(phase===1){ if(sim.nav.wp>=2){ sim.ap.alt=2000/FT; sim.ap.spd=180/KT; phase=2; } }
  else if(phase===2){ if(sim.nav.wp>=3){ sim.ap.appArmed=true; s.flapIdx=3; phase=3; } }
  else if(phase===3){ const il=sim.ilsDev(); if(il.dist<9000){ s.gearTarget=1; s.flapIdx=6; sim.ap.spd=146/KT; } if(d.onGround&&sim.lastTouch){ sim.inp.brake=1; sim.inp.throttle=0; sim.inp.yaw=FS.clamp(-0.02*il.cross-0.08*FS.wrapPi((d.hdg-30)*D2R)*R2D,-1,1); } }
  sim.step(1/120); if(i%4===0) ev=ev.concat(run.update(1/30));
  if(i%(120*60)===0) console.log('t',t.toFixed(0),'ph',phase,'alt',Math.round(d.alt*FT),'ias',Math.round(d.ias*KT),'hdg',Math.round(d.hdg),'wp',sim.nav.wp,'step',run.step,'lat',sim.ap.lat,'vert',sim.ap.vert,'agl',Math.round(d.agl*FT));
  if(run.state!=='flying'){ console.log('END',run.state,run.failReason,'t',t.toFixed(0)); break; } }
console.log(run.results().map(l=>l.join(': ')).join(' | '));
