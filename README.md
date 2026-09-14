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
