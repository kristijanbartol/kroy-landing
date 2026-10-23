/* The phone check. Run it before believing anything about this page on a phone.
 *
 * WHY THIS FILE EXISTS. The opening sweep failed on an iPhone and worked on
 * every laptop, and it was "fixed" twice without ever being reproduced, because
 * there was no way to run the page in the engine that was failing. Resizing a
 * Chrome window is not a phone: it gives a different viewport from the one it
 * says, it is a different rendering engine from the one Safari uses, and the
 * extension's synthetic mouse drag does not deliver pointer events at all.
 *
 * Playwright's WebKit is the same engine family as Mobile Safari, and its
 * device descriptors give a real narrow viewport, a touch pointer and a device
 * pixel ratio of 3. It does not reproduce iOS memory limits, so it cannot
 * settle "did the sprite sheet decode on the device"; the page's own `?debug`
 * panel answers that one, from the device.
 *
 *   npm i -D playwright && npx playwright install webkit
 *   python3 -m http.server 8899      # from the repo root
 *   node test/phone.mjs
 *
 * Anything printed FAIL is the page, not the harness, until proven otherwise.
 */
import { webkit, devices } from 'playwright';

const URL = process.env.PAGE || 'http://127.0.0.1:8899/';
const PHONES = ['iPhone SE', 'iPhone 13', 'iPhone 13 Pro Max'];
const REST_THIGH = '51.6';      // the body the hero argument is about

const fails = [];
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) fails.push(name);
};

const b = await webkit.launch();
const open = async (o = {}, tag = '') => {
  const ctx = await b.newContext(o);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => fails.push(`${tag} pageerror: ${e.message}`));
  // A fresh query per page, or three iframes and two contexts share one cached
  // stylesheet and an edit appears to have done nothing.
  await p.goto(URL + '?v=' + Date.now(), { waitUntil: 'load' });
  return p;
};
const rd = (p, sel = '#strip-cohort') => p.evaluate((s) => {
  const r = document.querySelector(s);
  return {
    live: r.querySelector('[data-live]').textContent,
    thigh: (r.querySelector('[data-live="thigh"]') || { textContent: '' }).textContent,
    at: +(r.querySelector('.strip-rail').style.getPropertyValue('--at') || 0),
  };
}, sel);
/* The opening's state, asked of the page rather than inferred from a
 * screenshot: whether a video was built at all, whether it is playing, and how
 * far through it is. `null` means the canvas is doing the opening. */
const vid = (p) => p.evaluate(() => {
  const v = document.querySelector('#strip-cohort video');
  return v && { on: v.classList.contains('on'), t: +v.currentTime.toFixed(2),
    paused: v.paused, ready: v.readyState };
});
/* What the CANVAS is holding, which is the only way to tell a handover that
 * drew from one that left the first body of the cohort sitting there. */
const painted = (p) => p.evaluate(() =>
  document.querySelector('#strip-cohort .strip-canvas').toDataURL().slice(-96));
const press = (p, dx = 0) => p.evaluate((d) => {
  const c = document.querySelector('#strip-cohort .strip-canvas');
  const b = c.getBoundingClientRect();
  const [x, y] = [b.left + b.width / 2, b.top + b.height / 2];
  const el = document.elementFromPoint(x, y);
  const mk = (type, X) => el.dispatchEvent(new PointerEvent(type, {
    pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true,
    cancelable: true, clientX: X, clientY: y }));
  mk('pointerdown', x);
  if (d) { for (let i = 1; i <= 12; i++) mk('pointermove', x + d * i / 12); mk('pointerup', x + d); }
  return el.tagName;
}, dx);

const toFigure = (p, sec) => p.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return false;
  const fig = el.querySelector('.strip-stage') || el;
  scrollTo({ top: fig.getBoundingClientRect().top + scrollY - 30, behavior: 'instant' });
  return true;
}, sec);

/* 1. THE SWEEP, on every phone, and the hero's one without scrolling at all.
 * This is the original complaint: the page opens and nothing moves. */
for (const dev of PHONES) {
  const p = await open({ ...devices[dev] }, dev);
  const vp = p.viewportSize();
  console.log(`\n== ${dev}  ${vp.width}x${vp.height} ==`);
  await p.waitForTimeout(3000);
  const mid = await rd(p);
  ok(`${dev}: the hero sweeps with no scrolling`, mid.at > 0.05 && mid.at < 0.98,
    `--at=${mid.at.toFixed(3)} ${mid.thigh}`);
  await p.waitForTimeout(6000);
  ok(`${dev}: it rests on the argued body`, (await rd(p)).thigh.startsWith(REST_THIGH));

  for (const [sec, id] of [['#material', '#strip-material'], ['#seated', '#strip-seated']]) {
    if (!(await toFigure(p, sec))) { ok(`${dev}: ${sec} is on the page`, false); continue; }
    await p.waitForTimeout(1200);
    const a = await rd(p, id);
    await p.waitForTimeout(2400);
    const c = await rd(p, id);
    ok(`${dev}: ${sec} sweeps when reached`, a.live !== c.live, `${a.live} -> ${c.live}`);
  }

  ok(`${dev}: the page does not scroll sideways`,
    !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));

  /* 2. NOTHING IS LEFT HIDDEN. `.reveal` starts at zero opacity, so a trigger
   * that does not fire costs a section, not a fade. */
  const h = await p.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 300) {
    await p.evaluate((t) => scrollTo({ top: t, behavior: 'instant' }), y);
    await p.waitForTimeout(80);
  }
  await p.waitForTimeout(800);
  const left = await p.evaluate(() => ({
    hidden: [...document.querySelectorAll('.reveal:not(.in)')].map((e) => e.className),
    zero: [...document.querySelectorAll('.track i')].filter((i) => !i.style.width).length,
  }));
  ok(`${dev}: every section was revealed`, left.hidden.length === 0, left.hidden.join(' | '));
  ok(`${dev}: every bar got its width`, left.zero === 0, `${left.zero} still at 0`);
  await p.context().close();
}

console.log('\n== the opening, which is a video ==');

/* 2b. THE OPENING IS A VIDEO NOW, and these are the properties that make the
 * swap invisible. The canvas sweep it replaced was 31.2 MB of resident sprite
 * sheet upscaled 6.8x at hero size, which is the thing that killed this on an
 * iPhone twice; a video is hardware decoded. What has to hold:
 *
 *   it actually plays, which an autoplay policy can refuse;
 *   the RAIL AND THE READOUT follow it, because the readout is the argument
 *     and a thigh measurement parked at an em-dash says nothing;
 *   when it ends the CANVAS is what the reader is looking at, drawn, at the
 *     argued body, so the still they study for ten seconds is full resolution
 *     and not a crf-26 frame. */
let p = await open({ ...devices['iPhone 13'] }, 'video');
const codec = await p.evaluate(() => document.createElement('video').canPlayType('video/mp4'));
await p.waitForTimeout(2600);
const v1 = await vid(p);
ok('the opening plays as a video', !!(v1 && v1.on && !v1.paused && v1.t > 0.5),
  `canPlayType "${codec}" ${JSON.stringify(v1)}`);
const mid1 = await rd(p);
ok('the rail and the readout follow the video',
  mid1.at > 0.05 && mid1.at < 0.9 && /cm$/.test(mid1.thigh), `--at=${mid1.at.toFixed(3)} ${mid1.thigh}`);
const frame0 = await painted(p);
await p.waitForTimeout(6000);
const v2 = await vid(p);
const end1 = await rd(p);
ok('it ends, and the video gets out of the way', !!(v2 && v2.paused && !v2.on),
  JSON.stringify(v2));
ok('the canvas is what is left, drawn at the argued body',
  (await painted(p)) !== frame0 && end1.thigh.startsWith(REST_THIGH), end1.thigh);

/* AND THE SWAP DOES NOT CHANGE COLOUR, which no other check here can see and
 * which was wrong when the video was first built. An untagged yuv420p file
 * leaves the decoder to guess the matrix: Safari guesses BT.709 for anything
 * this tall, ffmpeg had converted with BT.601, and the red thigh arrived 21
 * levels hotter in R and 17 in G than the webp the canvas hands to. On the one
 * saturated colour the page owns, that reads as a flinch at the handover. Both
 * pictures are the same body at the same position here, so anything but a
 * compression difference between them is a fault. Fixed in
 * `scripts/hero_video.py`, which now converts AND tags; this is what holds it. */
const swap = await p.evaluate(() => {
  const r = document.querySelector('#strip-cohort');
  const c = r.querySelector('.strip-canvas');
  const k = document.createElement('canvas');
  [k.width, k.height] = [c.width, c.height];
  k.getContext('2d').drawImage(r.querySelector('video'), 0, 0, k.width, k.height);
  const A = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const B = k.getContext('2d').getImageData(0, 0, k.width, k.height).data;
  const d = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < A.length; i += 4) {
    if (!(A[i] > 140 && A[i + 1] < 90 && A[i + 2] < 90)) continue;   // the red
    n++;
    for (let j = 0; j < 3; j++) d[j] += B[i + j] - A[i + j];
  }
  return { n, d: d.map((x) => +(x / Math.max(n, 1)).toFixed(1)) };
});
ok('the video and the canvas are the same red', swap.n > 2000
  && Math.max(...swap.d.map(Math.abs)) < 12,
  `video minus canvas over ${swap.n} red px: ${swap.d.join(', ')}`);
await p.context().close();

/* 2c. A HAND ARRIVING MID-SWEEP. The reader always wins, and they win AT THE
 * BODY THEY WERE LOOKING AT: the video drives the strip's position frame by
 * frame, so the canvas can take over at any instant without the figure
 * jumping. A press used to be ignored until the first move, which on a hero
 * means the picture walks out from under a finger holding it still. */
p = await open({ ...devices['iPhone 13'] }, 'handover');
await p.waitForTimeout(2800);
// This page's OWN undrawn canvas, so the comparison below cannot pass by two
// pages happening to differ.
const still = await painted(p);
const was = await rd(p);
const hit = await press(p);
await p.waitForTimeout(900);
const now = await rd(p);
ok('a press mid-sweep stops the video there', Math.abs(now.at - was.at) < 0.02,
  `pressed ${hit}: ${was.at.toFixed(3)} -> ${now.at.toFixed(3)}`);
ok('and the video is gone with it', (await vid(p)) === null);
ok('and the canvas drew the body it stopped on', (await painted(p)) !== still);
await p.context().close();

/* 2d. NO VIDEO TO BE HAD. A 404, a browser with no decoder for it, a phone
 * that refuses an autoplay in Low Power Mode: the opening falls back to the
 * canvas sweep, which is all this page had until 2026-10-23 and which is
 * tested everywhere above. Driven here by refusing the request, so the
 * fallback path runs rather than being reasoned about. */
const nctx = await b.newContext({ ...devices['iPhone 13'] });
const np = await nctx.newPage();
np.on('pageerror', (e) => fails.push('no-video pageerror: ' + e.message));
await np.route('**/sweep.mp4', (r) => r.abort());
await np.goto(URL + '?v=' + Date.now(), { waitUntil: 'load' });
await np.waitForTimeout(3000);
const nf = await rd(np);
ok('with no video, the canvas sweeps instead', nf.at > 0.05 && nf.at < 0.98,
  `--at=${nf.at.toFixed(3)}`);
await np.waitForTimeout(6500);
ok('and it still rests on the argued body', (await rd(np)).thigh.startsWith(REST_THIGH));
ok('and nothing is left of the video', (await vid(np)) === null);
await nctx.close();

console.log('\n== behaviour, on one phone ==');

/* 3. IT REPLAYS. The sweep runs in the first seconds, when a phone reader is
 * still on the headline, so scrolling back to the figure has to play it again. */
p = await open({ ...devices['iPhone 13'] }, 'replay');
await p.waitForTimeout(8200);
await p.evaluate(() => scrollTo({ top: 3000, behavior: 'instant' }));
await p.waitForTimeout(700);
await p.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
await p.waitForTimeout(1700);
ok('it replays on coming back to it', (await rd(p)).at < 0.6, `--at=${(await rd(p)).at.toFixed(3)}`);
await p.waitForTimeout(7000);
ok('the replay finishes too', (await rd(p)).thigh.startsWith(REST_THIGH));
await p.context().close();

/* 4. A THUMB ON THE FIGURE. Horizontal scrubs, vertical scrolls the page, and
 * once a hand has moved it nothing animates it again. The events have to be
 * real PointerEvents: a synthetic mouse drag drives none of this. */
p = await open({ ...devices['iPhone 13'] }, 'touch');
await p.waitForTimeout(8200);
const box = await p.locator('#strip-cohort .strip-canvas').boundingBox();
const [cx, cy] = [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)];
const before = await rd(p);
await p.evaluate(([x, y, dx]) => {
  const el = document.elementFromPoint(x, y);
  const mk = (type, X) => el.dispatchEvent(new PointerEvent(type, {
    pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true,
    clientX: X, clientY: y }));
  mk('pointerdown', x);
  for (let i = 1; i <= 12; i++) mk('pointermove', x + dx * i / 12);
  mk('pointerup', x + dx);
}, [cx, cy, -140]);
const after = await rd(p);
ok('a horizontal drag on the figure scrubs', Math.abs(after.at - before.at) > 0.05,
  `${before.at.toFixed(3)} -> ${after.at.toFixed(3)}`);
ok('the figure lets a vertical swipe scroll the page',
  (await p.evaluate(() => getComputedStyle(document.querySelector('.strip-canvas')).touchAction)) === 'pan-y');
await p.waitForTimeout(2500);
ok('a strip a hand has moved stays where it was left',
  Math.abs((await rd(p)).at - after.at) < 0.002);
await p.context().close();

/* 4b. THE CLOCK, which is what "there might be an animation but it is way too
 * fast to notice" turned out to be. The sweep used to read `performance.now()`
 * before its first frame and then measure against the frame timestamps. Those
 * two agree only while the browser is painting, and a phone stops painting
 * routinely: while a freshly opened page settles, during a scroll Safari is
 * handling itself, while the tab is not frontmost, across a sleeping screen.
 * When frames resume the first timestamp is seconds past the reading, the sweep
 * computes that it is already over, and the strip crosses the whole cohort in
 * ONE frame. Modelled here in its minimal form: frames stamped ahead of
 * `performance.now()`. Before the fix this printed one moved sample out of
 * twenty-three. */
/* Run against BOTH things that can play the opening. The video is driven by
 * its own `currentTime` and so cannot be hurried by a skewed frame clock at
 * all, which is the improvement, asserted rather than assumed. The canvas is
 * still the fallback on any phone that refuses the autoplay, so the clock fix
 * it needed is still the thing this started out testing. */
for (const [skew, canvasOnly] of [[3000, false], [9000, false], [9000, true]]) {
  const c = await b.newContext({ ...devices['iPhone 13'] });
  const pp = await c.newPage();
  await pp.addInitScript((ms) => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (f) => raf((t) => f(t + ms));
  }, skew);
  if (canvasOnly) await pp.route('**/sweep.mp4', (r) => r.abort());
  await pp.goto(URL + '?v=' + Date.now(), { waitUntil: 'load' });
  const seen = [];
  for (let i = 0; i < 24; i++) {
    seen.push((await rd(pp)).at);
    await pp.waitForTimeout(450);
  }
  const moved = seen.filter((v, i) => i && Math.abs(v - seen[i - 1]) > 0.004).length;
  ok(`frames stamped ${skew} ms ahead, ${canvasOnly ? 'canvas' : 'video'}: `
    + 'the sweep is still watchable', moved >= 6,
    `${moved} of ${seen.length - 1} samples moved`);
  await c.close();
}

/* 5. REDUCE MOTION. Skipped deliberately, and it has to park somewhere that
 * still makes the page's point. Ask before debugging a still phone. */
p = await open({ ...devices['iPhone 13'], reducedMotion: 'reduce' }, 'reduce');
await p.waitForTimeout(1800);
const r5 = await rd(p);
ok('reduce-motion parks on the argued body', r5.thigh.startsWith(REST_THIGH) && r5.at > 0.9,
  JSON.stringify(r5));
// And asks for no video at all. A reader who turned motion down should not be
// sent 1.6 MB of it, and `videoOpening` returns null before building anything.
ok('reduce-motion builds no video', (await vid(p)) === null);
await p.context().close();

/* 6. `?debug`, which is the only instrument that reaches the actual device. */
const ctx = await b.newContext({ ...devices['iPhone 13'] });
p = await ctx.newPage();
await p.goto(URL + '?debug&v=' + Date.now(), { waitUntil: 'load' });
await p.waitForTimeout(1500);
const txt = await p.locator('#dbg').innerText();
ok('the debug panel reports', /reduce-motion/.test(txt) && /px/.test(txt));
console.log(txt.split('\n').map((l) => '     ' + l).join('\n'));
await ctx.close();

/* 7. And the laptop, which is what all of this must not have broken. */
console.log('\n== laptop ==');
const dctx = await b.newContext({ viewport: { width: 1440, height: 800 } });
const dp = await dctx.newPage();
dp.on('pageerror', (e) => fails.push('laptop pageerror: ' + e.message));
await dp.goto(URL + '?v=' + Date.now(), { waitUntil: 'load' });
await dp.waitForTimeout(3000);
const d = await rd(dp);
ok('the laptop sweeps too', d.at > 0.05 && d.at < 0.98, `--at=${d.at.toFixed(3)}`);
await dctx.close();

console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join('; ')}` : '\nall checks passed');
await b.close();
process.exit(fails.length ? 1 : 0);
