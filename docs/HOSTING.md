# Static hosting

The production build is a self-contained static site in `dist/`. It includes the game, public
assets, runtime JSON data, and a build-generated `data/maps/index.json`. It does not include the
designer tools or the Node development API.

## Netlify

Connect the repository and use the checked-in `netlify.toml`: build command `npm run build`,
publish directory `dist`. The fallback redirect is safe for a direct visit to the game shell;
the data and asset files are served normally before that rule. Data and the service worker use
revalidation headers so a redeploy is visible promptly.

## GitHub Pages

Run `npm ci` and `npm run build`, then publish the contents of `dist/` with Pages. The Vite build
uses `base: './'`, so the same artifact works at `https://owner.github.io/repository/` without a
repository-name flag or config edit.

GitHub Pages must serve the files over HTTPS; opening `dist/index.html` with `file://` is not a
supported test. Use `npm run preview -- --port 4174` locally.

## Saves and PWA behavior

Save slots live in browser `localStorage`. They are per browser profile and per device; deploying
the site does not move them. Use **Title screen → Load Game → Export** to make a save file, and
**Import** on another browser/device.

The service worker is scoped to the deployed app path. The app shell and assets are network-first
with an offline cache fallback. `/data/` is always network-only, so a reachable redeploy supplies
fresh tuning/maps instead of a cached JSON copy. Reload once online after a deployment if an old
tab was left open.

## Custom server

Any static HTTPS server can serve `dist/`; no Node process or `/api/*` endpoints are required.
If a custom server adds caching, keep `data/*` and `sw.js` revalidated (or uncached). `server.js`
remains the local authoring server because the excluded tools need its write/listing endpoints.
