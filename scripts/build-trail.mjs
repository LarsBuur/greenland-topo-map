/**
 * Extract the ACT Northern Route from the arcticcircletrail.gl interactive map
 * into GeoJSON (for the web map) and GPX (for a GPS or phone).
 *
 * The source is a qgis2web export: static JS files that each declare
 * `var json_<Layer> = { …FeatureCollection… }` in EPSG:4326, [lon, lat].
 *
 * The route arrives as nine hut-to-hut features whose MultiLineString parts are
 * in arbitrary order and orientation, so the parts are chained through a node
 * graph rather than by file order or nearest-neighbour — both of those produce
 * plausible-looking lines with wrong lengths.
 *
 * Run: node scripts/build-trail.mjs [--src <dir>] [--no-simplify]
 * Outputs: public/act-north-trail.geojson, public/ACT-North-Trail.gpx
 *
 * Algorithm and sanity targets: SPEC-extract-ACT-north-gpx.md
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://arcticcircletrail.gl/ACT-interactive-map/data";

const SOURCES = {
  route: ["ACTNorthernRoute_8.js", "json_ACTNorthernRoute_8"],
  huts: ["HutLocations_9.js", "json_HutLocations_9"],
  marks: ["Distancemarks1km_3.js", "json_Distancemarks1km_3"],
  sar: ["AccessSARpoints_10.js", "json_AccessSARpoints_10"],
  noPaddle: ["no_paddle_area_1.js", "json_no_paddle_area_1"],
};

/** Walking order, Sisimiut -> Kangerlussuaq. Names are verbatim from the source. */
const SEGMENT_ORDER = [
  "ACT - Northern Route - Kangerlusarsuk Tulleq - Sisimiut",
  "ACT - Northern Route - Nerumaq - Kangerluarsuk Tulleq",
  "ACT - Northern Route - Innajuattoq - Nerumaq",
  "ACT - Northern Route - Eqalugaarniarfik - Innajuattoq",
  "ACT - Northern Route - Ikkattooq - Eqalugaarniarfik",
  "ACT - Northern Route - Canoe Centre - Ikkattooq",
  "ACT - Northern Route - Kattifik - Canoe Centre",
  "ACT - Northern Route -Kellyville - Katiffik", // no space after "Route -" in the source
  "ACT - Northern Route - Gravel Road to Kellyville",
];

/** Human-facing stage labels, in the same order. */
const SEGMENT_LABELS = [
  "Sisimiut → Kangerluarsuk Tulleq",
  "Kangerluarsuk Tulleq → Nerumaq",
  "Nerumaq → Innajuatooq",
  "Innajuatooq → Eqalugaarniarfik",
  "Eqalugaarniarfik → Ikkattooq",
  "Ikkattooq → Canoe Centre",
  "Canoe Centre → Katiffik",
  "Katiffik → Kellyville",
  "Kellyville → Kangerlussuaq (gravel road)",
];

const START = [-53.6735, 66.9395]; // Sisimiut, the entry point for segment 1

// Tuning constants, all from the spec's verified run.
const STUB_KM = 0.004; // parts shorter than this are zero-length connectors
const NODE_DECIMALS = 5; // endpoint snapping precision for the node graph
const JUNCTION_KM = 0.05; // duplicate point at a segment join
const MARK_ON_ROUTE_KM = 0.12; // how close a distance mark must be to count
const SIMPLIFY_EPS = 0.00005; // Douglas-Peucker tolerance in degrees (~5 m)

// ---------------------------------------------------------------- geometry ---

const R_EARTH = 6371.0088;

function haversine(a, b) {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

function lineLength(coords) {
  let km = 0;
  for (let i = 1; i < coords.length; i++) km += haversine(coords[i - 1], coords[i]);
  return km;
}

/** Perpendicular-distance Douglas-Peucker in degree space; fine at this scale. */
function simplify(coords, eps) {
  if (coords.length < 3) return coords.slice();
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDist = -1;
    let index = -1;
    const [x1, y1] = coords[first];
    const [x2, y2] = coords[last];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const denom = Math.hypot(dx, dy);

    for (let i = first + 1; i < last; i++) {
      const [x, y] = coords[i];
      const d = denom === 0
        ? Math.hypot(x - x1, y - y1)
        : Math.abs(dy * (x - x1) - dx * (y - y1)) / denom;
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > eps && index > first) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

// -------------------------------------------------------------------- load ---

async function loadLayer(dir, [file, varName]) {
  let raw;
  const local = dir ? path.join(dir, file) : null;
  if (local && fs.existsSync(local)) {
    raw = fs.readFileSync(local, "utf8");
  } else {
    const url = `${BASE}/${file}`;
    process.stderr.write(`fetching ${url}\n`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    raw = await res.text();
    if (local) fs.writeFileSync(local, raw);
  }
  const marker = `var ${varName}`;
  const start = raw.indexOf(marker);
  if (start === -1) throw new Error(`${file}: '${marker}' not found`);
  const eq = raw.indexOf("=", start + marker.length);
  const json = raw.slice(eq + 1).trim().replace(/;\s*$/, "");
  const parsed = JSON.parse(json);
  if (parsed?.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    throw new Error(`${file}: not a FeatureCollection`);
  }
  return parsed;
}

// ------------------------------------------------------------------ chaining ---

const nodeKey = (pt) => `${pt[0].toFixed(NODE_DECIMALS)},${pt[1].toFixed(NODE_DECIMALS)}`;

/**
 * Chain one feature's MultiLineString parts into a single polyline, starting at
 * whichever free end lies nearest `entry`.
 */
function chainParts(feature, entry) {
  const g = feature.geometry;
  const rawParts = g.type === "MultiLineString" ? g.coordinates : [g.coordinates];

  const parts = rawParts
    .filter((p) => Array.isArray(p) && p.length >= 2 && lineLength(p) >= STUB_KM);
  const dropped = rawParts.length - parts.length;
  if (parts.length === 0) throw new Error(`${feature.properties.name}: no usable parts`);

  // Undirected multigraph: one edge per part, between its two endpoint nodes.
  const incident = new Map();
  const edges = parts.map((coords, id) => {
    const a = nodeKey(coords[0]);
    const b = nodeKey(coords[coords.length - 1]);
    for (const k of [a, b]) {
      if (!incident.has(k)) incident.set(k, []);
      incident.get(k).push(id);
    }
    return { id, coords, a, b, used: false };
  });

  // Start at the endpoint node closest to the entry point.
  let startNode = null;
  let best = Infinity;
  for (const e of edges) {
    for (const [key, pt] of [[e.a, e.coords[0]], [e.b, e.coords[e.coords.length - 1]]]) {
      const d = haversine(pt, entry);
      if (d < best) {
        best = d;
        startNode = key;
      }
    }
  }

  const chain = [];
  let node = startNode;
  let guard = edges.length + 1;
  while (guard-- > 0) {
    const next = (incident.get(node) ?? []).map((id) => edges[id]).find((e) => !e.used);
    if (!next) break;
    next.used = true;
    // Orient the part so it leaves the current node.
    const coords = next.a === node ? next.coords : next.coords.slice().reverse();
    node = next.a === node ? next.b : next.a;
    for (const pt of coords) {
      if (chain.length === 0 || haversine(chain[chain.length - 1], pt) > 0) chain.push(pt);
    }
  }

  const unused = edges.filter((e) => !e.used).length;
  return { chain, dropped, unused, parts: parts.length };
}

/** Strip the HTML blurb down to readable prose. */
function plainText(html) {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Pull "Ascent: 322m" style figures out of the blurb; the columns are null. */
function metres(html, label) {
  const m = new RegExp(`${label}\\s*:?\\s*</strong>?\\s*([\\d.,]+)\\s*m`, "i").exec(html ?? "");
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Drop the leading title/Distance/Ascent/Descent lines, keeping the prose. */
function description(html) {
  const text = plainText(html);
  return text
    .split("\n")
    .filter((l) => !/^(distance|ascent|descent)\s*:/i.test(l))
    .slice(1) // first line is the stage title, already shown separately
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// -------------------------------------------------------------------- build ---

const args = process.argv.slice(2);
const srcDir = args.includes("--src") ? args[args.indexOf("--src") + 1] : null;
const doSimplify = !args.includes("--no-simplify");

const [routeFC, hutFC, markFC, sarFC, noPaddleFC] = await Promise.all([
  loadLayer(srcDir, SOURCES.route),
  loadLayer(srcDir, SOURCES.huts),
  loadLayer(srcDir, SOURCES.marks),
  loadLayer(srcDir, SOURCES.sar),
  loadLayer(srcDir, SOURCES.noPaddle),
]);

const byName = new Map(routeFC.features.map((f) => [f.properties.name, f]));
const missing = SEGMENT_ORDER.filter((n) => !byName.has(n));
if (missing.length) {
  throw new Error(`segments missing from source (renamed upstream?):\n  ${missing.join("\n  ")}`);
}

const segments = [];
let cursor = START;
const fullChain = [];

console.log("stage                                        parts  drop  unused    km   label");
SEGMENT_ORDER.forEach((name, i) => {
  const feature = byName.get(name);
  const { chain, dropped, unused, parts } = chainParts(feature, cursor);

  // Orient the whole segment so it starts nearest the running cursor.
  const head = haversine(chain[0], cursor);
  const tail = haversine(chain[chain.length - 1], cursor);
  const oriented = tail < head ? chain.slice().reverse() : chain;

  const km = lineLength(oriented);
  const labelKm = feature.properties.dist_km ?? null;
  segments.push({
    order: i + 1,
    label: SEGMENT_LABELS[i],
    sourceName: name,
    coords: oriented,
    km,
    labelKm,
    ascent: metres(feature.properties.text, "Ascent"),
    descent: metres(feature.properties.text, "Descent"),
    description: description(feature.properties.text),
  });

  // Append to the continuous chain. Only the *first* point may duplicate the
  // previous segment's end — testing every point would decimate the track.
  for (let j = 0; j < oriented.length; j++) {
    if (
      j === 0 &&
      fullChain.length &&
      haversine(fullChain[fullChain.length - 1], oriented[j]) < JUNCTION_KM
    ) {
      continue;
    }
    fullChain.push(oriented[j]);
  }
  cursor = oriented[oriented.length - 1];

  const flag = unused ? "  <-- UNUSED PARTS" : "";
  console.log(
    `${String(i + 1).padStart(2)}. ${SEGMENT_LABELS[i].padEnd(40)} ${String(parts).padStart(3)}` +
      ` ${String(dropped).padStart(5)} ${String(unused).padStart(7)} ${km.toFixed(1).padStart(6)}` +
      `   ${labelKm ?? "?"}${flag}`,
  );
});

const rawPoints = fullChain.length;
const rawKm = lineLength(fullChain);
const track = doSimplify ? simplify(fullChain, SIMPLIFY_EPS) : fullChain;
const trackKm = lineLength(track);

// Cumulative distance at each vertex of the *full* chain. Marks are matched
// against the unsimplified geometry: simplification moves vertices by up to the
// tolerance, which is enough to push a mark past the on-route threshold.
const cum = [0];
for (let i = 1; i < fullChain.length; i++) {
  cum.push(cum[i - 1] + haversine(fullChain[i - 1], fullChain[i]));
}

// Keep only the distance marks that sit on this route, and renumber them as
// cumulative km from Sisimiut — the source's own labels restart per sub-section.
const onRoute = [];
for (const f of markFC.features) {
  const pt = f.geometry.type === "MultiPoint" ? f.geometry.coordinates[0] : f.geometry.coordinates;
  if (!pt) continue;
  let best = Infinity;
  let at = 0;
  for (let i = 0; i < fullChain.length; i++) {
    const d = haversine(pt, fullChain[i]);
    if (d < best) {
      best = d;
      at = cum[i];
    }
  }
  if (best <= MARK_ON_ROUTE_KM) onRoute.push({ pt, km: at, dist: best });
}
onRoute.sort((a, b) => a.km - b.km);

const marks = [];
const seenKm = new Set();
for (const m of onRoute) {
  const km = Math.round(m.km);
  if (km <= 0 || seenKm.has(km)) continue;
  seenKm.add(km);
  marks.push({ km, lon: m.pt[0], lat: m.pt[1] });
}

// Access / SAR points: where an operator can reach you, and who to call.
// Each popup text repeats its own coordinates; where that disagrees with the
// plotted geometry the mismatch is carried through rather than silently picked,
// because this is the layer someone reads when things have gone wrong.
const sarPoints = sarFC.features.map((f) => {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  const name = plainText(p.name).replace(/^Access\s*\/\s*SAR point\s*/i, "").trim();

  const m = /coordinates:\s*(-?[\d.]+),\s*(-?[\d.]+)/.exec(p.text ?? "");
  const stated = m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
  const statedOffBy =
    stated && Number.isFinite(stated.lat) && Number.isFinite(stated.lon)
      ? haversine([lon, lat], [stated.lon, stated.lat]) * 1000
      : 0;

  const operators = [];
  const re = /<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
  let hit;
  while ((hit = re.exec(p.text ?? ""))) {
    operators.push({ name: plainText(hit[2]), url: hit[1] });
  }

  // Prose only: drop the coordinate line, the "For transfers…" heading that the
  // popup renders itself, and the operator list items.
  const note = plainText(p.text)
    .split("\n")
    .filter((l) => !/^coordinates\s*:/i.test(l))
    .filter((l) => !/^for transfers and self-rescue\s*:?\s*$/i.test(l.trim()))
    .filter((l) => !l.trim().startsWith("•") && !/^&bullet;/.test(l.trim()))
    .filter((l) => !operators.some((o) => l.trim() === o.name))
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    name,
    lat,
    lon,
    note,
    operators,
    // Only reported when it is a real discrepancy, not float noise.
    statedOffByM: statedOffBy > 50 ? Math.round(statedOffBy) : null,
    stated: statedOffBy > 50 ? stated : null,
  };
});

// The "Do not paddle here!" polygon — bears on the canoe option at Amitsorsuaq.
const noPaddle = noPaddleFC.features
  .filter((f) => f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon")
  .map((f) => ({
    label: plainText(f.properties.text) || "Do not paddle here!",
    // Normalise to a flat list of rings so the client has one shape to handle.
    // A Polygon's coordinates are already rings; a MultiPolygon's are one level
    // deeper (an array of polygons, each an array of rings).
    rings:
      f.geometry.type === "Polygon"
        ? f.geometry.coordinates
        : f.geometry.coordinates.flat(),
  }));

const huts = hutFC.features.map((f) => ({
  name: f.properties.name,
  lon: f.geometry.coordinates[0],
  lat: f.geometry.coordinates[1],
  description: description(f.properties.text) || plainText(f.properties.text),
}));

// ------------------------------------------------------------------ outputs ---

const r6 = (n) => Number(n.toFixed(6));

const geojson = {
  type: "FeatureCollection",
  properties: {
    name: "Arctic Circle Trail — Northern Route",
    source: "https://arcticcircletrail.gl/planning/act-interactive-map/",
    generated: "scripts/build-trail.mjs",
    totalKm: Number(trackKm.toFixed(2)),
  },
  features: [
    ...segments.map((s) => ({
      type: "Feature",
      properties: {
        kind: "stage",
        order: s.order,
        label: s.label,
        km: Number(s.km.toFixed(1)),
        labelKm: s.labelKm,
        ascent: s.ascent,
        descent: s.descent,
        description: s.description,
      },
      geometry: {
        type: "LineString",
        coordinates: (doSimplify ? simplify(s.coords, SIMPLIFY_EPS) : s.coords).map((p) => [
          r6(p[0]),
          r6(p[1]),
        ]),
      },
    })),
    ...marks.map((m) => ({
      type: "Feature",
      properties: { kind: "km", km: m.km },
      geometry: { type: "Point", coordinates: [r6(m.lon), r6(m.lat)] },
    })),
    ...sarPoints.map((s) => ({
      type: "Feature",
      properties: {
        kind: "sar",
        name: s.name,
        note: s.note,
        operators: s.operators,
        statedOffByM: s.statedOffByM,
        stated: s.stated,
      },
      geometry: { type: "Point", coordinates: [r6(s.lon), r6(s.lat)] },
    })),
    ...noPaddle.map((n) => ({
      type: "Feature",
      properties: { kind: "nopaddle", label: n.label },
      geometry: {
        type: "Polygon",
        coordinates: n.rings.map((ring) => ring.map((p) => [r6(p[0]), r6(p[1])])),
      },
    })),
  ],
};

fs.mkdirSync(path.join(ROOT, "public"), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, "public/act-north-trail.geojson"),
  JSON.stringify(geojson) + "\n",
);

// Stage metadata as a typed module: the pages need the numbers and prose without
// pulling in 65 KB of geometry, and generating it keeps the two in step.
const stagesTs = [
  "// GENERATED by scripts/build-trail.mjs — do not edit by hand.",
  "// Source: https://arcticcircletrail.gl/planning/act-interactive-map/",
  "",
  "export type TrailStage = {",
  "  order: number;",
  "  label: string;",
  "  /** Measured length of the extracted geometry, km. */",
  "  km: number;",
  "  /** Length as labelled on the source map, km. */",
  "  labelKm: number | null;",
  "  ascent: number | null;",
  "  descent: number | null;",
  "  description: string;",
  "};",
  "",
  `/** Total measured length of the northern route, km. */`,
  `export const TRAIL_TOTAL_KM = ${Number(trackKm.toFixed(2))};`,
  "",
  `/** Number of 1 km distance marks on the route. */`,
  `export const TRAIL_MARK_COUNT = ${marks.length};`,
  "",
  "export const TRAIL_STAGES: TrailStage[] = [",
  ...segments.map(
    (s) =>
      "  " +
      JSON.stringify({
        order: s.order,
        label: s.label,
        km: Number(s.km.toFixed(1)),
        labelKm: s.labelKm,
        ascent: s.ascent,
        descent: s.descent,
        description: s.description,
      }) +
      ",",
  ),
  "];",
  "",
  "export type TrailSarPoint = {",
  "  name: string;",
  "  lat: number;",
  "  lon: number;",
  "  note: string;",
  "  operators: { name: string; url: string }[];",
  "  /** Set when the source's own popup text states a different position. */",
  "  statedOffByM: number | null;",
  "  stated: { lat: number; lon: number } | null;",
  "};",
  "",
  "/** Access / SAR points, west to east (walking direction). */",
  "export const TRAIL_SAR: TrailSarPoint[] = [",
  ...[...sarPoints]
    .sort((a, b) => a.lon - b.lon)
    .map(
      (s) =>
        "  " +
        JSON.stringify({
          name: s.name,
          lat: r6(s.lat),
          lon: r6(s.lon),
          note: s.note,
          operators: s.operators,
          statedOffByM: s.statedOffByM,
          stated: s.stated,
        }) +
        ",",
    ),
  "];",
  "",
].join("\n");

fs.writeFileSync(path.join(ROOT, "lib/trail-stages.ts"), stagesTs);

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c],
  );

const gpx = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<gpx version="1.1" creator="act-map scripts/build-trail.mjs"',
  '     xmlns="http://www.topografix.com/GPX/1/1"',
  '     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
  '     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
  "  <metadata>",
  "    <name>Arctic Circle Trail - Northern Route</name>",
  `    <desc>Sisimiut to Kangerlussuaq, ${trackKm.toFixed(1)} km. Track, ${huts.length} huts, ${sarPoints.length} access/SAR points and ${marks.length} 1 km distance marks. Source: arcticcircletrail.gl interactive map.</desc>`,
  '    <link href="https://arcticcircletrail.gl/planning/act-interactive-map/"><text>arcticcircletrail.gl</text></link>',
  "  </metadata>",
  ...huts.flatMap((h) => [
    `  <wpt lat="${r6(h.lat)}" lon="${r6(h.lon)}">`,
    `    <name>${esc(h.name)}</name>`,
    ...(h.description ? [`    <desc>${esc(h.description)}</desc>`] : []),
    "    <sym>Lodge</sym>",
    "    <type>Hut</type>",
    "  </wpt>",
  ]),
  // SAR points first, so they sit near the top of a GPS waypoint list.
  ...sarPoints.flatMap((s) => [
    `  <wpt lat="${r6(s.lat)}" lon="${r6(s.lon)}">`,
    `    <name>SAR ${esc(s.name)}</name>`,
    `    <desc>${esc(
      [
        "Access / SAR point.",
        s.note,
        s.operators.length ? `Operators: ${s.operators.map((o) => o.name).join(", ")}.` : "",
        s.statedOffByM
          ? `NOTE: source popup states ${s.stated.lat}, ${s.stated.lon} — ${s.statedOffByM} m from this position.`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    )}</desc>`,
    "    <sym>Flag, Blue</sym>",
    "    <type>Access / SAR point</type>",
    "  </wpt>",
  ]),
  ...marks.flatMap((m) => [
    `  <wpt lat="${r6(m.lat)}" lon="${r6(m.lon)}">`,
    `    <name>KM ${m.km}</name>`,
    `    <desc>${m.km} km from Sisimiut along the Northern Route.</desc>`,
    "    <sym>Milepost</sym>",
    "    <type>Distance mark</type>",
    "  </wpt>",
  ]),
  "  <trk>",
  "    <name>ACT Northern Route (Sisimiut -> Kangerlussuaq)</name>",
  "    <trkseg>",
  ...track.map((p) => `      <trkpt lat="${r6(p[1])}" lon="${r6(p[0])}"></trkpt>`),
  "    </trkseg>",
  "  </trk>",
  "</gpx>",
  "",
].join("\n");

fs.writeFileSync(path.join(ROOT, "public/ACT-North-Trail.gpx"), gpx);

// ----------------------------------------------------------------- summary ---

const first = track[0];
const last = track[track.length - 1];
const segSum = segments.reduce((a, s) => a + s.km, 0);
const labelSum = segments.reduce((a, s) => a + (s.labelKm ?? 0), 0);

console.log("\n--- results ---");
console.log(`chained points     ${rawPoints} -> ${track.length} after simplify`);
console.log(`length             ${rawKm.toFixed(2)} km -> ${trackKm.toFixed(2)} km`);
console.log(`sum of segments    ${segSum.toFixed(2)} km (source labels total ${labelSum})`);
console.log(`first point        [${r6(first[0])}, ${r6(first[1])}]`);
console.log(`last point         [${r6(last[0])}, ${r6(last[1])}]`);
console.log(`huts               ${huts.length}`);
console.log(`access/SAR points  ${sarPoints.length}`);
for (const s of sarPoints) {
  const warn = s.statedOffByM
    ? `  <-- popup text states a position ${s.statedOffByM} m away`
    : "";
  console.log(`                   ${s.name.padEnd(28)} ${s.operators.length} operators${warn}`);
}
console.log(
  `no-paddle area     ${noPaddle.length} polygon(s), ${noPaddle.reduce(
    (a, n) => a + n.rings.reduce((b, r) => b + r.length, 0),
    0,
  )} vertices`,
);
console.log(`distance marks     ${marks.length} on route (KM ${marks[0]?.km} … KM ${marks[marks.length - 1]?.km})`);
console.log(`                   of ${markFC.features.length} in the source layer`);
console.log(
  `\nwrote public/act-north-trail.geojson (${(
    fs.statSync(path.join(ROOT, "public/act-north-trail.geojson")).size / 1024
  ).toFixed(0)} KB)`,
);
console.log(
  `wrote public/ACT-North-Trail.gpx (${(
    fs.statSync(path.join(ROOT, "public/ACT-North-Trail.gpx")).size / 1024
  ).toFixed(0)} KB)`,
);
