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
  bind() {
    const grab = (e) => {
      // The picture is draggable too, not only the rail. A control you can
      // only reach by its handle reads as a decoration with a handle.
      this.dragging = true;
      this.rail.setPointerCapture?.(e.pointerId);
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
      this.canvas.setPointerCapture?.(e.pointerId);
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
  /* A strip nobody drags is a still. It sweeps itself once when it first comes
   * into view, which says "this moves" without a caption saying it, then stops
   * and leaves the handle where the argument is. Any input cancels it. */
  armAuto() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.set(this.cfg.rest ?? 0);
      return;
    }
    const io = new IntersectionObserver((es) => {
      es.forEach((en) => {
        if (!en.isIntersecting || this.auto || this.played) return;
        this.played = true;
        io.disconnect();
        this.playAuto();
      });
    }, { threshold: 0.4 });
    io.observe(this.root);
  }

  playAuto() {
    const rest = this.cfg.rest ?? this.n - 1;
    const t0 = performance.now();
    const ms = 5600;
    const tick = (t) => {
      const u = Math.min(1, (t - t0) / ms);
      // Ease out, so it arrives at the argument rather than stopping dead on it.
      const e = 1 - Math.pow(1 - u, 3);
      this.set(e * rest);
      if (u < 1) this.auto = requestAnimationFrame(tick);
      else { this.auto = null; this.want(this.i); }
    };
    this.auto = requestAnimationFrame(tick);
  }

  stopAuto() {
    if (this.auto) { cancelAnimationFrame(this.auto); this.auto = null; }
    this.played = true;
  }
}
