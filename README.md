# untitled-25d-platformer

A 2.5D platformer built with Vite + three.js. Static site — no server, no database.

## Local development

```bash
npm install
npm run dev        # vite dev server on :5173
npm run build      # tsc --noEmit && vite build  ->  dist/
npm run preview    # serve the built dist/ locally
npm test           # vitest
```

## Deploy notes (Railway)

This app deploys to Railway as a **static SPA**. There is no backend and no database.

### How it builds and serves

- **Builder:** `RAILPACK` (see `railway.toml`).
- **Build command:** `npm run build`, which typechecks and emits the static bundle to `dist/`.
- **Serving:** Railpack serves `dist/` through Caddy in SPA mode — unknown paths fall back to
  `index.html` so client-side routing works. Caddy enables gzip compression by default.
- **Healthcheck:** `/`.

### Required service variable

Railpack only enters static-SPA serving mode when the output directory is declared:

```
RAILPACK_SPA_OUTPUT_DIR=dist
```

Set this as a **Railway service variable** (dashboard → service → Variables, or via Railway MCP /
CLI). It is *not* in `railway.toml` — the `railway.toml` schema has no `variables` key.

### Do not set a start command

`deploy.startCommand` is intentionally omitted from `railway.toml`. Setting a custom start command
makes Railway run that process instead of Caddy, which disables SPA static serving and breaks the
deploy.

### `Staticfile`

`Staticfile` at the repo root describes the same intent for buildpack-style static serving:

```
root: dist
pushstate: enabled
force_https: true
```

- `root: dist` — serve the Vite build output.
- `pushstate: enabled` — SPA fallback to `index.html` for client-routed paths.
- `force_https: true` — redirect HTTP to HTTPS.

### Verifying a live deploy

Never trust a URL until Railway reports the deployment as `SUCCESS` **and** a public domain exists.
Then check it over HTTP:

```bash
URL="https://<your-service>.up.railway.app"

curl -sI "$URL"            # expect: HTTP/2 200, content-type: text/html
curl -s "$URL" | head -40  # expect: index.html markup, not a 404 page
```

A healthy response is HTTP 200 with `Content-Type: text/html` and the game's `index.html` markup
(including the `<script type="module">` tag for the bundled entry point). A 404, a Railway
"Application not found" page, or an empty body means the deploy is not serving `dist/` — recheck
`RAILPACK_SPA_OUTPUT_DIR` and confirm no `startCommand` was set.
