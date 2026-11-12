'use strict';
/* Mission definitions and the runtime that tracks objectives. Pure logic. */
const MISSIONS = (function () {
  const { KT, FT, D2R, R2D, wrapPi, runway, AIRPORTS, segDist, WEATHER } = FS;
  const fpm = v => v * 196.85;
  function nearestAirport(sim) {
    let best = null, bd = 1e9;
    for (const a of AIRPORTS) { const d = segDist(sim.s.pos[0], sim.s.pos[1], a.a, a.b); if (d < bd) { bd = d; best = a; } }
    return bd < 1500 ? best : null;
  }
  const onRunwayAt = (sim, id) => sim.d.onGround && sim.d.surface === 'runway' && (nearestAirport(sim) || {}).id === id;
  const onAirportAt = (sim, id) => sim.d.onGround && (sim.d.surface === 'runway' || sim.d.surface === 'airport') && (nearestAirport(sim) || {}).id === id;
  function landingReport(sim) {
    const lt = sim.lastTouch; if (!lt) return null;
    let best = null;
    for (const a of AIRPORTS) for (const rc of [false, true]) {
      const rw = runway(a.id, rc), rn = lt.n - rw.thr[0], re = lt.e - rw.thr[1];
      const along = rn * rw.dn + re * rw.de, cross = -rn * rw.de + re * rw.dn;
      const dirErr = Math.abs(wrapPi((lt.track - rw.course) * D2R));
      if (along > -200 && along < rw.len + 100 && Math.abs(cross) < rw.width / 2 + 40 && dirErr < 1.2) { if (!best || dirErr < best.dirErr) best = { rw, along, cross, dirErr }; }
    }
    const rate = fpm(lt.vs);
    const r = { rate, ias: lt.ias * KT, onRunway: !!best, pitch: lt.pitch * R2D, roll: lt.roll * R2D };
    let score = 100 - FS.clamp((rate - 120) / 8, 0, 45);
    if (best) {
      r.runway = best.rw.id; r.offset = best.cross; r.along = best.along; r.crab = wrapPi((lt.hdg - best.rw.course) * D2R) * R2D;
      score -= FS.clamp(Math.abs(best.cross) - 2, 0, 20) * 1.2 + (best.along < 100 || best.along > 1000 ? 12 : 0) + FS.clamp(Math.abs(r.crab) - 3, 0, 10);
    } else score -= 35;
    r.score = Math.max(0, Math.round(score));
    r.grade = rate < 160 ? 'Greaser' : rate < 340 ? 'Smooth' : rate < 520 ? 'Firm' : 'Hard';
    return r;
  }
  function reportLines(r) {
    if (!r) return [];
    const L = [['Touchdown rate', Math.round(r.rate) + ' fpm · ' + r.grade], ['Touchdown speed', Math.round(r.ias) + ' kt']];
    if (r.onRunway) { L.push(['Runway', r.runway]); L.push(['Centreline offset', Math.abs(r.offset).toFixed(1) + ' m ' + (r.offset > 0.5 ? 'right' : r.offset < -0.5 ? 'left' : '')]); L.push(['Past the threshold', Math.round(r.along) + ' m']); L.push(['Crab at touchdown', Math.abs(r.crab).toFixed(1) + '°']); }
    else L.push(['Runway', 'missed the paved surface']);
    L.push(['Landing score', r.score + ' / 100']);
    return L;
  }
  const dwell = (ctx, key, cond, secs, dt) => { ctx[key] = cond ? (ctx[key] || 0) + dt : 0; return ctx[key] >= secs; };

  const list = [
    {
      id: 'departure', title: 'First Departure', kicker: 'Take-off', airport: 'Meridian Intl · RWY 09',
      brief: 'A calm morning at Meridian. Line up is done for you. Configure the aircraft, take off from runway 09 and climb out over the bay to 5,000 ft.',
      time: 8.4, timeRate: 1, wx: 'clear', fuel: 30000,
      setup(sim) { sim.placeOnRunway('MRD', false); sim.nav.ils = runway('MRD', false); },
      steps: [
        { t: 'Set flaps 5', k: 'X', ok: s => s.s.flapIdx === 2 },
        { t: 'Release the parking brake and set full thrust', k: 'B then hold R', ok: s => !s.s.parkBrake && s.inp.throttle > 0.92 },
        { t: 'At 150 kt, ease the nose up to about 10°', k: 'S or ↓', ok: s => s.d.agl > 12 },
        { t: 'Positive climb: gear up', k: 'G', ok: s => s.s.gearTarget === 0 && !s.d.onGround },
        { t: 'Passing 3,000 ft, retract the flaps', k: 'Z', ok: s => s.d.alt * FT > 3000 && s.s.flapIdx === 0 },
        { t: 'Level off at 5,000 ft', k: 'W / S, or autopilot P', ok: (s, c, dt) => dwell(c, 'lvl', s.d.alt * FT > 4650 && s.d.alt * FT < 5400 && Math.abs(fpm(s.d.vs)) < 700, 5, dt) }
      ],
      result: (sim) => [['Airborne after', Math.round(sim.s.t - sim.s.airTime) + ' s'], ['Fuel used', Math.round(30000 - sim.s.fuel) + ' kg']]
    },
    {
      id: 'crossing', title: 'Golden Hour Crossing', kicker: 'Cross-country', airport: 'Meridian → Halcyon Bay · 40 NM',
      brief: 'Fly the island from the south-west coast to Halcyon Bay. Take off from runway 09, follow the magenta route past the mountains at 5,000 ft, and land on runway 03 as the sun goes down. The autopilot can fly the cruise: P to engage, then NAV.',
      time: 15.3, timeRate: 12, wx: 'scattered', fuel: 30000, cruise: 5000,
      route: [{ name: 'SALTY', n: -22000, e: 0 }, { name: 'RIDGE', n: -4000, e: 16000 }, { name: 'BAYLA', n: 11350, e: 23280 }, { name: 'HLB', n: 21744, e: 29275 }],
      setup(sim) { sim.placeOnRunway('MRD', false); sim.s.flapIdx = 2; sim.nav.ils = runway('HLB', false); },
      steps: [
        { t: 'Take off from runway 09', k: 'B, R, rotate at 150 kt', ok: s => s.d.agl > 15 },
        { t: 'Gear up, flaps up, climb to 5,000 ft', k: 'G, Z, then autopilot P', ok: s => s.s.gearTarget === 0 && s.s.flapIdx === 0 && s.d.alt * FT > 4600 },
        { t: 'Follow the magenta route past SALTY to RIDGE', k: 'NAV on the autopilot panel', ok: s => s.nav.wp >= 2 },
        { t: 'At RIDGE descend to 2,000 ft and slow to 180 kt', k: 'ALT and SPD windows, K speedbrake', ok: s => s.nav.wp >= 3 },
        { t: 'Past BAYLA arm the approach. Gear down, flaps 30, 145 kt', k: 'APP, G, X', ok: s => s.s.gearTarget === 1 && s.s.flapIdx >= 5 },
        { t: 'Land on runway 03 at Halcyon Bay', k: 'APP flies the ILS', ok: s => onRunwayAt(s, 'HLB') },
        { t: 'Brake to a stop', k: 'Space', ok: s => s.d.onGround && s.d.gs < 2 }
      ],
      result: (sim) => reportLines(landingReport(sim)).concat([['Fuel used', Math.round(30000 - sim.s.fuel) + ' kg']])
    },
    {
      id: 'storm', title: 'Stormfront', kicker: 'Thunderstorm', airport: 'Over the western sea · 10,000 ft',
      brief: 'A line of thunderstorms blocks the way home. Fly through it at 10,000 ft. Expect severe turbulence, heavy rain and strong up- and downdrafts. Keep the wings level and hold your altitude.',
      time: 17.2, timeRate: 1, wx: 'storm', fuel: 22000,
      route: [{ name: 'ENTRY', n: -10000, e: -47000 }, { name: 'CORE', n: -10000, e: -30000 }, { name: 'EXIT', n: -10000, e: -13000 }],
      setup(sim) { sim.placeInAir({ n: -10000, e: -60000, alt: 3048, hdg: 90, ias: 270 / KT, ap: true }); sim.ap.lat = 'NAV'; },
      tick(sim, c, dt) {
        const d = sim.d;
        if (sim.nav.wp >= 1 && !c.struck) { c.struck = true; sim.apInop = true; sim.apDisengage(); sim.ap.at = false; sim.events.push({ type: 'lightning', strike: true }); sim.events.push({ type: 'alert', text: 'LIGHTNING STRIKE — autopilot and autothrottle failed' }); }
        if (c.struck) { c.maxDev = Math.max(c.maxDev || 0, Math.abs(d.alt * FT - 10000)); c.maxBank = Math.max(c.maxBank || 0, Math.abs(d.roll * R2D)); c.maxG = Math.max(c.maxG || 1, d.nz); }
        if (d.alt * FT < 4000) return 'Lost control of altitude in the storm';
      },
      steps: [
        { t: 'Fly into the storm line at 10,000 ft', k: 'autopilot is on', ok: s => s.nav.wp >= 1 },
        { t: 'Autopilot failed. Hand-fly the core: wings level, 10,000 ft', k: 'small, steady inputs', ok: s => s.nav.wp >= 2 },
        { t: 'Hold on until you break out the far side', k: 'R / F for speed', ok: s => s.nav.wp >= 3 }
      ],
      result: (sim, c) => [['Largest altitude excursion', Math.round(c.maxDev || 0) + ' ft'], ['Steepest bank', Math.round(c.maxBank || 0) + '°'], ['Peak load', (c.maxG || 1).toFixed(1) + ' g']]
    },
    {
      id: 'deadstick', title: 'Dead Stick', kicker: 'Emergency landing', airport: '17 NM north-east of Meridian · 7,000 ft',
      brief: 'Engine 2 is about to fail and a fuel leak will starve the other. You will have no thrust and one chance. Glide to Meridian and land on runway 27.',
      time: 11.0, timeRate: 1, wx: 'clear', fuel: 2300,
      setup(sim) { sim.placeInAir({ n: -6000, e: 6000, alt: 2134, hdg: 235, ias: 250 / KT, ap: true }); sim.nav.ils = runway('MRD', true); sim.nav.route = [{ name: 'MRD', n: -24000, e: -18200 }]; },
      tick(sim, c, dt) {
        const s = sim.s;
        if (s.t > 7 && !c.eng) { c.eng = true; s.engOn[1] = false; sim.fuelLeak = 21; sim.events.push({ type: 'alert', text: 'ENGINE 2 FIRE — engine shut down. Fuel leak.' }); }
        if (s.fuel <= 0 && !c.out) { c.out = true; if (sim.ap.on) sim.apDisengage(); sim.ap.at = false; sim.apInop = true; sim.events.push({ type: 'alert', text: 'AUTOPILOT DISCONNECT — no thrust. Glide at 210 kt.' }); }
      },
      steps: [
        { t: 'Engine 2 has failed. Keep the aircraft straight', k: 'Q / E rudder if hand-flying', ok: (s, c) => c.eng && s.s.t > 14 },
        { t: 'Fuel is leaking. Point the nose at Meridian', k: 'follow the ND', ok: (s, c) => c.out },
        { t: 'No engines. Glide clean at about 210 kt', k: 'pitch for speed', ok: s => Math.hypot(s.s.pos[0] + 24000, s.s.pos[1] + 18200) < 9000 },
        { t: 'Gear down when the runway is made', k: 'G · flaps X · speedbrake K', ok: s => s.s.gearTarget === 1 },
        { t: 'Land at Meridian and stop', k: 'Space to brake', ok: s => onAirportAt(s, 'MRD') && s.d.gs < 2 }
      ],
      result: (sim) => reportLines(landingReport(sim))
    },
    {
      id: 'crosswind', title: 'Sideways into Halcyon', kicker: 'Crosswind landing', airport: 'Halcyon Bay · RWY 03 · wind 120° at 27 kt',
      brief: 'A gusting sea wind blows straight across runway 03. You are on a 7 NM final, configured to land. Crab into the wind to hold the centreline, then straighten the nose with rudder just before the wheels touch.',
      time: 13.6, timeRate: 1, wx: 'crosswind', fuel: 18000,
      setup(sim) { const rw = runway('HLB', false); sim.nav.ils = rw; sim.placeInAir({ n: rw.thr[0] - rw.dn * 13000, e: rw.thr[1] - rw.de * 13000, alt: 9 + 13300 * Math.tan(3 * D2R), hdg: 40, ias: 150 / KT, gamma: -3 * D2R, gear: true, flapIdx: 6 }); sim.atEngage(); sim.ap.spd = 148 / KT; },
      tick(sim, c) { if (sim.d.onGround && sim.d.gs > 8 && sim.lastTouch && sim.d.surface !== 'runway') return 'Left the runway'; },
      steps: [
        { t: 'Track the centreline with the nose crabbed into the wind', k: 'watch the diamond under the PFD', ok: s => { const il = s.ilsDev(); return il && il.dist < 3500; } },
        { t: 'In the flare, rudder the nose straight and hold the upwind wing down', k: 'Q / E with opposite A / D', ok: s => onRunwayAt(s, 'HLB') },
        { t: 'Keep it on the centreline and stop', k: 'Space, Q / E', ok: s => s.d.onGround && s.d.gs < 2 }
      ],
      result: (sim) => reportLines(landingReport(sim))
    },
    {
      id: 'minimums', title: 'Minimums', kicker: 'Instrument landing', airport: 'Meridian Intl · ILS RWY 27 · visibility 1,100 m',
      brief: 'Fog has closed in before dawn. You cannot see the runway until 200 ft. Fly the ILS on instruments: arm APP to let the autopilot capture the localizer and glideslope, or hand-fly the two magenta diamonds on the PFD.',
      time: 5.55, timeRate: 1, wx: 'fog', fuel: 16000,
      setup(sim) { const rw = runway('MRD', true); sim.nav.ils = rw; sim.placeInAir({ n: rw.thr[0] + 5500, e: rw.thr[1] + 27000, alt: 14 + 760, hdg: 240, ias: 185 / KT, flapIdx: 2, ap: true }); },
      steps: [
        { t: 'Arm the approach', k: 'APP on the autopilot panel', ok: s => { const il = s.ilsDev(); return s.ap.appArmed || s.ap.locCap || (il && Math.abs(il.locDeg) < 0.4 && il.dist < 20000); } },
        { t: 'Localizer and glideslope captured', k: 'LOC and G/S turn green', ok: s => { const il = s.ilsDev(); return s.ap.gsCap || (il && Math.abs(il.locDeg) < 0.5 && Math.abs(il.gsDeg) < 0.35 && s.d.vs < -1.5); } },
        { t: 'Gear down, flaps 30, speed 145 kt', k: 'G, X, SPD knob', ok: s => s.s.gearTarget === 1 && s.s.flapIdx === 6 },
        { t: 'Runway lights in sight at 200 ft. Land', k: 'the autopilot will flare', ok: s => onRunwayAt(s, 'MRD') },
        { t: 'Brake to a stop', k: 'Space', ok: s => s.d.onGround && s.d.gs < 2 }
      ],
      result: (sim) => reportLines(landingReport(sim)).concat([['Flown by', sim._manualLanding ? 'hand' : 'autoland']])
    },
    {
      id: 'free', title: 'Free Flight', kicker: 'Sandbox', airport: 'Any airport, any weather, any hour',
      brief: 'No objectives. Pick an airport, a time of day and the weather, then fly where you like. Three airports have ILS on every runway.',
      time: 10, timeRate: 1, wx: 'scattered', fuel: 40000, free: true,
      setup(sim, o) { sim.placeOnRunway(o.ap || 'MRD', !!o.recip); sim.nav.ils = runway(o.ap || 'MRD', !!o.recip); },
      steps: [], result: () => []
    }
  ];

  class Run {
    constructor(def, sim, opts) {
      this.def = def; this.sim = sim; this.step = 0; this.ctx = {}; this.state = 'flying'; this.failReason = '';
      sim.reset(); sim.apInop = false; sim._manualLanding = false;
      sim.weather = Object.assign({}, WEATHER[(opts && opts.wx) || def.wx]);
      sim.s.fuel = def.fuel;
      sim.nav.route = (def.route || []).map(w => Object.assign({}, w)); sim.nav.wp = 0;
      def.setup(sim, opts || {});
      sim.events.length = 0;
    }
    update(dt) {
      const sim = this.sim, def = this.def, out = [];
      if (this.state !== 'flying') return out;
      const r = sim.nav.route;
      if (r.length && sim.nav.wp < r.length) { const w = r[sim.nav.wp]; if (Math.hypot(sim.s.pos[0] - w.n, sim.s.pos[1] - w.e) < 2600) { sim.nav.wp++; out.push({ type: 'wp', name: w.name }); } }
      if (sim.lastTouch && !sim.ap.on && !this.ctx._lt) { this.ctx._lt = true; }
      if (!sim.ap.on && sim.d.agl > 20 && sim.d.agl < 150 && sim.d.vs < 0) sim._manualLanding = true;
      if (sim.crashed) { this.state = 'failed'; this.failReason = sim.crashed.reason; return out; }
      if (def.tick) { const f = def.tick(sim, this.ctx, dt); if (f) { this.state = 'failed'; this.failReason = f; return out; } }
      while (this.step < def.steps.length && def.steps[this.step].ok(sim, this.ctx, dt)) { this.step++; out.push({ type: 'step', index: this.step }); }
      if (def.steps.length && this.step >= def.steps.length) { this.state = 'done'; out.push({ type: 'done' }); }
      return out;
    }
    results() { return this.def.result ? this.def.result(this.sim, this.ctx) : []; }
  }
  return { list, Run, landingReport, reportLines, nearestAirport };
})();
if (typeof module !== 'undefined') module.exports = MISSIONS;
