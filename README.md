# Human Modification Forecasts explorer

A single-page GitHub Pages app for exploring The Nature Conservancy's human
modification (HM) dataset on a 3D globe: observed 1990–2020 and probabilistic
forecasts for 2025–2040, stored in the Arraylake repo
`the-nature-conservancy/hm_probability_forecast`.

- Map any observed year, or any forecast year at any of the forecast's 64 percentiles.
- Click a pixel to plot its observed record and forecast median with 50% and 95% intervals.
- The URL hash holds the current view (`#mode=forecast&year=2040&p=97.5&pt=37,-1`), so links are shareable.

## How it fits together

```
browser (GitHub Pages)  ──►  Cloudflare Worker proxy  ──►  Earthmover Flux
  site/ (CesiumJS)             worker/ (holds the key)       tiles  → map layer
                               edge-caches responses         EDR    → pixel time series
```

The Flux EDR and tiles services require an Arraylake API key. GitHub Pages is
static, so any key shipped to the browser is public. The Worker keeps the key server-side,
adds it to upstream requests, and only forwards `GET`s for this repo's two groups
(`hm_prob_forecast`, `hm_observed`) and the routes the site uses. Tile and EDR
responses are cached at Cloudflare's edge for a day. Tiles take a few seconds to render
upstream, so repeat views are much faster.

The tiles service has no overviews below zoom 3, so the globe always loads zoom-3
tiles or finer (about 60 tiles for a whole-globe view the first time).

## One-time setup

1. **Cloudflare**: create an API token with the *Edit Cloudflare Workers* template
   and note your account ID.
2. **GitHub repository secrets** (Settings → Secrets and variables → Actions):
   - `ARRAYLAKE_KEY`: Arraylake API key (already set)
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
3. Run the **Deploy data proxy** workflow (or push a change under `worker/`).
   Its log prints the Worker URL, e.g. `https://hm-forecasts-proxy.<subdomain>.workers.dev`.
4. **GitHub repository variable** `PROXY_URL`: set to that Worker URL.
5. **Settings → Pages → Source: GitHub Actions**, then run **Deploy site to GitHub Pages**.

If the site is served from anywhere other than `https://gmoncrieff.github.io`,
add that origin to `ALLOWED_ORIGINS` in `worker/wrangler.toml`.

## Local development

```sh
# proxy on :8787 (put ARRAYLAKE_KEY=ema_... in worker/.dev.vars, which is gitignored)
cd worker && npm install && npm run dev

# site on :8000 (site/config.js points at localhost:8787 by default)
cd site && python -m http.server 8000
```

## Data access details

| Purpose | Service | Request (through the proxy) |
|---|---|---|
| Map layer | tiles | `/tiles/{group}/tiles/WebMercatorQuad/{z}/{y}/{x}?variables=hm&year=…&percentile=…` |
| Dimension values | EDR | `/edr/{group}/edr/` (collection metadata) |
| Pixel series | EDR | `/edr/{group}/edr/position?f=csv&coords=POINT(lon lat)&percentile=…` |

Percentiles must match the dataset's coordinate values exactly, so the slider
steps through the 64 real values. The chart requests five percentiles in parallel
(2.5, ≈25, 50, ≈75, 97.5) because one request for all 64 is much slower.
