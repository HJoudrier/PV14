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

## Updating styles (index.css)

`index.css` is a **compiled** Tailwind CSS file — do not hand-edit its
utility classes directly. The real source is
[`tailwind.src.css`](tailwind.src.css) (just `@import "tailwindcss";` plus
the handful of custom rules), which needs Tailwind to turn Tailwind classes
used in `index.html` into actual CSS. To regenerate `index.css` after
changing classes in `index.html` or rules in `tailwind.src.css`:

```
npm install --no-save vite @tailwindcss/vite tailwindcss
cp tailwind.src.css index.css
npx vite build --minify=false --cssMinify=false
cp dist/assets/index-*.css index.css
rm -rf dist node_modules package-lock.json
```

(A minimal `vite.config.js` with the `@tailwindcss/vite` plugin is required
for this — see git history for an example.) This is a one-off local build
step; none of it is needed to run the app itself.
