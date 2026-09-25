/* What the page is actually deciding, printed on the page, for a phone.
 *
 * WHY THIS EXISTS. The animation failed on an iPhone and worked on every
 * laptop, and two sessions went into guessing at the difference from the
 * laptop. A phone has no console, a real WebKit engine driven locally at phone
 * geometry reproduces none of it, and every candidate cause, Reduce Motion, a
 * cached module, a visibility threshold that cannot be met, leaves the page
 * looking exactly the same: a correct still picture.
 *
 * So the page says which one it is. `?debug` on the REAL page, not a copy, so
 * what it reports is the real layout in the real browser. Big enough to read at
 * arm's length, because the device it is for is the device in your hand.
 */
'use strict';

const CSS = `
#dbg { position: fixed; left: 0; right: 0; bottom: 0; z-index: 9999;
  background: rgba(12,12,14,.94); color: #e8e8ea; font: 500 12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;
  padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); max-height: 46vh; overflow: auto;
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
#dbg b { color: #fff; }
#dbg .y { color: #ffd166; }
#dbg .g { color: #8ce99a; }
#dbg .r { color: #ff8787; }
#dbg table { border-collapse: collapse; width: 100%; margin-top: 4px; }
#dbg td { padding: 1px 6px 1px 0; vertical-align: top; }
#dbg .hd { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
#dbg button { font: inherit; background: #333; color: #eee; border: 0; padding: 4px 9px; border-radius: 4px; }
`;

const on = (v) => (v ? '<span class="r">ON</span>' : '<span class="g">off</span>');

/* Which of the four things is stopping a sweep, said in one word. A strip
 * reports its own state rather than being inferred from the outside, so the
 * word here is the same condition the sweep itself tested. */
function state(s) {
  if (s.reduced) return '<span class="r">reduced-motion: skipped</span>';
  if (s.userOwns) return '<span class="y">yours (dragged)</span>';
  if (s.auto) return '<span class="g">SWEEPING</span>';
  if (s.arming) return '<span class="y">arming</span>';
  if (!s.sheets) return s.root.classList.contains('failed')
    ? '<span class="r">sheet FAILED</span>' : 'loading sheet';
  if (s.done) return 'swept, resting';
  return '<span class="y">waiting: not enough on screen</span>';
}

export function panel(strips, data) {
  const el = document.createElement('div');
  el.id = 'dbg';
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  document.body.appendChild(el);

  const errs = [];
  addEventListener('error', (e) => errs.push(String(e.message || e.error)));
  addEventListener('unhandledrejection', (e) => errs.push('reject: ' + String(e.reason)));

  // Frames per second, measured rather than assumed. A phone in Low Power Mode
  // halves this, and a sweep that runs at 30 fps is a different complaint from
  // a sweep that does not run.
  let frames = 0, fps = 0, t0 = performance.now();
  const count = (t) => {
    frames++;
    if (t - t0 >= 1000) { fps = Math.round(frames * 1000 / (t - t0)); frames = 0; t0 = t; }
    requestAnimationFrame(count);
  };
  requestAnimationFrame(count);

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ios = (navigator.userAgent.match(/(?:iPhone|CPU) OS (\d+[_.]\d+)/) || [, '?'])[1].replace('_', '.');

  const paint = () => {
    const rows = strips.filter(Boolean).map((s) => {
      // Asked of the strip, never recomputed here: a panel that carries its
      // own copy of the rule can agree with itself while the page disagrees.
      const { shown, need } = s.watch ? s.watch() : { shown: 0, need: 0 };
      const ok = shown >= need;
      return `<tr><td><b>${s.cfg.id}</b></td>
        <td class="${ok ? 'g' : 'y'}">${Math.round(shown)}/${Math.round(need)}px</td>
        <td>at ${s.i}/${s.n - 1}</td>
        <td>${state(s)}</td></tr>`;
    }).join('');
    el.innerHTML = `
      <div class="hd"><b>build ${new URL(import.meta.url).search.slice(1) || 'unversioned'}</b>
        <span>iOS ${ios} &middot; ${innerWidth}x${innerHeight} &middot; dpr ${devicePixelRatio}</span></div>
      <div>reduce-motion ${on(reduce)} &middot; ${fps} fps &middot; ${document.visibilityState}
        &middot; data ${data.built.slice(0, 10)}</div>
      <table>${rows}</table>
      ${errs.length ? `<div class="r">${errs.slice(-3).join('<br>')}</div>` : ''}
      <div style="margin-top:6px"><button type="button" id="dbg-x">hide</button></div>`;
    el.querySelector('#dbg-x').onclick = () => el.remove();
  };
  paint();
  setInterval(paint, 400);
}
