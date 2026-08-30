# Greenland topo map — offline maps for the Arctic Circle Trail

A Next.js app that shows the Greenland 1:50,000 topographic basemap centred on coordinates
given in the URL, with a pin. Shareable links work on desktop and mobile — no JOSM, no
localhost, no desktop dependency.

Built to replace the `http://127.0.0.1:8111/zoom?...` JOSM Remote Control links in
`ACT-Personal-Itinerary.md`, which only work with JOSM running on the same machine.

A running instance lives at **[act.buur.org](https://act.buur.org)**. It carries one particular
hiker's route and plan, so if you want it for your own trip, deploy your own — see
[Deploy your own](#deploy-your-own). Every key it needs is free.

## URL format

```
/#<zoom>/<lat>/<lon>        e.g.  /#13/66.987900/-53.205986
```

- Parsed on load. Absent or malformed → defaults to `#6/67.0/-50.0` (all of West Greenland).
- Pan or zoom rewrites the hash (via `replaceState`, so it doesn't spam history), so whatever
  is on screen is always copy-pasteable.
- Pasting a new hash into an open tab moves the map and the pin.

## Pages

| Route | What it is |
| --- | --- |
| `/` | Full-screen map. Pin at the linked point, context markers for every hut/town/trailhead/river crossing, and the trail, distance-mark, SAR and no-paddle overlays. Map controls (zoom, ruler, layers) are in one top-right cluster; the panels are in a rail down the left (see [Layout](#layout)). |
| `/links` | Hotlink index: day-by-day plan plus tables of huts, towns, trailheads and river crossings, each linking into the map. |
| `/api/wms` | Server-side WMS proxy (see below). |
| `/api/wms-health` | Reports whether the topo basemap is usable, so the client can show a real message instead of a blank map. |
| `/api/inreach` | Live position and recent track from the Garmin inReach (see below). |
| `/api/version` | The deployment's build id, so a long-running installed app can notice it is stale (see [Keeping it current](#keeping-it-current)). |

## Deploy your own

The instance at act.buur.org holds one person's route, plan and Garmin feed. Nothing stops you
running your own; it needs one free token, and the rest is optional.

### 1. Get a Dataforsyningen token

The Greenland basemap is `gl_aabent_land`, served by Klimadatastyrelsen through
[dataforsyningen.dk](https://dataforsyningen.dk). Register (free), then **Min side → tokens**.
Without it the app still runs and falls back to OpenStreetMap, with a banner saying why.

### 2. Deploy

```bash
git clone https://github.com/<you>/greenland-topo-map
cd greenland-topo-map
npm install
echo 'DATAFORSYNINGEN_TOKEN=<your token>' > .env.local
npm run dev
```

For Vercel, `vercel env add DATAFORSYNINGEN_TOKEN production` and deploy. Nothing else is
required — no database, no account system, no build-time secrets.

### 3. Optional: your own inReach

```bash
GARMIN_MAPSHARE_ID=XXXXX        # last path segment of your MapShare URL
GARMIN_MAPSHARE_PASSWORD=…      # only if your MapShare page is password-protected
```

Omit both and the live-tracking layer simply does not appear. **Read the warning in
[Live tracking](#live-tracking) before you set these on a public deployment** — `/api/inreach` is
unauthenticated, so anyone who can reach your deployment can read your position.

### 4. Make it your route

What is specific to the Arctic Circle Trail, and what to change:

| File | Holds | If you are doing a different route |
| --- | --- | --- |
| `lib/itinerary.ts` | The day-by-day plan in the Itinerary panel | Replace with yours, or empty `PLAN_DAYS` to drop the panel |
| `lib/waypoints.ts` | Huts, towns, trailheads, river crossings; `DEFAULT_VIEW` | Replace. `DEFAULT_VIEW` is where the map opens with no hash |
| `lib/trail-stages.ts` | Stage prose, SAR points, the no-paddle area | Replace or empty |
| `public/act-north-trail.geojson` | The route geometry and distance marks | Replace; `scripts/build-trail.mjs` shows how this one was extracted |
| `scripts/build-icons.py` | Draws the app icon **from the route geometry** | Re-run `npm run icons` and your icon becomes your route |

The basemap itself is Greenland-only. Elsewhere the topo layer will be blank and you would want a
different WMS in `components/MapView.tsx` — the offline download, personal points, photos and
export machinery are not Greenland-specific and would carry over.

The offline download assumes a corridor along a route. With no route loaded you can still cover
your own saved points, but the corridor option will have nothing to follow.

### A note on the numbers

Two figures in this README were measured against the live service rather than assumed, and are
worth re-measuring if you point this at a different source: the topo raster resolution behind
[Why z14 is the ceiling](#why-z14-is-the-ceiling) (`npm run measure-topo`), and the mean tile
weights used for download size estimates in `components/MapView.tsx`.

## Layout

Everything except the map controls lives in one column down the left — **Offline maps**, **My
points**, **Track**, **Itinerary**, in that order. One column rather than two sides because a
phone has no second side, and each panel is collapsed to its header by default.

A **Hide panels** pill sits above them and collapses the lot to itself, leaving the map
unobstructed. That state is remembered: someone who wants the bare map wants it next time too.
The pill is `position: sticky` inside the scrolling rail — otherwise opening the itinerary and
scrolling down carries the only way back to the bare map off the screen.

Each expanded panel scrolls within itself, capped at `46dvh`. Without that bound, opening the
itinerary pushes every panel below it far down the rail and getting from *Offline maps* to *My
points* means scrolling past nine days of plan. Overscroll is deliberately left to **chain**, so
running out of panel carries on scrolling the rail; `overscroll-behavior: contain` would strand a
thumb inside a panel with no way out but finding a header to drag.

`dvh` and not `vh`: on iOS the URL bar and the keyboard change the real viewport, and `vh` sizes
against the largest of them, so a panel would run off the bottom of the screen exactly when the
keyboard was up.

The rail is `pointer-events: none` with its children set back to `auto`, so a drag landing in the
gap between two panels pans the map instead of hitting a dead strip.

## The token

The basemap is `gl_aabent_land` from [Dataforsyningen](https://dataforsyningen.dk), which
requires a token. The token is **never sent to the browser**: `/api/wms` reads it from the
`DATAFORSYNINGEN_TOKEN` environment variable server-side, forwards an allowlisted set of WMS
parameters upstream, and streams the tile back. Shareable links therefore need no token of
their own.

Local development:

```bash
echo 'DATAFORSYNINGEN_TOKEN=<your token>' > .env.local
npm install
npm run dev
```

On Vercel, set `DATAFORSYNINGEN_TOKEN` for Production, Preview and Development:

```bash
vercel env add DATAFORSYNINGEN_TOKEN production
```

Get a free token by registering at [dataforsyningen.dk](https://dataforsyningen.dk) →
"Min side" → tokens.

If the token is missing or rejected, the app shows a banner naming the reason and renders the
OpenStreetMap fallback layer instead, with topo removed from the layer switcher.

## Live tracking

The map shows the current position of the Garmin inReach Mini 2 as a pulsing orange dot, with
the last **14 days** of track behind it. A `Live · N min ago` button in the HUD jumps to it.
The client polls `/api/inreach` once a minute, and again whenever the tab regains focus —
Garmin's own tracking interval is minutes at best, so polling harder buys nothing.

Positions come from Garmin's MapShare KML feed (`share.garmin.com/Feed/Share/<id>`), fetched
server-side so the MapShare password never reaches the browser:

```bash
GARMIN_MAPSHARE_ID=XXXXX          # last path segment of your MapShare URL
GARMIN_MAPSHARE_PASSWORD=…        # omit if the MapShare page isn't password-protected
```

Set both on Vercel alongside `DATAFORSYNINGEN_TOKEN`. Without `GARMIN_MAPSHARE_ID` the route
returns `not-configured` and the map simply renders without the live layer.

### Tracked days

Nine days of fixes drawn as one polyline is a scribble that hides the route underneath it — and
the feed includes the flight out, which on this trip was a single day covering 3,545 km in seven
fixes, drawn as a straight line across the map.

So `lib/track-days.ts` groups the fixes by **local** calendar date (a fix at 23:30 belongs to the
day you were walking, not to UTC's idea of it) and the **Track** panel draws one polyline per day
with a checkbox each, newest first, with that day's distance and fix count. **Show all** and
**Latest only** are there for the common cases, and which days are switched off is remembered —
having to hide eight days again on every launch would make the feature pointless.

Older days draw fainter and thinner rather than in different colours: recency is what you actually
want to read at a glance, and there are already six colours in use on this map.

Only fixes with a valid GPS lock are joined up. The feed reports failed attempts too, and drawing
through those puts straight legs across country nobody walked.

`/api/inreach?hours=N` controls how far back the track goes (the client asks for 336, max 720).
The route deliberately drops the IMEI and device identifier that the KML feed carries — the
response is public and neither is needed to draw a dot.

> **`/api/inreach` is unauthenticated.** Anyone who can reach the deployment can read the
> position, even though the MapShare page itself is password-protected. That is fine for a
> link shared with people following the trip; it is not fine if the deployment URL is public
> and the position is meant to stay private.

If the device triggers an SOS, the map shows a red banner and the dot turns red and pulses
faster. This is a convenience readout only — Garmin IERCC runs the actual emergency response.

## Plan panel

The **Itinerary** panel, last in the left rail, is one hiker's day-by-day plan, held in
`lib/itinerary.ts` and rendered by `components/PlanPanel.tsx`. It ships as a worked example —
**replace it with your own** (see [Deploy your own](#deploy-your-own)), or empty `PLAN_DAYS` and
the panel disappears.

Each day's `route` is a list of `RouteStop`s rather than one string, so every place can link to
its own position on the map. A stop's `id` refers to a waypoint in `lib/waypoints.ts` and the href
is derived via `hashFor`, so the coordinates never get duplicated here. A stop without an `id`
has no known coordinates (Hundesø) or is not a place at all ("taxi"), and renders as plain text.

`note` and `fishing` accept a minimal inline subset — `**bold**` and `[text](href)` — rendered to
React nodes (not `innerHTML`) by `renderInline`. Links are written **relative** (`/#zoom/lat/lon`)
so clicking one is a same-document hash change that moves the map, instead of a full page load.

The day matching the viewer's local date is highlighted with a `TODAY` chip and
`aria-current="date"`. The date is resolved in an effect from `new Date()` in **local** time (not
`toISOString()`, which is UTC), so the highlight follows the viewer rather than whenever the page
was built. Outside 17–25 August 2026 no day is marked. The year is explicit in each day's `iso`,
so this will not silently light up again in a later August.

The panel sits at `z-index: 900` with the rest of the rail, below Leaflet's controls at 1000, so
an expanded layer switcher stays on top. On screens narrower than 700px it starts collapsed to its
header, because an open panel would cover the map.

It used to be pinned to the right and offset by a `--controls-h` variable holding the height of the
top-right control cluster. Moving it into the left rail removed the overlap it was avoiding, and
that variable is gone — do not reintroduce it.

## Ruler

The ruler button under the zoom control (`Leaflet.LinearMeasurement`) measures ad-hoc distances:
click to lay out legs and each gets a running total plus a bearing, with per-kilometre ticks along
the path. Configured metric, with `show_azimut` and `show_last_node` on. Toggling it off clears
the measurement.

It lives in `vendor/leaflet-linear-measurement/`, **vendored rather than installed**: the npm
package `leaflet-linear-measurement` is version 0.0.1 from 2017 — years behind the repository —
and declares gulp 3.x as a *runtime* dependency, which will not install on current Node. The
source is unmodified apart from an added `import L from "leaflet"`, because upstream is a plain
script expecting a global `L` that does not exist when Leaflet is loaded as a module.

Upstream ships no types, so `vendor/leaflet-linear-measurement/index.d.ts` declares the control
from the plugin's own options block. `allowJs` is on in `tsconfig.json` so the vendored `.js` can
be imported; `checkJs` stays off, so it is not typechecked.

Licence is **BSD-2-Clause** (New Light Technologies, 2017) — the repository's `MIT-LICENSE.md` is
an unfilled template with `<year> <copyright holders>` placeholders, so the BSD file is the
operative one. Its notice is retained in the vendored header and in
`vendor/leaflet-linear-measurement/LICENSE`.

## Data

Waypoints live in `lib/waypoints.ts`, derived from `Arctic-Circle-Trail.gpx` and
`ACT-Personal-Itinerary.md`.

Huts, towns and trailheads are precise. **River crossings are estimated positions** — there is
no official list of the route's rivers, most are unnamed streams, and depth swings with weather
and meltwater. They are marked `approx` in the data and in the UI. Do not navigate by them.

The original `Arctic-Circle-Trail.gpx` also contains a 9-point indicative route (straight lines
between huts). It is deliberately **not** drawn on the map: it is not the real trail and would be
dangerous to follow. The actual trail geometry comes from the source below instead.

## The trail itself

`scripts/build-trail.mjs` extracts the real Northern Route from the
[arcticcircletrail.gl interactive map](https://arcticcircletrail.gl/planning/act-interactive-map/)
— a qgis2web export whose layers are static JS files declaring GeoJSON feature collections.

```bash
node scripts/build-trail.mjs                 # fetch from source and rebuild
node scripts/build-trail.mjs --src ./cache    # use previously downloaded layer files
node scripts/build-trail.mjs --no-simplify    # keep all 4658 chained points
```

It writes three things, all committed:

| Output | Contents |
| --- | --- |
| `public/act-north-trail.geojson` | 9 stage LineStrings + 160 distance-mark Points, for the map |
| `public/ACT-North-Trail.gpx` | 1852-point track, 11 hut waypoints, 160 `KM n` mileposts |
| `lib/trail-stages.ts` | Generated stage metadata (km, ascent, descent, prose) for the pages |

The route arrives as nine hut-to-hut features whose MultiLineString parts are in arbitrary order
and orientation, so parts are chained through a **node graph** (endpoints snapped to 5 decimals,
each part an edge, walked from the end nearest the entry point). File order and nearest-neighbour
both produce plausible-looking lines with wrong lengths. Sub-4 m connector stubs are dropped.

Distance marks are matched against the **unsimplified** chain — simplification moves vertices far
enough to push marks past the 120 m on-route threshold — then renumbered as cumulative km from
Sisimiut, because the source's own labels restart per sub-section.

Verified against the targets in `SPEC-extract-ACT-north-gpx.md`: 162.68 km chained (161.89 after
~5 m Douglas–Peucker), per-stage 18.8/16.1/17.1/21.0/11.3/22.2/20.0/21.7/14.4 km against source
labels 19/16/17/21/11/22/20/20/16, 11 huts, 160 marks numbered KM 1–163.

> Stage **descriptions come from the source, which walks each stage east to west** (Kangerlussuaq
> → Sisimiut). The labels and km numbering here run the other way, so the prose reads
> back-to-front relative to its title. The UI says so wherever a description is shown.

One 5 m degenerate self-loop in the Katiffik–Kellyville segment is left unused by the chaining
walk; the script reports it. It does not affect the length, which matches the source label.

## Basemaps

| Layer | Source | Notes |
| --- | --- | --- |
| Greenland topo (default) | Dataforsyningen `gl_aabent_land` | 1:50,000, via the token proxy |
| OpenTopoMap | tile.opentopomap.org | The basemap arcticcircletrail.gl uses. Contours to z17; no hillshading, as its relief comes from SRTM which stops at 60°N |
| Aerial (Sentinel-2) | EOxCloudless `s2cloudless-2025_3857` | 10 m native, so `maxNativeZoom: 14` |
| OpenStreetMap | tile.openstreetmap.org | Fallback when topo is unavailable |

The arcticcircletrail.gl map declares its basemap as
`L.tileLayer('https://b.tile.opentopomap.org/{z}/{x}/{y}.png', …)` with `attribution: ''`.
OpenTopoMap is CC-BY-SA and requires attribution, so ours carries the full credit line rather
than copying their empty one.

**On the absence of Bing aerial:** Bing Maps for Enterprise free/Basic accounts
[shut down 30 June 2025](https://blogs.bing.com/maps/2025-06/Bing-Maps-for-Enterprise-Basic-Account-shutdown-June-30,2025),
so no new key can be obtained; only pre-existing paid Enterprise customers continue, until June
2028. Azure Maps is the successor and has a satellite tileset, but needs an Azure subscription.

Esri World Imagery was tested and rejected: it serves a literal *"Map data not yet available"*
placeholder from z14 upward over this corridor, and Esri Clarity's host no longer resolves.
Sentinel-2 cloudless is the only free aerial source with real data over the trail, which is why
it's the one wired up. It is soft at hut-level zoom — 10 m/px is 10 m/px — but it shows lake
shores, snow patches, braided rivers and vegetation that the topo sheet generalises away.

## Where you are

The round button bottom right takes a fix from the **device's own GNSS receiver** and centres the
map on it: a blue dot, always with its accuracy circle, so a poor fix looks poor rather than
falsely precise. **Follow** keeps the map centred as you walk; dragging the map switches it off,
because otherwise the next fix yanks the view back and you cannot look ahead up the valley.

This is not the inReach. The Garmin feed needs the device to have sent a tracking point *and* the
phone to have internet, so on the trail it gives you nothing — while the phone's own receiver
works with no signal at all, in Airplane Mode, as long as Location Services is on.

**Reading the position off the inReach over Bluetooth is not possible**, and not marginally so.
Web Bluetooth has never shipped in Safari, and every iOS browser is WebKit underneath, so no web
page on an iPhone can talk to a BLE device at all. Even where the API exists, the inReach pairs to
Garmin Explore over a proprietary protocol rather than a standard GATT location service.

On-demand by default. A continuous watch is right while walking but keeps the GPS powered, so it
is an explicit toggle rather than something that quietly runs the battery down in a pocket. The
first-fix timeout is 30 s: with no cell assistance the receiver has to pull almanac data off the
satellites, and failing after the usual few seconds would report "unavailable" when it was merely
busy.

## Personal points

*My points*, on the left rail, saves your own marks — a name and an optional description. They
render as yellow stars, deliberately a different shape from every other marker so they never read
as a hut or a SAR point.

There are three ways to place one:

- **Add a point**, then tap the map.
- **Long press** the map — 600 ms, and Leaflet cancels it if the finger moves more than 15 px, so
  a pan or a pinch never triggers one. Right-click does the same on a desktop.
- **Paste position**, for a coordinate copied from elsewhere (below).

Long press needs `-webkit-touch-callout: none` on the map container, and that is not cosmetic:
without it iOS raises its own *Copy / Look Up / Translate* callout over the top and the gesture
appears to do nothing whatsoever. Popup text stays selectable — coordinates and hut notes are
worth copying.

While a point is being placed the whole rail is hidden and a single pill reads *"Tap the map to
place your point"*. The panels are a third of a phone screen wide, and asking someone to tap a map
they cannot see was the original bug here. The panels are hidden with the `hidden` attribute rather
than unmounted, so each one's open/closed state survives — unmounting collapsed the very list the
point had just been added to.

The form itself is a modal (`components/PointDialog.tsx`), not part of the panel. In a rail-width
column with the keyboard up there is essentially nothing left of it. A native `<dialog>` with
`showModal()` brings focus trapping and Escape for free, inputs are 16 px so iOS does not zoom the
page on focus, and the name field is deliberately **not** autofocused: on iOS that throws the
keyboard up over the map before you have checked you tapped the right spot.

They live in `localStorage` and nowhere else. Nothing is uploaded, there is no account, and they
are not carried in the `#zoom/lat/lon` links the rest of the app is built from — a private note
about a campsite should not become shareable by accident. The panel says so in the header badge,
in the collapsed summary line, in a highlighted block when open, and in each point's popup,
because the one thing a user must not be wrong about here is who else can see this.

The cost of that is that the browser holds the only copy. Clearing website data takes them with
it, and — as with the tile cache — **a Home Screen web app has a separate storage jar from the
Safari tab**, so points added in Safari will not appear in the installed app. **Export** writes a
`.geojson` file that opens in any GIS tool; **Import** reads one back.

The export carries each point's `id`, so an export/import round trip restores exactly what was
there — same ids, same timestamps — and importing the same file twice adds nothing. Files from
elsewhere have no such id, so those fall back to matching on name and position to five decimals,
about a metre.

Import only ever **adds**. Replacing outright would let a mistyped file selection destroy the very
marks the user is trying to restore, and there is no undo in a hut. Duplicates are counted and
dropped, non-point features are counted and skipped, and the result is reported in full — *"Added
1 point. 1 already saved, left alone. 2 features skipped — not a point."*

Foreign GeoJSON is accepted deliberately: any FeatureCollection or lone Feature with Point
geometry, taking `name`/`title`/`Name` and `description`/`desc`/`note` as they come. Someone
restoring a backup should not be told their file is the wrong dialect of a format it plainly is.

`loadPoints()` validates every record individually rather than trusting the blob: one malformed
entry, from a hand-edited file or a half-written value, must not take the rest of someone's marks
with it, and must never throw into the map's render path.

### Adding a point from a pasted position

**Paste position** reads a coordinate off the clipboard — Garmin Explore's "copy location", a text
message, anything — and opens the point form there.

The parser is in `lib/coords.ts` and is deliberately liberal, because Explore can be switched
between decimal degrees, degrees-decimal-minutes and degrees-minutes-seconds, and because the
device may not be in English. On a Danish handset Explore emits:

```
N 66.939300°  V 53.643149°
```

**`V` is Vest — west.** Treating an unrecognised hemisphere letter as positive would put the pin
about 107° of longitude away, in Siberia, so the letters are enumerated (`N S E W Ø Ö O V`) and
anything unrecognised is refused rather than guessed at. Comma decimals are handled too, but only
with digits on both sides, so the separator in `66.9393, -53.6431` is not mistaken for one.

Two or four or six numbers mean decimal degrees, degrees-and-minutes, or degrees-minutes-seconds
respectively; anything else is rejected rather than interpreted. When compass letters are present
they decide which value is which, so a longitude-first paste still reads correctly.

The decoded position is always echoed back in full before it is used — reading `V` as east would
be a hundred degrees of wrong with nothing on screen to catch it.

Clipboard reads need permission Safari can simply refuse, so the dialog always offers a field to
paste into by hand; the clipboard is only a shortcut past it.

### Photos

One photo per point, to recognise a spot — *this* is the right gully, *this* is where the ford is.
It shows as a thumbnail in the list and full width in the map popup, which is where it earns its
place.

Photos go in IndexedDB (`lib/photos.ts`), keyed by the point's own id; `localStorage` holds about
5 MB and takes strings only, so one photo there would evict the marks. The original is never kept.
Photos share the origin's storage budget with the downloaded tiles, and a phone photo is 3-5 MB
against the ~200 KB of the two derivatives stored here — a 1280 px copy for the popup and a 160 px
thumbnail. Re-encoding through a canvas also strips EXIF as a side effect, so GPS, timestamp and
device model never reach the disk; orientation is applied before the re-encode, or portrait shots
would come back sideways.

Writes are ordered photo-then-point everywhere, so a saved point can never promise an image that
is not there. `pruneOrphans()` sweeps photos whose point has gone on load, since orphans would
otherwise consume the tile budget invisibly.

### The export format

With no photos, export is the same single `.geojson` as it has always been. With photos it is a
`.zip` — `points.geojson` plus `photos/<id>.jpg`, linked by a `photo` property.

`lib/zip.ts` writes archives with the stored method, no compression: JPEGs are already compressed,
so deflate would spend time to save nothing. It *reads* deflate as well, because someone who
unzips an export and re-zips it with Finder or Explorer gets a deflated archive back.

Import sniffs the leading bytes rather than trusting the extension, so **older plain `.geojson`
exports keep working unchanged**, and a ZIP renamed by a file manager is still read as one.

## Installing it on the iPad, and taking it offline

There is no mobile signal on the trail, so the app is a PWA: it installs to the Home Screen and
serves the whole map — shell, route, tiles — out of its own cache with the network absent.

**Install.** Open the deployed URL in **Safari** (not Chrome — only Safari can install to the iPad
Home Screen), then Share → *Add to Home Screen*. Launched from that icon it runs fullscreen with
no browser chrome, and iPadOS grants it persistent storage, which a plain Safari tab does not
reliably get.

**Download the maps.** Open *Offline maps*, top left. Pick the basemaps, what to cover, the radius
around it, and how much detail.

*Cover* is two independent choices: **the trail**, as a corridor along the route, and **my
points**, as a disc around each of your own marks. They are separate because a fishing lake or a
bail-out road you marked may be nowhere near the route — covering only the corridor would leave
exactly the ground you cared enough to mark as a blank square. Tiles shared between the two are
downloaded once.

Sizes below are for the trail corridor. Personal points add roughly 90 tiles each at z14 with a
3 km radius, less where they overlap the route or each other:

Tile counts at the topo's native z14, exact:

| Corridor | Tiles | Greenland topo | OpenTopoMap |
| --- | --- | --- | --- |
| 500 m | 966 | ~102 MB | ~27 MB |
| 1 km | 1,252 | ~132 MB | ~35 MB |
| 2 km | 1,707 | ~180 MB | ~48 MB |
| 3 km (default) | 2,003 | ~211 MB | ~57 MB |
| 5 km | 2,909 | ~307 MB | ~82 MB |

Sizes assume the measured means of 108 KB per topo tile and 29 KB per OpenTopoMap tile — the topo
is nearly four times the weight because it is served as PNG. The panel shows the estimate for
whatever you have selected before you commit.

### Why z14 is the ceiling

The WMS `GetCapabilities` advertises no `MinScaleDenominator`, no `MaxScaleDenominator` and an
empty metadata URL, so the service will happily render at any zoom and will not tell you where
the data runs out. It has to be measured.

Rendering a 256 m square of ground into 512 px exposes the source pixel grid directly; the
autocorrelation of its edge profile puts the period at 8 px, i.e. **3.74 m/px**. Tiles served at
z15, z16 and z17 independently resolve that same 3.74 m/px — the signature of a server upscaling
a fixed raster. At this latitude 3.74 m/px is exactly one z14 pixel, and it matches a 1:50,000
sheet scanned at roughly 340 dpi.

So `maxNativeZoom` on the topo layer is 14. Leaflet upscales beyond it rather than requesting
tiles the server would only magnify anyway: the same picture, a sixteenth of the requests at z16,
and a z14 download that covers every zoom level offline. Reproduce the measurement with
`scripts/measure-native-resolution.py`.

OpenTopoMap is genuinely native to z17, which is why z15 and z16 remain selectable — they add
real detail there, and nothing at all to the topo.

Do it on hotel wifi, not on a Greenlandic mobile connection. Stopping is safe: tiles already
stored are skipped, so starting again resumes rather than restarts.

**Verify before you fly.** Put the iPad in Airplane Mode, launch from the Home Screen icon, and
pan the whole route. Anything that draws is genuinely on the device. This is worth doing while
you can still fix it.

### How it works

`public/sw.js` keeps three caches. `act-shell-*` and `act-data-*` are versioned and discarded on
upgrade; `act-tiles` deliberately is **not**, so a code deploy never destroys a download that took
an hour to fetch. Live inReach fixes are never cached at all — a stale position rendered as a
current one is worse than no position.

`lib/offline.ts` picks the tiles. A rectangle around the trail would be mostly ocean and icecap —
at z15 that is ~29,000 tiles against ~5,900 for a 3 km corridor — so it walks the route and takes
a disc of tiles around each step.

The tile URLs come from Leaflet's own `getTileUrl`, with `_tileZoom` set per zoom level and the
layer temporarily attached to the map, rather than from a reimplementation of Leaflet's WMS bbox
maths here. The Cache API matches on the exact URL; a bbox differing in the last decimal is a
cache miss. Downloads are plain `fetch()` calls that the service worker intercepts and caches, so
exactly one piece of code decides what a stored tile looks like.

Two details that are load-bearing and easy to lose:

- Tile lookups pass `ignoreVary: true`. Tiles are downloaded with `fetch()`, which sends `Origin`,
  but replayed by Leaflet as `<img src>`, which does not — and EOX answers `Vary: Origin`.
  Honouring Vary would miss every pre-downloaded tile.
- While offline, `maxNativeZoom` is clamped to the depth the download reached. Leaflet draws
  nothing for a tile it cannot fetch, so without this a pinch past the downloaded zoom turns the
  map white, which reads as a failed download rather than as running out of detail. Clamped, it
  upscales stored tiles instead — blurry, but the terrain and route stay on screen. The clamp
  lifts as soon as there is a connection.

### A note on the tile servers

OpenTopoMap and EOX are free, volunteer- and grant-funded services, and OpenTopoMap's usage policy
asks that bulk downloading be kept modest. The corridor is bounded for that reason. Download what
you need for this route and no more.

## Keeping it current

An iOS Home Screen web app **resumes** rather than reloads. It can keep running the JavaScript it
started with for days, so a deploy can sit on the server the whole time while the phone shows the
old app — and the person who asked for the change reasonably concludes it was never made.

`next.config.ts` bakes a build id into the bundle; `/api/version` reports the deployment's. The
page compares them on every return to foreground, hourly while open, and whenever the network
comes back, and offers a **Reload** banner when they differ. Prompted, never automatic: reloading
out from under someone half way through naming a point would lose it. Reloading keeps both the
personal points and the downloaded tiles.

The build id must be **stable across a single build**. Next evaluates the config more than once —
once for the client compile, once for the server — so anything derived from the clock differs
between them and the page reports itself stale against its own deployment. It is Vercel's
deployment id in production and the literal `"dev"` locally, which the banner treats as "no idea"
and stays quiet about.

`/api/version` is excluded from the service worker's caching alongside `/api/inreach`. A cached
answer would keep reporting the old build for as long as it lived, which is exactly the staleness
it exists to detect.

**To force it:** swipe up in the app switcher to quit the installed app, then reopen. After that
the banner handles it.

## Licence

The **code** is MIT — see `LICENSE`. Fork it, deploy it, change it.

The **data and imagery are not the author's to relicense**, and MIT does not reach them:

| | |
| --- | --- |
| `public/act-north-trail.geojson`, `public/ACT-North-Trail.gpx` | Route geometry, stage prose, SAR points and the no-paddle area, derived from the [arcticcircletrail.gl interactive map](https://arcticcircletrail.gl/planning/act-interactive-map/). Included here so the app works out of the box and so the extraction can be checked, with credit to its authors. **Their terms govern any reuse** — if you intend to redistribute it yourself, ask them. `scripts/build-trail.mjs` regenerates it from source. |
| Topographic tiles | © Klimadatastyrelsen, attribution mandatory (see below). Fetched live; nothing is redistributed here. |
| Aerial tiles | EOxCloudless, CC BY-NC-SA 4.0 — **non-commercial only**. |
| `vendor/leaflet-linear-measurement/` | © 2017 New Light Technologies, Inc, 2-clause BSD. Its own `LICENSE` applies. |
| `lib/itinerary.ts`, `ACT-Personal-Itinerary.md` | One hiker's plan, kept as a worked example. Replace it with your own rather than reusing it. |

Tiles you download for offline use are cached on your own device under the terms of whichever
service served them; see [A note on the tile servers](#a-note-on-the-tile-servers).

## Attribution

Topographic map © Klimadatastyrelsen (Dataforsyningen), layer `gl_aabent_land` — attribution is
mandatory under the [terms of use](https://dataforsyningen.dk/asset/PDF/rettigheder_vilkaar/Vilk%C3%A5r%20for%20brug%20af%20frie%20geografiske%20data.pdf).

Aerial imagery: EOxCloudless by EOX IT Services GmbH, contains modified Copernicus Sentinel data
2025, [CC BY-NC-SA 4.0](https://cloudless.eox.at/documentation/license) — non-commercial only,
which this is. Attribution is required and is rendered in the map's attribution control.

Fallback basemap © OpenStreetMap contributors.

## Where things live

Behaviour is described above; this is just the map.

| Path | What it does |
| --- | --- |
| `components/MapLoader.tsx` | Loads `MapView` with `ssr: false`. Leaflet touches `window` at import time. |
| `components/MapView.tsx` | The map, every layer and marker, and the state that ties the panels together. |
| `components/OfflinePanel.tsx` | Tile download UI — coverage, radius, detail, progress. |
| `components/PersonalPoints.tsx` | The saved-points list, export and import. |
| `components/PointDialog.tsx` | The point form, as a modal. |
| `components/CoordinateDialog.tsx` | Paste-a-position fallback when the clipboard is refused. |
| `components/TrackPanel.tsx` | Per-day inReach track toggles. |
| `components/PlanPanel.tsx` | The itinerary. |
| `components/UpdateBanner.tsx` | Notices the running app is older than the deployment. |
| `components/ServiceWorkerRegistrar.tsx` | Registers `public/sw.js`. Renders nothing. |
| `lib/offline.ts` | Corridor tile enumeration, the download engine, storage accounting. |
| `lib/personal-points.ts` | Point storage, validation, GeoJSON export and import. |
| `lib/photos.ts` | Photo store (IndexedDB) and the downscale/EXIF-stripping encode. |
| `lib/zip.ts` | The archive reader and writer, for exports carrying photos. |
| `lib/coords.ts` | Pasted-coordinate parsing, including the Nordic compass letters. |
| `lib/track-days.ts` | Groups the inReach track into local days. |
| `lib/useGeolocate.ts` | The device's own position — on-demand fix and follow. |
| `lib/useInreach.ts` | Polls `/api/inreach`. |
| `lib/inreach.ts` | The shape of that response, shared by route and client. |
| `lib/trail.ts`, `lib/trail-stages.ts` | The extracted route, its stages, SAR points and no-paddle area. |
| `lib/waypoints.ts` | Huts, towns, trailheads, river crossings, and `hashFor`. |
| `lib/itinerary.ts` | The day-by-day plan. |
| `public/sw.js` | The service worker: three caches, and what is never cached. |

## Scripts

```bash
npm run dev        # local dev server
npm run build      # production build
npm run typecheck  # tsc --noEmit
npm run icons      # regenerate the PWA icon set from the trail geometry
npm run measure-topo   # re-measure the topo's native resolution (see "Why z14 is the ceiling")
```

`scripts/build-icons.py` draws the icon from `public/act-north-trail.geojson`, so the Home Screen
icon is the actual shape of the route. It rotates the route onto the diagonal — laid out
east-west it is 165 km across and 25 km tall, and would be a thin band in a square icon. Pure
stdlib; no image library needed.
