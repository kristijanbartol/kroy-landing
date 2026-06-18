# KROY — landing page

Single, self-contained static page. No build step. Open `index.html` in a browser, or deploy the folder anywhere static.

## Preview locally
```bash
cd /Users/kristijanbartol/kroy/landing-website
python3 -m http.server 8000   # then open http://localhost:8000
```

## Deploy (free options)
- **Vercel:** `npx vercel` in this folder, or drag-drop at vercel.com/new.
- **Netlify:** drag-drop the folder at app.netlify.com/drop.
- **GitHub Pages:** push to a repo, enable Pages on the branch.

## Assets (wired in)
- `assets/kroy-logo.png` — nav logo (white background dropped via `mix-blend-multiply`).
- `assets/kristijan-slika.jpeg`, `assets/davidboja.jpeg` — founder photos in `#team`.
- `assets/favicon.png`, `assets/apple-touch-icon.png` — browser tab icon (the "O" mark).
- `assets/og-image.png` — 1200×630 social preview (email/Slack/LinkedIn link cards).

## TODOs before sending to clients
- [ ] **Get a domain + email** (e.g. `hello@kroy.xxx`) and a scheduling link (Calendly/Cal.com). The **Book a call** button currently uses a `mailto:` to the gmail — replace it. (Gmail addresses read as weak for B2B.)
- [ ] Once the domain is live, make the `og:image` / `twitter:image` paths **absolute** URLs in `index.html` (some scrapers ignore relative paths).
- [ ] `#team`: tailor both bios (expertise + sustainability + a personal touch).
- [ ] Optional: adjust the demo numbers (currently illustrative, "Brand 1–4").
- [ ] Before production: replace the Tailwind CDN with a built CSS file (the CDN shows a console warning and is fine for now, but not ideal long-term).

## The centerpiece
The interactive panel ("Four brands. Same label.") is the page's argument: four "M" jeans scatter across real waist measurements, then snap onto one consistent KROY scale. It demonstrates your core idea — relating all sizes consistently from sparse data, no photo required — in one click.
