#!/usr/bin/env python3
"""Record a gameplay montage of the simulator, frame by frame, with a virtual clock.

The page's requestAnimationFrame and performance.now are replaced so each captured
frame advances the simulation by exactly 1/FPS seconds, however slow the renderer is.
That makes the recording smooth even with software WebGL.

Usage:  python3 tools/record.py OUT_DIR [segment ...]
        segments: takeoff dusk storm ils   (default: all)
Then encode, for example:
        ffmpeg -framerate 24 -pattern_type glob -i 'OUT_DIR/*.jpg' -c:v libx264 -pix_fmt yuv420p -crf 20 media/demo.mp4
Requires: playwright (Python) and a Chrome/Chromium binary (set CHROME to its path).
"""
import os, sys, time, json, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'frames'); OUT.mkdir(parents=True, exist_ok=True)
SEGS = sys.argv[2:] or ['takeoff', 'dusk', 'storm', 'ils']
FPS, W, H = 24, 1280, 720
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')

CLOCK = """(() => { let now = 0; const cbs = [];
  window.__vt = { step(ms) { now += ms; const c = cbs.splice(0); for (const f of c) f(now); } };
  window.requestAnimationFrame = f => { cbs.push(f); return cbs.length; };
  performance.now = () => now; })();"""

# advance the physics quickly (no rendering) until a condition holds; `ctl` runs before every step
FAST = """(a) => { const S = window.__sim, sim = S.sim, until = new Function('sim', 'S', 'return ' + a.until), ctl = a.ctl ? new Function('sim', 'S', a.ctl) : null;
  let i = 0; for (; i < 120 * a.max; i++) { if (until(sim, S)) break; if (ctl) ctl(sim, S); sim.step(1 / 120); if (i % 4 === 0 && S.run) S.run.update(1 / 30); }
  return (i / 120).toFixed(1) + ' s'; }"""
STATE = """() => { const S = window.__sim, d = S.sim.d; return { ias: d.ias * 1.943844, pitch: d.pitch * 57.2958, agl: d.agl * 3.28084, gnd: d.onGround, touched: !!S.sim.lastTouch, t: S.sim.s.t }; }"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': W, 'height': H})
    pg.add_init_script(CLOCK)
    pg.on('pageerror', lambda e: print('PAGEERROR', str(e)[:500]))
    pg.goto((ROOT / 'index.html').as_uri())
    for _ in range(120):
        if pg.evaluate('!!window.__sim'): break
        time.sleep(0.25)
    # fixed full resolution (the adaptive scaler would react to the slow software renderer)
    pg.evaluate("(() => { const s = document.getElementById('s-gfx'); s.value = '1'; s.dispatchEvent(new Event('change')); })()")
    n = [len(list(OUT.glob('*.jpg')))]
    held = set()

    def key(k, down):
        if down and k not in held: pg.keyboard.down(k); held.add(k)
        if not down and k in held: pg.keyboard.up(k); held.discard(k)

    def frame(prefix):
        pg.evaluate('window.__vt.step(%f)' % (1000.0 / FPS))
        pg.screenshot(path=str(OUT / ('%s_%04d.jpg' % (prefix, n[0]))), type='jpeg', quality=93); n[0] += 1

    def settle(k=8):
        # one big clock jump expires the on-screen messages (the sim itself caps a frame at 0.1 s), then a few normal frames
        pg.evaluate('window.__vt.step(6000)')
        for _ in range(k): pg.evaluate('window.__vt.step(%f)' % (1000.0 / FPS))

    t0 = time.time()
    if 'takeoff' in SEGS:
        pg.evaluate("(() => { const S = window.__sim; S.startMission(S.MISSIONS.list[0], {}); const s = S.sim.s; s.flapIdx = 2; s.flapDeg = 5; s.parkBrake = false; S.sim.inp.throttle = 1; S.cam.yaw = -0.62; S.cam.pitch = 0.09; S.cam.dist = 96; })()")
        print('takeoff: rolled for', pg.evaluate(FAST, {'until': 'sim.d.ias * 1.943844 > 132', 'max': 60}))
        settle()
        gear = False
        for i in range(int(8.5 * FPS)):
            st = pg.evaluate(STATE)
            key('s', st['ias'] > 150 and st['pitch'] < (9.0 if st['gnd'] else 11.5))
            key('w', st['pitch'] > 14.5)
            if st['agl'] > 45 and not gear: pg.keyboard.press('g'); gear = True
            pg.evaluate("(() => { const c = window.__sim.cam; c.yaw += 0.0045; c.pitch += 0.0004; })()")
            frame('a')
        key('s', False); key('w', False)
        print('takeoff done', round(time.time() - t0), 's')
    if 'dusk' in SEGS:
        pg.evaluate("(() => { const S = window.__sim; S.startMission(S.MISSIONS.list[6], { ap: 'HLB', recip: false, wx: 'scattered', time: 17.55 }); const sim = S.sim; sim.placeInAir({ n: 9000, e: 21500, alt: 1100, hdg: 27, ias: 92, gear: true, flapIdx: 5, ap: true }); S.setCam('free', true); S.cam.freeYaw = 2.05; S.cam.freePitch = 0.10; S.cam.freeDist = 84; })()")
        print('dusk: settled for', pg.evaluate(FAST, {'until': 'sim.s.t > 6', 'max': 10}))
        settle()
        for i in range(int(5.5 * FPS)):
            pg.evaluate("(() => { const c = window.__sim.cam; c.freeYaw += 0.0052; c.freeDist += 0.05; })()")
            frame('b')
        print('dusk done', round(time.time() - t0), 's')
    if 'storm' in SEGS:
        pg.evaluate("(() => { const S = window.__sim; S.startMission(S.MISSIONS.list[2], {}); })()")
        print('storm: flew for', pg.evaluate(FAST, {'until': 'sim.s.pos[1] > -50150', 'max': 120}))
        settle()
        for i in range(int(6.5 * FPS)):
            frame('c')
        print('storm done', round(time.time() - t0), 's')
    if 'ils' in SEGS:
        pg.evaluate("(() => { const S = window.__sim; S.startMission(S.MISSIONS.list[5], {}); S.action('app'); })()")
        print('ils: intercept', pg.evaluate(FAST, {'until': 'sim.ap.gsCap', 'max': 400}))
        pg.evaluate("(() => { const S = window.__sim, s = S.sim.s; s.gearTarget = 1; s.flapIdx = 6; S.sim.ap.spd = 145 / 1.943844; })()")
        print('ils: descent', pg.evaluate(FAST, {'until': 'sim.d.agl * 3.28084 < 215', 'max': 400}))
        settle()
        after = 0
        for i in range(int(20 * FPS)):
            st = pg.evaluate(STATE)
            if st['touched']:
                key('Space', True); after += 1
                if after > int(2.2 * FPS): break
            frame('d')
        key('Space', False)
        print('ils done', round(time.time() - t0), 's')
    print('frames', n[0], 'in', OUT)
    b.close()
