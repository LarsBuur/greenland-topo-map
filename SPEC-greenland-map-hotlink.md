# Spec: Hotlinkable Greenland topo map (single page)

> **Historical.** This is the original brief, kept as a record of what was asked for. The app has
> moved well beyond it — there is now a server-side token proxy, offline tile downloads, personal
> points and live tracking, and it is no longer a single static `index.html`. See `README.md` for
> how the thing actually works today.

## Goal
One static `index.html` that shows the Greenland topographic basemap and centers on the coordinates given in the URL, with a pin. Shareable links must work on desktop and mobile — no JOSM, no backend.

## URL format
`index.html#<zoom>/<lat>/<lon>` — e.g. `#13/66.9879/-53.2060`
- Parse on load; if absent, default to `#6/67.0/-50.0` (all of West Greenland).
- On pan/zoom, update the hash so the current view is always copy-pasteable.

## Map
- Library: **Leaflet** (CDN).
- Basemap: WMS `https://api.dataforsyningen.dk/wms/gl_aabent_land`
  - layer `gl_aabent_land`, `format=image/png`, `version=1.3.0`, EPSG:3857.
  - Requires a `token` query param. **Do not hardcode a token.** Read it from a `?token=...` URL param or a `const TOKEN` at the top of the file; document how to get one at dataforsyningen.dk.
- Marker: drop a pin at the `#lat/lon`; popup shows lat, lon.
- Add a layer toggle: Greenland topo (default) + OpenStreetMap fallback.

## Acceptance
1. Opening `#13/66.9879/-53.2060` loads with the topo map centered there, pin on point.
2. Panning updates the hash; pasting that hash into a fresh tab reproduces the view.
3. Works with only a static file server (e.g. `python -m http.server`); no build step.
4. If the token is missing/invalid, show a visible message and still render the OSM fallback layer.

## Out of scope
Routing, GPX loading, offline tiles, styling beyond a clean full-screen map.

## Notes for later
Once live, generate ready-made hut/river hotlinks (coords already in `Arctic-Circle-Trail.gpx`) pointing at the hosted URL.
