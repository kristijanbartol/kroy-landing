/* A strip the viewer drags: one canvas, one sprite sheet, one full-res frame.
 *
 * WHY THE INTERACTION IS NOT A VIDEO. The cohort strip exists to answer "you
 * picked two bodies that suit you". A video of 144 bodies is still something we
 * authored and the viewer has to take on faith. A strip they drag lets them
 * CHECK, including on the bodies we would least want them to stop on.
 *
 * THE OPENING, HOWEVER, IS ONE, on the hero and nowhere else. Amended
 * 2026-10-23. What a reader watches before they touch anything is ours to
 * choose, and at hero size the scrub sheet cannot carry it: see `videoOpening`
 * at the foot of this file for the number that decided it. Nothing about the
 * interaction changed, and the video hands over to this canvas the moment a
 * hand arrives or the sweep is done.
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

/* THE OPENING'S CHOREOGRAPHY, in one place because two things now play it: the
 * canvas, in `playAuto` below, and the video `scripts/hero_video.py` bakes for
 * the hero out of these same three numbers. That script names them and says
 * where they live; if they move here, move them there, or the two will show
 * different pictures at the same position.
 *
 * Smoothstep across the WHOLE rail, so the reddest body is actually reached; a
 * beat on it; then back to the body the rest of the page is about. Why it is
 * not an ease-out, which is what it used to be, is in `playAuto`.
 */
const OUT_MS = 5400, HOLD_MS = 700, BACK_MS = 1200;
export const OPENING_MS = OUT_MS + HOLD_MS + BACK_MS;
const smooth = (u) => u * u * (3 - 2 * u);

export function openingAt(ms, end, rest) {
  if (ms < OUT_MS) return smooth(ms / OUT_MS) * end;
  if (ms < OUT_MS + HOLD_MS) return end;
  return end + (rest - end) * smooth(Math.min(1, (ms - OUT_MS - HOLD_MS) / BACK_MS));
}

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
    // What plays the opening, if it is not this canvas. `videoOpening` builds
    // one; null means the canvas sweeps itself, as it always did.
    this.opening = opts.opening || null;
    this.playing = false;
    this.stopOpening = null;

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
    this.mark();
    clearTimeout(this.settle);
    this.settle = setTimeout(() => {
      // Land on the body, not between two of them.
      this.f = this.i;
      this.mark();
      this.draw();
      this.want(this.i);
    }, SETTLE_MS);
  }

  /* The rail and the number beside it: the two things that have to agree with
   * the picture whoever is painting it. */
  mark() {
    if (!this.rail) return;
    this.rail.style.setProperty('--at', (this.n < 2 ? 0 : this.f / (this.n - 1)));
    this.rail.setAttribute('aria-valuenow', this.i);
  }

  /* Position without drawing, for when something else is painting: the hero's
   * opening is a video laid over this canvas, and the rail and the readout
   * still have to follow it, because THE READOUT IS THE ARGUMENT. A thigh
   * measurement that sits at an em-dash while the figure changes shape says
   * nothing. What is skipped is the blit, which underneath an opaque element
   * would sample a 31 MB sheet sixty times a second for nobody, competing with
   * the decoder for the one thing a phone is short of.
   *
   * No settle timer either: settling is what fetches a full-res frame, and the
   * frame worth fetching during an opening is the one it ENDS on. */
  follow(f) {
    f = Math.min(this.n - 1, Math.max(0, f));
    this.f = f;
    const i = Math.round(f);
    const changed = i !== this.i;
    this.i = i;
    if (changed || !this.toldOnce) { this.onIndex(i, this.cfg.positions[i]); this.toldOnce = true; }
    this.mark();
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
      // THE PRESS CLAIMS IT, not the first move. A thumb held on the figure
      // used to leave the opening running underneath it, which on the hero
      // means the picture walks out from under a finger that is holding it
      // still. `set` with `fromUser` is also the one path that stops a video.
      this.set(this.f, true);
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
      if (this.done || this.auto || this.playing || this.arming) return;
      if (document.visibilityState !== 'visible' || !this.enough()) return;
      this.arming = setTimeout(() => {
        this.arming = null;
        if (this.userOwns || this.done || this.auto || this.playing) return;
        if (document.visibilityState !== 'visible' || !this.enough()) return;
        this.done = true;
        this.startOpening();
      }, ARM_MS);
    };
    watchers.add(this.check);
    this.check();
  }

  /* WHAT plays the opening, which is the only part of this the hero changes.
   * Everything about WHEN stays in `armAuto` above: every rule there was
   * learned on a phone, and not one of them cares what is doing the painting.
   */
  startOpening() {
    if (!this.opening) { this.playAuto(); return; }
    this.playing = true;
    this.stopOpening = this.opening(this);
  }

  /* Played to its end, and the strip is resting on the argued body. */
  openingEnded() {
    this.playing = false;
    this.stopOpening = null;
  }

  /* It could not play at all: no decoder for it, the file is not there, or an
   * autoplay the browser refused, which iOS does in Low Power Mode however
   * muted the video is. Fall back to the canvas sweep for the rest of the
   * visit, and run it NOW, because the figure is on screen and armed and
   * nobody should be left looking at a still while we think about it. */
  openingFailed(why) {
    // RECORDED, because this is the one state that cannot be reproduced off
    // the device: Low Power Mode refuses an autoplay and leaves no trace. The
    // `?debug` panel prints it.
    this.noVideo = why || 'failed';
    this.opening = null;
    this.playing = false;
    this.stopOpening = null;
    this.playAuto();
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
      this.set(openingAt(ms, end, rest));
      this.ticks = (this.ticks || 0) + 1;
      if (ms < OPENING_MS) this.auto = requestAnimationFrame(tick);
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
    // Whatever else was playing the opening hands the position back here.
    if (this.stopOpening) { this.stopOpening(); this.stopOpening = null; this.playing = false; }
    // The reader's hand outranks the demonstration, permanently.
    this.userOwns = true;
    this.done = true;
  }
}

/* ---- the opening as a video, which is the hero's and nothing else's ------
 *
 * The canvas sweeps for free, so this exists for exactly one reason: RESIDENT
 * PIXELS. The scrub sheet is decoded whole, so its cells are 132 x 411 and the
 * sheet costs 31.2 MB in memory however small the file was. At the figure's
 * old size that is a 2.5x upscale and invisible under motion. At hero size it
 * is 6.8x and it is mush, and a cell big enough to fill a phone would cost 50
 * to 60 MB, which is the failure that killed this sweep on an iPhone twice. A
 * video is hardware decoded and costs almost nothing resident, so the opening
 * became one, 1.6 MB on the wire, and the thumb kept the canvas.
 *
 * THE HANDOVER IS THE POINT, and it is why this drives the rail off the
 * video's own clock through `openingAt` instead of just letting it play. The
 * strip's position is always the position the video is showing, so a reader can
 * take it away at any instant and get the frame they were looking at, in full
 * resolution, with that body's own numbers beside it.
 *
 * THE FILE NAME IS A CONVENTION AND NOT A MANIFEST FACT, deliberately.
 * `scripts/hero_video.py` writes `demo/<id>/sweep.mp4`, and `build_page.py`
 * rebuilds each strip's manifest entry from scratch, so a key the video script
 * added would be dropped by the next page build without anyone noticing. The
 * page's rule is that no NUMBER is typed, and a file name is not a number: if
 * the file is absent the `error` path below falls back to the canvas sweep,
 * and `test/phone.mjs` runs that path by refusing the request.
 *
 * Returns null when there is no video to be had, and the strip then sweeps its
 * canvas exactly as it did before any of this existed.
 */
export function videoOpening(root, cfg, base = 'demo/') {
  // Reduce Motion gets no video and no download. `armAuto` has its own branch
  // for it, which parks on the argued body, and that is still the behaviour.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const v = document.createElement('video');
  if (!v.canPlayType('video/mp4')) return null;

  // Muted as a property AND as an attribute: iOS has refused to autoplay a
  // video muted only by property, and the attribute costs nothing to add.
  v.muted = true;
  v.defaultMuted = true;
  v.setAttribute('muted', '');
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.preload = 'auto';
  v.className = 'strip-video';
  // The poster is the frame the canvas downloads anyway, so the picture behind
  // a video that has not started is real and costs nothing. It matters on a
  // slow connection, where it is what a reader looks at while 1.6 MB arrives.
  v.poster = base + cfg.frame.replace('%04d', '0000');
  v.src = base + cfg.id + '/sweep.mp4';
  root.querySelector('.strip-stage').appendChild(v);

  // An element built at page load but asked to play much later, so a load
  // failure lands long before anyone wants it. It takes itself off the page
  // when it does: a video that will never play is dead weight over the canvas,
  // and `test/phone.mjs` refuses the request on purpose to check that.
  let broken = false;
  v.addEventListener('error', () => { broken = true; v.remove(); });

  return (strip) => {
    if (broken) { strip.openingFailed('no file'); return null; }
    const end = strip.n - 1;
    const rest = Math.min(end, strip.cfg.rest ?? end);
    let live = true, raf = 0;

    // Warmed NOW and not at the end: the frame the reader stops on is the one
    // they look at for ten seconds, and it should be the full-res webp from
    // the moment the video gets out of the way. 50 KB, during a 7 s video.
    strip.want(rest);

    /* MEASURED THE SAME WAY THE CANVAS SWEEP IS, in the fields `?debug` already
     * prints: how many openings have played, how much of one has, over how
     * many frames, against the wall clock. That panel is the only instrument
     * that reaches a real phone, and it would otherwise report "never swept"
     * about a video it could see playing. */
    const w0 = Date.now();
    strip.sweeps = (strip.sweeps || 0) + 1;
    strip.ticks = 0;

    const clock = () => { if (raf) cancelAnimationFrame(raf); raf = 0; live = false; };
    const hide = () => { v.classList.remove('on'); v.pause(); };

    const tick = () => {
      if (!live) return;
      strip.swept = v.currentTime * 1000;
      strip.ticks++;
      strip.follow(openingAt(strip.swept, end, rest));
      raf = requestAnimationFrame(tick);
    };

    // Draw before hiding, always, or the swap shows one frame of whatever the
    // canvas was left holding, which is the first body in the cohort.
    const ended = () => {
      if (!live) return;
      clock();
      strip.wall = Date.now() - w0;
      strip.set(rest);
      strip.want(rest);
      hide();
      strip.openingEnded();
    };

    const failed = (why) => {
      if (!live) return;
      clock();
      hide();
      v.remove();
      strip.openingFailed(why);
    };

    v.addEventListener('ended', ended, { once: true });
    v.addEventListener('error', () => failed('decode error'), { once: true });
    v.currentTime = 0;                 // a replay is the same argument again
    v.classList.add('on');
    raf = requestAnimationFrame(tick);
    const p = v.play();
    // An autoplay the browser refuses rejects here. So does a pause issued
    // while a play is still pending, which is our own doing: `live` is already
    // false by then, so the refusal and the handover cannot be confused.
    if (p && p.catch) p.catch(() => failed('autoplay refused'));

    /* HOW THE READER TAKES IT AWAY. Hide the video and draw where the video
     * had got to, which `follow` has kept current to the frame. `stopAuto`
     * calls this, and `stopAuto` is what every path that claims the strip for
     * a hand already called, so not one input handler needed changing.
     *
     * The element goes with it: once a hand has moved the strip nothing
     * animates it again for the rest of the visit, so a buffered 1.6 MB video
     * is dead weight on the device least able to carry it. */
    return () => {
      clock();
      strip.draw();
      strip.want(strip.i);
      hide();
      v.remove();
    };
  };
}
