/* A strip the viewer drags: one canvas, one sprite sheet, one full-res frame.
 *
 * WHY NOT A VIDEO. The cohort strip exists to answer "you picked two bodies
 * that suit you". A video of 144 bodies is still something we authored and the
 * viewer has to take on faith. A strip they drag lets them CHECK, including on
 * the bodies we would least want them to stop on.
 *
 * THE BAR IS RANDOM ACCESS AT 60 fps, and it is why this does not reuse the
 * demo shell's player: that one buffers forward from a playhead, so a backwards
 * scrub is a decode. Here every position lives in one sprite sheet, decoded
 * once into an ImageBitmap, and moving is a drawImage out of it. There is no
 * decode on the input path at all, so there is nothing that can drop a frame
 * under a thumb.
 *
 * The cost of that is resolution: a sheet is resident pixels, and resident
 * pixels are width x height x 4 bytes whatever the encoder does. So the sheet
 * is a proxy and the full-res position is fetched when the drag SETTLES.
 * Motion hides softness; a parked frame is on screen for ten seconds and does
 * not. That is the honest answer to interaction raising per-frame scrutiny.
 */
'use strict';

const SETTLE_MS = 110;          // how long a hand has to stop before full res
const CACHE_MAX = 10;           // full-res frames held, in position order
// A decoded frame is width x height x 4 bytes whatever it cost to fetch, so
// the cache is small on purpose: 17 KB over the wire is 2.9 MB in memory.
const WATCHABLE_PX = 240;       // picture on screen before a sweep is worth it
const ARM_MS = 300;             // and how long it has to stay there
const PAUSE_MS = 250;           // a frame gap longer than this was not watched

/* WHY THE SWEEP IS TRIGGERED BY GEOMETRY WE MEASURE AND NOT BY AN
 * IntersectionObserver THRESHOLD. Twice the sweep has failed to run on a phone
 * while being perfect on a laptop, and both times the cause had the same
 * shape: an observer threshold is A FRACTION OF THE ELEMENT, and the question
 * actually being asked is "is enough of the picture on screen to watch", which
 * is a number of PIXELS. A fraction of a two-column strip 620 px tall and a
 * fraction of the same strip stacked to 1400 px on a phone are different
 * quantities wearing the same number, and when the phone's one turns out to be
 * unreachable nothing says so: there is no error, just a still picture.
 *
 * So the geometry is read directly, at most once per frame, and the condition
 * is written in the units of the thing it is about. The events below are every
 * way the answer can change, including the two that only exist on a phone:
 * `orientationchange`, and `pageshow`, which is how a tab Safari restored from
 * its page cache tells us it is back without running any of this file again. */
const watchers = new Set();
let ticking = false;
const pump = () => { ticking = false; watchers.forEach((f) => f()); };
const kick = () => { if (!ticking) { ticking = true; requestAnimationFrame(pump); } };
['scroll', 'resize', 'orientationchange', 'pageshow'].forEach((k) =>
  addEventListener(k, kick, { passive: true }));
addEventListener('visibilitychange', kick);

async function bitmaps(urls) {
  return Promise.all(urls.map(async (u) => {
    const r = await fetch(u);
    if (!r.ok) throw new Error(`${u}: ${r.status}`);
    return createImageBitmap(await r.blob());
  }));
}

export class Strip {
  /* root: the element holding .strip-canvas and .strip-rail.
   * cfg:  the strip's entry out of demo/data.json.
   * opts: {base, onIndex, start, autoplay}
   */
  constructor(root, cfg, opts = {}) {
    this.root = root;
    this.cfg = cfg;
    this.base = opts.base || 'demo/';
    this.onIndex = opts.onIndex || (() => {});
    this.n = cfg.n;
    this.i = Math.min(this.n - 1, Math.max(0, opts.start ?? 0));
    // `i` is a position, `f` is where the hand is between two of them. The
    // readout and the full-res frame always use `i`, because every position is
    // a real body and a number under a blend of two would belong to neither.
    this.f = this.i;
    this.blend = opts.blend !== false;
    this.canvas = root.querySelector('.strip-canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.rail = root.querySelector('.strip-rail');
    this.sheets = null;
    this.full = new Map();
    this.pending = null;
    this.settle = 0;
    this.dragging = false;
    this.auto = null;
    this.wantAuto = opts.autoplay !== false;

    this.resize();
    this.bind();
    new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement);

    // A strip below the fold does not pay for itself until it is near. Its
    // sheet is tens of megabytes once decoded, and a page with three of them
    // would hold all three before the reader had scrolled past the first.
    if (opts.defer) {
      const io = new IntersectionObserver((es) => {
        if (!es.some((e) => e.isIntersecting)) return;
        io.disconnect();
        this.load();
      }, { rootMargin: '500px' });
      io.observe(root);
    } else {
      this.load();
    }
  }

  /* The sheet is the whole interaction, so nothing is draggable until it is
   * decoded. A control that accepts input it cannot answer feels broken in
   * exactly the way this is trying to avoid. */
  load() {
    if (this.sheets || this.loading) return;
    this.loading = true;
    bitmaps(this.cfg.sheet.files.map((f) => this.base + this.cfg.id + '/' + f))
      .then((bm) => {
        this.sheets = bm;
        this.root.classList.add('ready');
        this.set(this.i);
        this.want(this.i);
        if (this.wantAuto) this.armAuto();
      })
      .catch((e) => {
        // A page that quietly shows nothing is worse than one that says so.
        this.root.classList.add('failed');
        console.error('strip', this.cfg.id, e);
      });
  }

  /* -- geometry ------------------------------------------------------- */
  resize() {
    const box = this.canvas.parentElement.getBoundingClientRect();
    const [w, h] = this.cfg.size;
    // Fit the figure inside its slot without ever cropping it: cropping a
    // frame cuts data off it, and the red band near the hem is data.
    const scale = Math.min(box.width / w, box.height / h);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cw = Math.max(1, Math.round(w * scale));
    this.ch = Math.max(1, Math.round(h * scale));
    this.canvas.style.width = this.cw + 'px';
    this.canvas.style.height = this.ch + 'px';
    this.canvas.width = Math.round(this.cw * dpr);
    this.canvas.height = Math.round(this.ch * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.sheets) this.draw();
  }

  /* -- drawing -------------------------------------------------------- */
  cell(i) {
    const { cols, per_sheet: per, cell } = this.cfg.sheet;
    const s = Math.floor(i / per);
    const k = i % per;
    return [this.sheets[s], (k % cols) * cell[0],
      Math.floor(k / cols) * cell[1], cell[0], cell[1]];
  }

  blit(i) {
    const [sheet, sx, sy, sw, sh] = this.cell(i);
    this.ctx.drawImage(sheet, sx, sy, sw, sh, 0, 0, this.cw, this.ch);
  }

  /* WHY THIS CROSS-FADES. 144 positions across a 360 px rail is 2.5 px of hand
   * travel per body, and neighbouring bodies are not neighbouring PICTURES:
   * measured over the cohort, consecutive frames differ by about 9 grey levels
   * whatever order they are in, because the bodies genuinely differ. Snapping
   * from one to the next puts all of that into one step, which no amount of
   * moving your hand slowly can soften, and the eye reads it as a fault rather
   * than as a difference between two women.
   *
   * So the hand's position is continuous and the picture follows it: floor and
   * ceiling drawn with the fraction as alpha. While it moves this reads as
   * motion blur. It resolves the moment the hand stops, because `set` snaps
   * `f` to `i` on settle and the full-res frame lands there, so nobody is ever
   * left looking at a blend of two bodies with one body's numbers beside it. */
  draw() {
    if (!this.sheets) return;
    const g = this.ctx;
    g.imageSmoothingQuality = 'high';
    const hi = this.full.get(this.i);
    if (hi && Math.abs(this.f - this.i) < 0.001) {
      g.drawImage(hi, 0, 0, this.cw, this.ch);
      return;
    }
    const lo = Math.floor(this.f);
    const t = this.f - lo;
    if (!this.blend || t < 0.004 || lo + 1 >= this.n) {
      this.blit(Math.min(this.n - 1, Math.round(this.f)));
      return;
    }
    g.globalAlpha = 1;
    this.blit(lo);
    g.globalAlpha = t;
    this.blit(lo + 1);
    g.globalAlpha = 1;
  }

  /* Fetch the full-res position and swap it in if the hand is still there. */
  want(i) {
    if (this.full.has(i)) { this.draw(); return; }
    const url = this.base + this.cfg.frame.replace('%04d', String(i).padStart(4, '0'));
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    img.decode().then(() => {
      this.full.set(i, img);
      // Keep the frames nearest where the hand is; a scrub tends to come back.
      if (this.full.size > CACHE_MAX) {
        const far = [...this.full.keys()]
          .sort((a, b) => Math.abs(b - this.i) - Math.abs(a - this.i))[0];
        this.full.delete(far);
      }
      if (i === this.i && !this.dragging) this.draw();
    }).catch(() => {});
  }

  /* -- position ------------------------------------------------------- */
  set(f, fromUser) {
    f = Math.min(this.n - 1, Math.max(0, f));
    if (fromUser) this.stopAuto();
    const i = Math.round(f);
    const moved = f !== this.f;
    this.f = f;
    const changed = i !== this.i;
    this.i = i;
    if (moved || !this.drawnOnce) { this.draw(); this.drawnOnce = true; }
    if (changed || !this.toldOnce) { this.onIndex(i, this.cfg.positions[i]); this.toldOnce = true; }
    if (this.rail) {
      this.rail.style.setProperty('--at', (this.n < 2 ? 0 : f / (this.n - 1)));
      this.rail.setAttribute('aria-valuenow', i);
    }
    clearTimeout(this.settle);
    this.settle = setTimeout(() => {
      // Land on the body, not between two of them.
      this.f = this.i;
      if (this.rail) this.rail.style.setProperty('--at', (this.n < 2 ? 0 : this.f / (this.n - 1)));
      this.draw();
      this.want(this.i);
    }, SETTLE_MS);
  }

  fromClientX(x) {
    const r = this.rail.getBoundingClientRect();
    return ((x - r.left) / Math.max(r.width, 1)) * (this.n - 1);
  }

  /* -- input ---------------------------------------------------------- */
  /* Pointer capture is a nicety and it THROWS. `setPointerCapture` rejects an
   * id the browser no longer considers active, and an uncaught throw here takes
   * the rest of the handler with it: `dragFrom` never gets set and the figure
   * is simply not draggable, with nothing on screen to say why. It is worth
   * having and it is not worth the drag. */
  capture(el, id) {
    try { el.setPointerCapture?.(id); } catch (e) { /* not fatal, and not ours */ }
  }

  bind() {
    const grab = (e) => {
      // The picture is draggable too, not only the rail. A control you can
      // only reach by its handle reads as a decoration with a handle.
      this.dragging = true;
      this.capture(this.rail, e.pointerId);
      this.root.classList.add('dragging');
      this.set(this.fromClientX(e.clientX), true);
      e.preventDefault();
    };
    const move = (e) => {
      if (!this.dragging) return;
      this.set(this.fromClientX(e.clientX), true);
      e.preventDefault();
    };
    const drop = () => {
      if (!this.dragging) return;
      this.dragging = false;
      this.root.classList.remove('dragging');
      this.want(this.i);
    };
    this.rail.addEventListener('pointerdown', grab);
    this.rail.addEventListener('pointermove', move);
    this.rail.addEventListener('pointerup', drop);
    this.rail.addEventListener('pointercancel', drop);

    // Dragging on the figure moves by the same rule as dragging on the rail,
    // measured against the rail, so the two cannot disagree about position.
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.capture(this.canvas, e.pointerId);
      this.root.classList.add('dragging');
      this.dragFrom = [e.clientX, this.f];
      e.preventDefault();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging || !this.dragFrom) return;
      const r = this.rail.getBoundingClientRect();
      const d = (e.clientX - this.dragFrom[0]) / Math.max(r.width, 1) * (this.n - 1);
      this.set(this.dragFrom[1] + d, true);
      e.preventDefault();
    });
    ['pointerup', 'pointercancel'].forEach((k) =>
      this.canvas.addEventListener(k, () => { this.dragFrom = null; drop(); }));

    this.rail.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 10 : 1;
      const k = { ArrowLeft: -step, ArrowRight: step, ArrowDown: -step,
        ArrowUp: step, Home: -this.n, End: this.n }[e.key];
      if (k === undefined) return;
      this.set(Math.round(this.f) + k, true);
      e.preventDefault();
    });
  }

  /* -- the demonstration ---------------------------------------------- */
  /* A strip nobody drags is a still, so it sweeps itself to say "this moves"
   * without a caption saying it. Three things about WHEN, and every one of
   * them was learned on a phone after being got wrong on a laptop.
   *
   * IT IS NOT A ONE-SHOT ANY MORE. It used to play the first time the figure
   * was ever seen and then never again. On a laptop that moment is the page
   * opening, with the whole layout in one eyeful. On a phone the figure is
   * half the screen and the sweep runs in the first seconds while the reader
   * is still on the headline, so the page is a still for the rest of the
   * visit and reads as sliders nobody was told to drag. It now re-arms
   * whenever the figure has fully left the screen, so scrolling back to it
   * plays it again.
   *
   * A HAND BEATS IT FOR GOOD. Once the reader has dragged or picked a stop,
   * the position is theirs and nothing moves it on its own again.
   *
   * IT WAITS A BEAT after the figure arrives, and checks again when the beat
   * is up. A reader scrolling straight past should not spend the sweep on a
   * picture that is already leaving.
   */

  /* How much of the picture is on screen, and how much has to be. Both in
   * PIXELS and both from one place, so the debug panel cannot report a
   * different rule from the one the sweep applies. The requirement is capped at
   * the element's own height, so a short figure can still satisfy it, and it is
   * never a bare fraction, so it means the same thing on every screen. */
  watch() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    return {
      shown: Math.min(r.bottom, vh) - Math.max(r.top, 0),
      need: Math.min(WATCHABLE_PX, r.height * 0.6),
    };
  }

  enough() { const w = this.watch(); return w.shown >= w.need; }

  armAuto() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Skipped deliberately, and it lands on the body the argument is about
      // rather than on the first one, so the page still says something.
      this.set(this.cfg.rest ?? 0);
      this.reduced = true;
      return;
    }
    this.check = () => {
      if (this.userOwns) { watchers.delete(this.check); return; }
      if (this.watch().shown <= 0) {
        // Gone from the screen. Whatever it did while it was here, it may do
        // again when it comes back.
        this.done = false;
        if (this.arming) { clearTimeout(this.arming); this.arming = null; }
        return;
      }
      if (this.done || this.auto || this.arming) return;
      if (document.visibilityState !== 'visible' || !this.enough()) return;
      this.arming = setTimeout(() => {
        this.arming = null;
        if (this.userOwns || this.done || this.auto) return;
        if (document.visibilityState !== 'visible' || !this.enough()) return;
        this.done = true;
        this.playAuto();
      }, ARM_MS);
    };
    watchers.add(this.check);
    this.check();
  }

  /* THE OPENING SWEEP, and both of its timings were wrong for the same reason.
   *
   * It used to ease OUT over 5.6 s from 0 to the resting body, which front-
   * loads the travel: half the cohort went past in the first 1.1 s and 88 per
   * cent inside 2.8, leaving the last 2.8 s to crawl through a tenth of the
   * rail. And the only high-contrast event on the whole rail, the red arriving
   * where the thighs get big, lives in the LAST TENTH of the travel. So it ran
   * fast where there was nothing to see and slow where the thing to see was,
   * and it read as a flicker that might not have happened at all.
   *
   * Now: smoothstep, which is even through the middle and only eases at the
   * two ends, across the WHOLE rail so the reddest body is actually reached.
   * Then a beat, then back to the body the rest of the page is about. That
   * last move is not a flourish: it is the honest note, that a body near the
   * centre of the chart fails too, and by less.
   */
  playAuto() {
    const end = this.n - 1;
    const rest = Math.min(end, this.cfg.rest ?? end);
    const OUT = 5400, HOLD = 700, BACK = 1200;
    const smooth = (u) => u * u * (3 - 2 * u);
    // Every sweep starts from the beginning, so a replay is the same argument
    // and not a jump out of wherever the last one stopped.
    this.set(0);
    /* THE CLOCK IS THE PAINTED FRAMES AND NOTHING ELSE, and getting that wrong
     * is how a 7.3 second sweep becomes something a phone reader describes as
     * "too fast to notice". It used to read `performance.now()` here, BEFORE
     * the first frame, and measure against it. Those are two different clocks
     * in the only case that matters: a browser that is not painting does not
     * run rAF at all, and when it resumes the first timestamp can be seconds
     * past the reading. The sweep then computes that it is already over and
     * the strip snaps to the end in a single frame.
     *
     * A phone does this routinely and a laptop almost never: Safari suspends
     * frames while a freshly opened page settles, during a scroll it is
     * handling itself, while the tab is not frontmost, and across a screen
     * that slept. So elapsed time is counted only across frames that actually
     * happened, and a gap longer than a few of them is treated as the browser
     * having stopped rather than as time the reader spent watching. The sweep
     * resumes where it was instead of being consumed by a pause. */
    let t0 = null, prev = null;
    // Wall time as well as painted time, because the difference between the two
    // IS the diagnosis: 7.3 s of frames spread over 40 s of wall clock is a
    // browser that kept suspending us, and nothing else looks like that.
    const w0 = Date.now();
    const tick = (t) => {
      if (this.userOwns) { this.auto = null; return; }
      if (t0 === null) { t0 = t; prev = t; }
      if (t - prev > PAUSE_MS) t0 += t - prev;
      prev = t;
      const ms = t - t0;
      this.swept = ms;               // what ?debug reports, measured not assumed
      let at;
      if (ms < OUT) at = smooth(ms / OUT) * end;
      else if (ms < OUT + HOLD) at = end;
      else at = end + (rest - end) * smooth(Math.min(1, (ms - OUT - HOLD) / BACK));
      this.set(at);
      this.ticks = (this.ticks || 0) + 1;
      if (ms < OUT + HOLD + BACK) this.auto = requestAnimationFrame(tick);
      else {
        this.auto = null;
        this.wall = Date.now() - w0;
        this.set(rest);
        this.want(this.i);
      }
    };
    this.ticks = 0;
    this.sweeps = (this.sweeps || 0) + 1;
    this.auto = requestAnimationFrame(tick);
  }

  stopAuto() {
    if (this.auto) { cancelAnimationFrame(this.auto); this.auto = null; }
    if (this.arming) { clearTimeout(this.arming); this.arming = null; }
    // The reader's hand outranks the demonstration, permanently.
    this.userOwns = true;
    this.done = true;
  }
}
