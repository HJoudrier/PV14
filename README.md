<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/805426b4-ae9b-4626-b18a-9557e065b69f

## Run Locally

No build step, no package manager, no dependencies to install. The app is
plain HTML, CSS and JavaScript, with Chart.js and PapaParse vendored
locally in [`vendor/`](vendor).

Just open [`index.html`](index.html) directly in a browser, or serve the
folder with any static file server, e.g.:

```
python3 -m http.server 8000
```

then visit `http://localhost:8000/`.

## Code layout (js/)

The application code lives in [`js/`](js) split into small classic
scripts (each under 10 KB), loaded in order by `index.html`. There's no
module system — every file shares one global scope, so **load order
matters** (a file may use functions/consts defined by an earlier file,
never a later one) and the numeric filename prefixes reflect that
order. Keep using plain `<script src="...">` tags (not `type="module"`)
so the app keeps working when opened directly via `file://`.

## Updating styles (css/)

The stylesheet lives in [`css/`](css), split into small files (each under
10 KB) loaded in order by `index.html` — together they're one compiled
Tailwind CSS output, so **do not hand-edit their utility classes
directly**, and keep the `<link>` order in `index.html` unchanged (it
reproduces the original cascade: properties/theme, base, three utilities
chunks, then the custom rules). The real source is
[`tailwind.src.css`](tailwind.src.css) (just `@import "tailwindcss";` plus
the handful of custom rules), which needs Tailwind to turn Tailwind classes
used in `index.html` into actual CSS. To regenerate `css/` after changing
classes in `index.html` or rules in `tailwind.src.css`:

1. Rebuild a single compiled CSS file the same way as before the `css/`
   split (see git history for the exact `vite.config.js` +
   `npx vite build --minify=false --cssMinify=false` recipe using
   `tailwind.src.css` as input).
2. Re-split that single file into `css/01-properties-theme.css` through
   `css/06-custom.css` at the same cut points: `@layer properties` +
   `@layer theme` | `@layer base` + `@layer components;` | three ~9 KB
   slices of `@layer utilities { ... }` (each file re-wraps its slice in
   its own `@layer utilities { }`) | the trailing custom rules after the
   utilities layer closes.

This is a one-off local step; none of it is needed to run the app itself.
