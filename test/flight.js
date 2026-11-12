const FS=require('../src/core.js');
const {KT,FT,D2R,R2D}=FS;
const world=FS.buildWorld();
const DT=1/120;
function run(sim,secs,ctl,log){ const n=Math.round(secs/DT); for(let i=0;i<n;i++){ if(ctl)ctl(sim,i*DT); sim.step(DT); if(sim.crashed){console.log('  CRASH:',sim.crashed.reason,'t',sim.s.t.toFixed(1));return false;} if(log&&i%Math.round(log/DT)===0) pr(sim);} return true; }
function pr(sim){const d=sim.d,s=sim.s; console.log(`  t${s.t.toFixed(0).padStart(4)} ias ${(d.ias*KT).toFixed(0).padStart(3)} alt ${(d.alt*FT).toFixed(0).padStart(6)} vs ${(d.vs*196.85).toFixed(0).padStart(6)} pit ${(d.pitch*R2D).toFixed(1).padStart(5)} rol ${(d.roll*R2D).toFixed(1).padStart(5)} hdg ${d.hdg.toFixed(0).padStart(3)} aoa ${(d.alpha*R2D).toFixed(1).padStart(5)} thr ${sim.inp.throttle.toFixed(2)} n1 ${s.n1[0].toFixed(0)} trim ${s.trim.toFixed(2)} elev ${s.elev.toFixed(2)} nz ${d.nz.toFixed(2)} gnd ${d.onGround?1:0} dist ${(s.dist).toFixed(0)}`);}
const which=process.argv[2]||'all';
function T(name,fn){ if(which==='all'||which===name){ console.log('=== '+name); fn(); } }

T('static',()=>{ const sim=new FS.Sim(world); sim.placeOnRunway('MRD',false); const p0=sim.s.pos.slice(); run(sim,10); const s=sim.s; console.log('  drift',Math.hypot(s.pos[0]-p0[0],s.pos[1]-p0[1]).toFixed(3),'pitch',(sim.d.pitch*R2D).toFixed(2),'comp',s.comp.map(x=>x.toFixed(2)).join(','),'cgh',(sim.d.alt-14).toFixed(2)); });

T('takeoff',()=>{ const sim=new FS.Sim(world); sim.placeOnRunway('MRD',false); const s=sim.s; s.flapIdx=2; s.parkBrake=false; let rot=false,lift=null;
  run(sim,75,(sim,t)=>{ sim.inp.throttle=1; const d=sim.d;
    if(d.ias*KT>150) rot=true;
    if(rot){ const tgt=d.onGround?9:12; sim.inp.pitch=FS.clamp(0.25*(tgt-d.pitch*R2D)-0.6*s.om[1]*R2D*0.2,-1,1);} 
    sim.inp.roll=FS.clamp(-2*d.roll-1*s.om[0],-1,1);
    if(!d.onGround&&lift===null&&t>5){lift={t,dist:s.dist,ias:d.ias*KT};}
    if(d.agl>15) s.gearTarget=0; if(d.alt*FT>1500) s.flapIdx=0; },5);
  console.log('  liftoff',lift); });

T('cruiseAP',()=>{ const sim=new FS.Sim(world); sim.placeInAir({n:0,e:-40000,alt:3000,hdg:90,ias:250/KT,ap:true}); pr(sim);
  run(sim,60,null,10); console.log('  -> hdg 180, alt +3000ft, spd 280'); sim.ap.hdg=180; sim.ap.alt+=3000/FT; sim.ap.spd=280/KT; run(sim,150,null,15);
  console.log('  -> descend 5000ft, spd 210'); sim.ap.alt-=5000/FT; sim.ap.spd=210/KT; run(sim,200,null,20); });

T('stall',()=>{ const sim=new FS.Sim(world); sim.placeInAir({n:0,e:-40000,alt:3000,hdg:90,ias:220/KT}); 
  let minIas=999,maxA=0,warnAt=null; run(sim,70,(sim,t)=>{ sim.inp.throttle=0; sim.inp.pitch= t>5&&t<50?0.8:0; const d=sim.d; minIas=Math.min(minIas,d.ias*KT); maxA=Math.max(maxA,d.alpha*R2D); if(d.stallWarn&&!warnAt)warnAt=(d.ias*KT).toFixed(0); },5);
  console.log('  minIas',minIas.toFixed(0),'maxAoA',maxA.toFixed(1),'warn at',warnAt,'vStall',(sim.vStall()*KT).toFixed(0)); });

T('glide',()=>{ const sim=new FS.Sim(world); sim.placeInAir({n:0,e:-40000,alt:3000,hdg:90,ias:220/KT,ap:true}); sim.ap.at=false; sim.s.engOn=[false,false];
  // hold speed with pitch: use VS mode crude -> manual pitch loop for 220 kt
  sim.ap.on=false; const a0=sim.d.alt,d0=sim.s.dist; run(sim,5); 
  run(sim,120,(sim)=>{const d=sim.d; sim.inp.pitch=FS.clamp(0.04*(d.ias*KT-215)-0.5*sim.s.om[1]*10 - 2*(d.pitch+0.03),-1,1); sim.inp.roll=FS.clamp(-2*d.roll-sim.s.om[0],-1,1);},20);
  console.log('  glide ratio',((sim.s.dist-d0)/(a0-sim.d.alt)).toFixed(1)); });

T('ils',()=>{ for(const wx of ['clear','crosswind']){ const sim=new FS.Sim(world); sim.weather=Object.assign({},FS.WEATHER[wx]); if(wx==='crosswind'){sim.weather.windDir=180;}
  const rw=FS.runway('MRD',true); sim.nav.ils=rw; // rwy 27, start 12nm east, offset north, hdg 240
  sim.placeInAir({n:rw.thr[0]+6000,e:rw.thr[1]+30000,alt:14+900,hdg:240,ias:190/KT,ap:true}); sim.ap.appArmed=true;
  console.log(' wx',wx); let ok=run(sim,420,(sim,t)=>{ const d=sim.d,s=sim.s,il=sim.ilsDev(); if(il.dist<16000) {s.flapIdx=3; sim.ap.spd=170/KT;} if(il.dist<11000){ s.gearTarget=1; s.flapIdx=5;sim.ap.spd=155/KT;} if(il.dist<7000){s.flapIdx=6; sim.ap.spd=145/KT;}
    if(d.onGround&&sim.lastTouch){ sim.inp.brake=1; sim.inp.throttle=0; const il2=sim.ilsDev(); sim.inp.yaw=FS.clamp(-0.02*il2.cross-0.08*FS.wrapPi((d.hdg-rw.course)*D2R)*R2D,-1,1);} },40);
  const lt=sim.lastTouch; if(lt){ const rn=lt.n-rw.thr[0],re=lt.e-rw.thr[1]; console.log('  touchdown vs',(lt.vs*196.85).toFixed(0),'fpm ias',(lt.ias*KT).toFixed(0),'along',(rn*rw.dn+re*rw.de).toFixed(0),'cross',(-rn*rw.de+re*rw.dn).toFixed(1),'pitch',(lt.pitch*R2D).toFixed(1),'roll',(lt.roll*R2D).toFixed(1),'crab',FS.wrapPi((lt.hdg-rw.course)*D2R)*R2D); pr(sim); const il=sim.ilsDev(); console.log('  final along',il.along.toFixed(0),'cross',il.cross.toFixed(1),'gs',sim.d.gs.toFixed(1),'surface',sim.d.surface);} }});
