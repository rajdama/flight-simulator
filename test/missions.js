global.FS=require('../src/core.js'); const M=require('../src/missions.js'); const FS=global.FS; const {KT,FT,R2D}=FS;
const world=FS.buildWorld();
for(const def of M.list){ const sim=new FS.Sim(world); const run=new M.Run(def,sim,{}); let ev=[];
  for(let i=0;i<120*40;i++){ sim.step(1/120); if(i%2==0) ev=ev.concat(run.update(1/60)); if(sim.crashed)break; }
  const d=sim.d; const il=sim.ilsDev();
  console.log(def.id.padEnd(10),'state',run.state,run.failReason,'step',run.step,'ias',(d.ias*KT).toFixed(0),'alt',(d.alt*FT).toFixed(0),'vs',(d.vs*196.85).toFixed(0),'hdg',d.hdg.toFixed(0),'trk',d.track.toFixed(0),'roll',(d.roll*R2D).toFixed(1),'pitch',(d.pitch*R2D).toFixed(1),'ap',sim.ap.on,'fuel',sim.s.fuel.toFixed(0), il?('loc '+il.locDeg.toFixed(2)+' gs '+il.gsDeg.toFixed(2)+' dist '+il.dist.toFixed(0)):'', sim.events.filter(e=>e.type==='alert').map(e=>e.text).join('|')); }
