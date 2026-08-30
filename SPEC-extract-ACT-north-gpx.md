# Spec: Extract ACT Northern Route to GPX (hand-off to Claude Code)

> **Historical.** This is the hand-off brief for the one-off extraction that produced
> `public/act-north-trail.geojson`. The work is done; the script lives at `scripts/build-trail.mjs`.
> Kept for the reasoning behind the extraction, not as current documentation. See `README.md`.

## Why hand-off
The extraction logic is fully worked out and verified below. It could not be finished in
this environment because the finished ~93 KB GPX could not be moved out of the browser
(result display truncates ~16 KB, base64 output is filtered, and the sandbox can't read
web_fetch cache files). Claude Code runs locally with Node + network, so it can fetch the
source files and write the GPX directly.

## Data source (qgis2web layers, plain JS/GeoJSON)
The interactive map at `https://arcticcircletrail.gl/planning/act-interactive-map/` embeds
an iframe `https://arcticcircletrail.gl/ACT-interactive-map/ACT.html`. Each layer is a static
JS file under `.../ACT-interactive-map/data/` defining `var json_<Name> = { FeatureCollection }`.
Coordinates are `[lon, lat]` (EPSG:4326).

Files needed:
- `data/ACTNorthernRoute_8.js`  → `json_ACTNorthernRoute_8` (9 MultiLineString features = hut-to-hut segments)
- `data/HutLocations_9.js`      → `json_HutLocations_9` (11 Point huts)
- `data/Distancemarks1km_3.js`  → `json_Distancemarks1km_3` (283 MultiPoint marks, all routes mixed)

## Goal
One GPX: the Northern Route as a single continuous `<trk>` (Sisimiut → Kangerlussuaq),
all 11 huts as `<wpt>`, and the 1 km distance marks that lie on the Northern Route as `<wpt>`.

## Algorithm (verified working)
1. **Load** the three JS files (in Node: strip `var x =`/trailing `;` and `JSON.parse`, or eval).
2. **Segment order** (Sisimiut→Kangerlussuaq), by `properties.name`:
   1. `ACT - Northern Route - Kangerlusarsuk Tulleq - Sisimiut`
   2. `ACT - Northern Route - Nerumaq - Kangerluarsuk Tulleq`
   3. `ACT - Northern Route - Innajuattoq - Nerumaq`
   4. `ACT - Northern Route - Eqalugaarniarfik - Innajuattoq`
   5. `ACT - Northern Route - Ikkattooq - Eqalugaarniarfik`
   6. `ACT - Northern Route - Canoe Centre - Ikkattooq`
   7. `ACT - Northern Route - Kattifik - Canoe Centre`
   8. `ACT - Northern Route -Kellyville - Katiffik`   ← note: no space after "Route -"
   9. `ACT - Northern Route - Gravel Road to Kellyville`
3. **Per segment, chain parts with a node graph** (NOT nearest-neighbour, NOT file order —
   both gave wrong lengths). Steps that worked:
   - Drop parts whose length < 0.004 km (zero-length connector stubs).
   - Node key = `lon.toFixed(5)+","+lat.toFixed(5)`; each remaining part is an edge between its
     two endpoint nodes.
   - Start at the endpoint node nearest the entry point (Sisimiut `[-53.6735,66.9395]` for seg 1,
     otherwise the previous segment's end). Repeatedly take any unused incident edge, append its
     polyline (oriented), move to the other end. This reproduces each segment's true path.
   - Orient the whole segment so its start is nearest the running cursor; drop the duplicate
     junction point (<0.05 km) when concatenating to the growing chain.
4. **Distance marks**: for each of the 283 marks (`geometry.coordinates[0]`), compute min haversine
   distance to the chain vertices; **keep marks < 0.12 km** from the chain. Compute cumulative km
   along the chain at the nearest vertex; sort; keep one per rounded-km; name `KM <n>`.
5. **Huts**: all 11 from `json_HutLocations_9` (`properties.name`, `[lon,lat]`), as `<wpt> sym=Lodge`.
6. Optional: Douglas–Peucker simplify the track at ε≈0.00005° (~5 m) — took 4738→1853 pts, 162.68→161.9 km.

## Verified results (sanity targets)
- Total track length **162.7 km** (matches ACT ~165 km and the sum of segment `dist_km` labels = 162).
- Per-segment km vs map label: 18.8/19, 16.1/16, 17.1/17, 21/21, 11.3/11, 22.2/22, 20/20, 21.7/20, 14.4/16. ✓
- Track first pt ≈ `[-53.632, 66.938]` (Sisimiut trailhead), last ≈ `[-50.734, 67.011]` (Kangerlussuaq/Kellyville road end).
- Huts (11): Katiffik, Canoe Centre, Ikkattooq, Eqalugaarniarfik, Innajuatooq I, Innajuatooq II,
  Nerumaq, Kangerluarsuk Tulleq Nord, Kangerluarsuk Tulleq Syd, Uttoqqaat, Ilagassat.
- Distance marks kept on route: **160**, numbered **KM 1 … KM 163**.

## Output
`ACT-North-Trail.gpx` (GPX 1.1): `<metadata>`, 11 hut `<wpt>`, 160 km-mark `<wpt>` (`sym=Milepost`),
one `<trk><trkseg>` with the chain (lat/lon 5–6 decimals). Validate: well-formed XML, trackpoints > 1500,
length 160–165 km, marks 1..~163.

## Note on numbering
Marks were renumbered as cumulative km **from Sisimiut** (matches the hike direction). The source's own
per-sub-section labels are fragmented and not usable as a single sequence.
