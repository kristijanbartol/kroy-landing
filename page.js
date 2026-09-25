/* The page, wired to demo/data.json.
 *
 * NOTHING ON THIS PAGE IS TYPED. Every count, every centimetre and every
 * percentage is read out of data.json, which the fit engine writes with its
 * numbers re-derived at build time. A number on a website that drifts from the
 * engine is worse than no number, because the picture beside it is still right.
 *
 * THE CLAIM GUARD, which matters more here than anywhere in the demo. The
 * cohort is a set of bodies we BUILT inside one chart's size-M box. It is not a
 * sample of anyone's customers. A sentence on a website travels without its
 * picture, so a rate is never written on its own: every share is rendered as a
 * count out of the cohort, and the tally is in the markup beneath it.
 */
/* ONE VERSION STAMP AND THE WHOLE GRAPH FOLLOWS IT. `index.html` asks for
 * `page.js?v=N`; this file hands the same N to `strip.js`, so bumping the
 * number in ONE place moves every module to a URL no cache has ever seen.
 * Netlify already sends must-revalidate, so this is not what makes a reload
 * correct. It is what makes "the phone is still running the old file" a thing
 * nobody can spend an evening on again, which has already happened twice. */
const V = new URL(import.meta.url).search;
let Strip;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const dig = (o, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), o);

function fill(data) {
  $$('[data-n]').forEach((el) => {
    const v = dig(data, el.dataset.n);
    if (v !== undefined && v !== null) el.textContent = v;
  });
}

/* -- the pair table -------------------------------------------------- */
function pairTable(data) {
  const body = $('#pair-table tbody');
  const widest = Math.max(...data.pair.rows.map((r) => r.gap));
  body.innerHTML = data.pair.rows.map((r) => `
    <tr class="${r.gap === widest ? 'key' : ''}">
      <td>${r.name}${r.stated ? '' : ' <span class="states">not on the chart</span>'}</td>
      <td class="num">${r.a.toFixed(1)}</td>
      <td class="num">${r.b.toFixed(1)}</td>
      <td class="num">${r.gap.toFixed(1)}</td>
    </tr>`).join('');
}

/* -- the ranked bars -------------------------------------------------- */
function bars(data) {
  const rows = data.blind.rows;
  const max = Math.max(...rows.map((r) => Math.abs(r.difference_cm)));
  $('#bars').innerHTML = rows.map((r) => `
    <div class="bar ${r.stated ? 'pinned' : 'free'}">
      <div class="who">${r.name}<span>${r.stated ? 'on the chart' : 'not on the chart'}</span></div>
      <div class="track"><i data-w="${Math.max(1.5, Math.abs(r.difference_cm) / max * 100)}"></i></div>
      <div class="val">${r.difference_cm > 0 ? '+' : ''}${r.difference_cm.toFixed(1)} cm</div>
    </div>`).join('');
}

/* -- seated ----------------------------------------------------------- */
function seatedStats(data) {
  const n = data.poses['standing']['5'].n_bodies;
  const a = data.poses['standing']['5'];
  const b = data.poses['seated-90']['5'];
  const c = data.poses['seated-90']['10'];
  $('#seated-stats').innerHTML = `
    <div><b>${a.n_fail} of ${n}</b><span>cannot wear these standing, in a light stretch</span></div>
    <div><b style="color:var(--red)">${b.n_fail} of ${n}</b><span>cannot sit down in them. Same material, same bodies</span></div>
    <div><b>${c.n_fail} of ${n}</b><span>seated, in 10 percent elastane</span></div>`;
}

function seatedStrip(data) {
  const cfg = data.strips.seated;
  const root = $('#strip-seated');
  // The garment is asked for more at every step, so there is no threshold to
  // mark: the ticks carry the demand itself, reddening as she descends.
  const worst = Math.max(...cfg.positions.map((p) => p.over_capacity));
  $('.ticks', root).innerHTML = cfg.positions.map((p) =>
    `<i style="background:color-mix(in srgb, var(--red) ${
      Math.round(100 * p.over_capacity / worst)}%, var(--rail))"></i>`).join('');
  cfg.rest = cfg.n - 1;

  const hip = $('[data-live="hip"]', root);
  const over = $('[data-live="over"]', root);
  return new Strip(root, cfg, {
    start: 0,
    defer: true,
    // NO BLENDING HERE, and it is the opposite call from the cohort strip. On
    // that one the neighbours are two women of nearly the same height and a
    // blend registers almost exactly, so it reads as motion blur. Here the
    // neighbours are one woman five degrees apart, so a blend puts her knee in
    // two places at once, which reads as a soft render rather than as movement.
    blend: false,
    onIndex: (i, p) => {
      hip.textContent = p.hip_deg.toFixed(0) + '\u00b0';
      over.textContent = p.over_capacity < 0.05 ? 'none'
        : p.over_capacity.toFixed(1) + '%';
      over.style.color = p.over_capacity > 5 ? 'var(--red)' : 'var(--ink)';
    },
  });
}

/* -- the strips ------------------------------------------------------- */
function ticks(el, n, isBad) {
  el.innerHTML = Array.from({ length: n },
    (_, i) => `<i class="${isBad(i) ? 'bad' : ''}"></i>`).join('');
}

function cohortStrip(data) {
  const cfg = data.strips.cohort;
  const root = $('#strip-cohort');
  ticks($('.ticks', root), cfg.n, (i) => cfg.positions[i].fails);

  // It sweeps to the body the rest of the page is about, so the page follows
  // one woman: she is the second row of the pair table and she is the figure on
  // the fabric rail. Found by her number, never by an index somebody typed.
  // The bodies past her are redder, and that is the point of a strip you drag:
  // the viewer finds them, we do not perform them.
  cfg.rest = cfg.positions.findIndex((p) => p.body === data.pair.b);
  if (cfg.rest < 0) cfg.rest = cfg.positions.findIndex((p) => p.fails);
  if (cfg.rest < 0) cfg.rest = cfg.n - 1;

  const thigh = $('[data-live="thigh"]', root);
  const over = $('[data-live="over"]', root);
  const verdict = $('[data-live="verdict"]', root);
  return new Strip(root, cfg, {
    start: 0,
    onIndex: (i, p) => {
      thigh.textContent = p.thigh_cm.toFixed(1) + ' cm';
      over.textContent = p.over_capacity < 0.05 ? 'none'
        : p.over_capacity.toFixed(1) + '%';
      verdict.textContent = p.fails ? 'Cannot wear these' : 'Fits';
      verdict.dataset.fails = p.fails ? '1' : '0';
    },
  });
}

function fabricStrip(data) {
  // The strip is `fabric` to the engine and `material` on the page. The engine
  // name is the parameter it actually sweeps, how far a yarn may stretch; the
  // page name is the word a brand uses for the thing they buy. Renaming the
  // engine's would mean re-rendering 81 frames to change a word.
  const cfg = data.strips.fabric;
  const root = $('#strip-material');
  // A tick per position, red while any body still cannot wear the garment, so
  // the rail shows where the problem ends before anybody drags it.
  ticks($('.ticks', root), cfg.n, (i) => cfg.positions[i].n_fail > 0);

  // Rest on the stable woven: the cloth a fitted trouser of this cut is
  // actually made of, and the one the hero section is counted at.
  const at = (s) => Math.round(s / cfg.smax_percent * (cfg.n - 1));
  cfg.rest = at(data.strips.cohort.fabric * 100);

  const stretch = $('[data-live="stretch"]', root);
  const nfail = $('[data-live="nfail"]', root);
  const hero = $('[data-live="hero"]', root);
  const n = data.strips.cohort.n_bodies;

  const strip = new Strip(root, cfg, {
    start: cfg.rest,
    defer: true,
    onIndex: (i, p) => {
      stretch.textContent = p.stretch.toFixed(1) + '%';
      nfail.textContent = `${p.n_fail} of ${n}`;
      nfail.style.color = p.n_fail ? 'var(--red)' : 'var(--ink)';
      hero.textContent = p.hero_over_capacity < 0.05 ? 'fits'
        : p.hero_over_capacity.toFixed(1) + '% over';
      $$('#material-stops button').forEach((b) =>
        b.setAttribute('aria-current', at(+b.dataset.s) === i ? 'true' : 'false'));
    },
  });

  $('#material-stops').innerHTML = Object.entries(cfg.named)
    .map(([s, label]) => `<button type="button" data-s="${s}">${label}</button>`).join('');
  $$('#material-stops button').forEach((b) =>
    b.addEventListener('click', () => strip.set(at(+b.dataset.s), true)));
  return strip;
}

/* -- where you are ----------------------------------------------------- */
/* A long single page loses the reader's place, and the fix is not to cut it
 * into separate pages: the argument is cumulative, so a visitor who lands on
 * page three of five has been handed the middle of a case nobody made to them.
 * The fix is to say where they are. The nav link for the section under the
 * reader lights up, which is the cheapest orientation cue there is, and it
 * doubles as a map of what is further down. */
function navHighlight() {
  const links = [...$$('.nav nav a[href^="#"]')].filter((a) => !a.classList.contains('btn'));
  const ids = links.map((a) => a.getAttribute('href').slice(1));
  const seen = new Set();
  const io = new IntersectionObserver((es) => {
    es.forEach((e) => (e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id)));
    // The topmost section in the band, so two never light at once.
    const at = ids.find((id) => seen.has(id));
    links.forEach((a) => a.classList.toggle('active', a.getAttribute('href').slice(1) === at));
  }, { rootMargin: '-70px 0px -55% 0px' });
  ids.forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el); });
}

/* -- scroll reveal ---------------------------------------------------- */
/* `.reveal` STARTS AT ZERO OPACITY, so this does not animate a decoration: it
 * is what makes half the page visible at all, and a trigger that fails to fire
 * does not lose a flourish, it loses a section. Two consequences.
 *
 * NO FRACTION. A threshold of 0.15 asks for a proportion of the element, which
 * is a different number of pixels on every screen and is unreachable once an
 * element is many viewports tall. The negative bottom margin asks the question
 * that was meant instead: has this reached the lower part of the screen. It
 * cannot be out of reach at any size.
 *
 * AND A FLOOR UNDER IT. If there is no observer to be had, everything is shown
 * at once. A page missing its argument is worse than a page that arrives
 * without the fade. */
function reveal() {
  const show = (el) => {
    el.classList.add('in');
    $$('.track i', el).forEach((i) => { i.style.width = i.dataset.w + '%'; });
  };
  if (!('IntersectionObserver' in window)) { $$('.reveal').forEach(show); return; }
  const io = new IntersectionObserver((es) => {
    es.forEach((e) => {
      if (!e.isIntersecting) return;
      show(e.target);
      io.unobserve(e.target);
    });
  }, { threshold: 0, rootMargin: '0px 0px -12% 0px' });
  $$('.reveal').forEach((el) => io.observe(el));
}

/* -- go --------------------------------------------------------------- */
Promise.all([
  fetch('demo/data.json')
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
  import('./strip.js' + V).then((m) => { Strip = m.Strip; }),
])
  .then(([data]) => {
    fill(data);
    pairTable(data);
    bars(data);
    seatedStats(data);
    const strips = [cohortStrip(data), fabricStrip(data)];
    // The sit is the one strip the page can do without, so it is drawn only if
    // it was built. A section that half-appears is worse than one that does not.
    if (data.strips.seated) strips.push(seatedStrip(data));
    else $('#strip-seated').classList.add('no-figure');
    reveal();
    navHighlight();
    // THE PHONE IS THE ONLY DEVICE HERE AND IT HAS NO CONSOLE. `?debug` on the
    // real page, not a copy of it, prints what the sweep is actually deciding:
    // the Reduce Motion setting, how many pixels of the figure are on screen
    // against how many it wants, and which state each strip is in. Two sessions
    // went into guessing at these from a laptop.
    if (/[?&]debug/.test(location.search) || location.hash === '#debug') {
      import('./debug.js' + V).then((m) => m.panel(strips, data)).catch(() => {});
    }
    const c = data.strips.cohort;
    $('#provenance').textContent =
      `${c.n_bodies} bodies, ${c.design}, ease ${c.ease.replace('uniform-', '')}, `
      + `re-derived ${data.built.slice(0, 10)}`;
  })
  .catch((e) => {
    console.error('demo/data.json', e);
    document.body.classList.add('no-data');
  });
