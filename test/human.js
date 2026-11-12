const FS=require('../src/core.js'); const {KT,FT,R2D,clamp}=FS; const world=FS.buildWorld();
const sim=new FS.Sim(world); sim.placeOnRunway('MRD',false); const s=sim.s; s.flapIdx=2; s.parkBrake=false;
let ax=0, key=0, maxA=0, maxP=0, minVs=1e9, lift=null;
for(let i=0;i<120*90;i++){ const d=sim.d, dt=1/120; sim.inp.throttle=Math.min(1,sim.inp.throttle+0.42*dt);
  // crude keyboard pilot: S held below target pitch, W held when too high (reaction every 0.25 s)
  if(i%30===0){ const p=d.pitch*R2D; const tgt = d.ias*KT<150?-99 : 11; key = tgt<0?0 : p<tgt-1.5?1 : p>tgt+2.5?-1 : 0; }
  ax += clamp(key-ax, -(key===0?3.4:1.9)*dt, (key===0?3.4:1.9)*dt); sim.inp.pitch=ax*0.85; sim.inp.roll=0;
  if(d.agl>15) s.gearTarget=0;
  sim.step(dt); if(sim.crashed){console.log('CRASH',sim.crashed.reason,'t',i/120);break;}
  if(!d.onGround&&lift===null&&i>600) lift=(i/120).toFixed(1)+'s at '+Math.round(d.ias*KT)+'kt';
  if(!d.onGround){ maxA=Math.max(maxA,d.alpha*R2D); maxP=Math.max(maxP,d.pitch*R2D); if(i>120*45) minVs=Math.min(minVs,d.vs*196.85);} 
  if(i%(120*10)===0) console.log('t',i/120,'ias',Math.round(d.ias*KT),'alt',Math.round(d.alt*FT),'pitch',(d.pitch*R2D).toFixed(1),'aoa',(d.alpha*R2D).toFixed(1),'trim',s.trim.toFixed(2),'roll',(d.roll*R2D).toFixed(1),'hdg',d.hdg.toFixed(0),'stallWarn',d.stallWarn); }
console.log('liftoff',lift,'maxAoA',maxA.toFixed(1),'maxPitch',maxP.toFixed(1),'min vs after 45s',Math.round(minVs));
