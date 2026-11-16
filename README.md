# nitin-portfolio

Single-page portfolio for Nitin Dabas, senior Mendix developer. Static HTML, CSS and vanilla JS —
no framework, no build step, no third-party JS at runtime.

**Live:** https://nitin-portfolio-716.pages.dev

## The page

| Section | What it shows |
| --- | --- |
| Hero | A Mendix refinery work-order window; the Antwerp portfolio in one line |
| Record | 34 / 14 / 5 figures, the 2021 → 2026 path, certifications |
| Work | The Antwerp refineries on 34 applications, plus the TEGNA migration |
| Reach | Spinning dot globe, real coastlines, arcs Delhi → Antwerp and Tysons |
| Build | Domain models, integrations, AI-assisted delivery |
| Close | Start a conversation, email and LinkedIn |

## Run locally

```powershell
python -m http.server 8123
# http://127.0.0.1:8123/index.html
```

Modules and the canvas need http, not `file://`.

## Deploy (Cloudflare Pages, free plan)

```powershell
# 1. build the folder that goes to Pages
$dist = "dist"; Remove-Item $dist -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $dist | Out-Null
Copy-Item index.html,favicon.svg,globe-fallback.svg,share.jpg $dist
robocopy assets "$dist\assets" /E /NFL /NDL /NJH /NJS /NP | Out-Null

# 2. publish
npx wrangler pages deploy dist --project-name nitin-portfolio --branch main
```

`dist/` is ignored by git; Pages stores the previous deployment, so a rollback is in the
dashboard. The project was created with `--force` (classic Pages); do not pass `--force` again.

## The globe

`assets/js/globe.js` draws a dot globe on a 2D canvas: land points from
`assets/objects/print-globe/land.js`, orthographic projection, arcs out of Delhi. It pauses off
screen, respects `prefers-reduced-motion`, and can be dragged.

`tools/make-globe.mjs` renders the same geography to `globe-fallback.svg`, which sits behind the
canvas for no-JS and for a failed script. Change `SITES` there and in `globe.js` to move the arcs.

```powershell
node tools/make-globe.mjs
```

## Checks

The page is built against the `design-taste-frontend` kit and its checker:

```powershell
node .agents/skills/design-taste-frontend/scripts/gate.mjs index.html          # GATE: PASS
node .agents/skills/design-taste-frontend/scripts/consistency.mjs index.html --quick --widths 1440,390
node .agents/skills/design-taste-frontend/scripts/copy-lint.mjs index.html --kind software
```

Current state: gate PASS, consistency 0 FAIL at 1440/1024/820/768/390/320, copy-lint 0 FAIL.

## Notes

- `assets/` is the design kit (icons, fragments, effects). Only a fraction is referenced; it can be
  pruned before a deploy if the upload size matters.
- Client logos are trademarks of their owners; the footer says so. Client applications themselves
  are not shown.
