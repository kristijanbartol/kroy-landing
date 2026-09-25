# KROY — landing page

The demo's argument, as a page that has to make it without a narrator. Static,
no build step for the page itself: open `index.html`, or deploy the folder.

```
index.html   the page
page.css     the palette, the type, the layout
page.js      wires demo/data.json into the page, and drives both strips
strip.js     the drag strip: one sprite sheet, one canvas, one full-res frame
demo/        BUILT, not hand-edited. See below
assets/      logo, founder photos, icons, social preview
```

## The page is not the demo, and that is the point

The demo in `~/kroy/fit-demo/site/` is shown on a phone, live, one beat per tap,
by someone talking over it. This page is opened alone, on a laptop, by someone
who has not decided to care yet. Attention there is bought by the presenter;
here it is unbought and has to be earned every second. So there are fewer beats,
and the meaning lives in the image rather than in a paragraph.

**The two strips are the reason it is a page and not a slideshow.** The cohort
sweep exists to answer *"you picked two bodies that suit you"*, and a video of
144 bodies is still something we authored. A strip the viewer DRAGS lets them
check, including on the bodies we would least want them to stop on. That is a
different category of proof.

## `demo/` is built by the fit engine

Never edit it and never type a number into the page that is not read from it.

```bash
cd ~/kroy/fit-demo
# renders the figures; needs the fitdrape environment (cloth)
python scripts/page_strip.py --strip cohort
python scripts/page_strip.py --strip fabric
python scripts/page_strip.py --strip seated --fabric 0.05
# encodes them here and derives every number on the page; fitdemo environment
python scripts/build_page.py --check
```

`build_page.py` writes `demo/` and nothing else, so it can never overwrite the
page. It fails the build if a rate reaches `data.json` without the tally it is a
share of.

## The one thing on this page that can actually hurt

The cohort is **144 bodies we built** inside one chart's size-M box. It is not a
sample of anyone's customers and it carries no frequencies.

- **say:** "of the bodies this chart calls a size M, one in eight cannot wear
  these", with the tally visible.
- **never say:** "13 percent of your customers."

A sentence on a website travels without its picture, so every share on this page
is written as a count out of the cohort. Keep it that way.

## Preview locally

```bash
cd ~/kroy/landing-website
python3 -m http.server 8000        # http://localhost:8000
```

A `file://` open will not work: the page fetches `demo/data.json`, and modules
and `fetch` both need an origin.

## Checking it on a phone

The page is opened on a phone, so `?debug` and `test/phone.mjs` are the two ways
to find out what it is doing there, and both exist because the opening sweep was
"fixed" twice without ever being reproduced.

`https://.../?debug` prints a panel on the real page on the real device: the
Reduce Motion setting, how many pixels of each figure are on screen against how
many the sweep wants, which state each strip is in, the frame rate, and the
build stamp so you can tell whether the phone has the file you just deployed.
It is the only instrument that reaches the device.

`test/phone.mjs` runs the page in Playwright's WebKit at three iPhone sizes with
a touch pointer. Resizing a Chrome window is not a phone: it reports a different
viewport from the one it was given, it is a different engine from Safari's, and
its synthetic drag delivers no pointer events.

```bash
npm i -D playwright && npx playwright install webkit
python3 -m http.server 8899
node test/phone.mjs                 # PAGE=https://... to check what is live
```

## Deploy

Push to `origin` (github.com/kristijanbartol/kroy-landing); Netlify builds from
it to kroy-web.netlify.app. `demo/` has to be committed, which is why it is kept
small: a few megabytes of WebP rather than a video.

## Still owed

- [ ] A domain and a real address. The call to action is a `mailto:` to a gmail,
      which reads as weak for B2B.
- [ ] Absolute `og:image` / `twitter:image` URLs once the domain exists; some
      scrapers ignore relative paths.
- [x] A social preview made from the demo's own figures. `build_page.py` draws
      `demo/og-image.png`: eight figures across the cohort in thigh order, with
      the real tally under them. `assets/og-image.png` is the old one and is now
      unused.
