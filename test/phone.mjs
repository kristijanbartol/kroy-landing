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

console.log('\n== behaviour, on one phone ==');

/* 3. IT REPLAYS. The sweep runs in the first seconds, when a phone reader is
 * still on the headline, so scrolling back to the figure has to play it again. */
let p = await open({ ...devices['iPhone 13'] }, 'replay');
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

/* 5. REDUCE MOTION. Skipped deliberately, and it has to park somewhere that
 * still makes the page's point. Ask before debugging a still phone. */
p = await open({ ...devices['iPhone 13'], reducedMotion: 'reduce' }, 'reduce');
await p.waitForTimeout(1800);
const r5 = await rd(p);
ok('reduce-motion parks on the argued body', r5.thigh.startsWith(REST_THIGH) && r5.at > 0.9,
  JSON.stringify(r5));
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
