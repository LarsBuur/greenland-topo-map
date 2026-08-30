/**
 * Offline map downloads.
 *
 * There is no mobile signal on the Arctic Circle Trail, so the map has to be on
 * the iPad before leaving town. This module works out which tiles cover a
 * corridor around the route, then pulls them through the service worker so they
 * land in the same cache Leaflet will later read from.
 *
 * Two things make that reliable:
 *
 *  - Tile URLs are produced by Leaflet's own `getTileUrl`, not by a
 *    reimplementation here. The Cache API matches on the exact URL, and a WMS
 *    request carries a computed bounding box; a bbox that differs in the last
 *    decimal is a different URL and a cache miss. Asking the real layer removes
 *    that whole class of bug.
 *  - The download is a plain `fetch()`. The service worker intercepts it and
 *    caches the response, so there is exactly one piece of code deciding what a
 *    cached tile looks like.
 */

// A value import, not just a type: tile coordinates have to be handed to
// Leaflet as real `L.Point`s. Safe because every importer of this module is a
// client component rendered under `MapLoader`'s `ssr: false`, so Leaflet — which
// touches `window` at import time — never loads on the server.
import L from "leaflet";
import type { Trail } from "./trail";

export const TILE_CACHE = "act-tiles";

/** Lowest zoom worth storing — the whole of west Greenland is a handful of tiles. */
export const MIN_ZOOM = 6;

export type TileCoords = { x: number; y: number; z: number };

export type DownloadProgress = {
  done: number;
  total: number;
  cached: number;
  failed: number;
  bytes: number;
};

export type LayerSpec = {
  id: string;
  label: string;
  note?: string;
  layer: L.TileLayer;
  /** Cap imposed by the source; requesting deeper just upscales mush. */
  maxNativeZoom: number;
  /**
   * Mean tile weight, measured from a real download of this corridor. Per
   * layer because they differ by more than threefold — the topo PNGs average
   * 108 KB against roughly 29 KB for OpenTopoMap — and a single global figure
   * would have quoted a 300 MB download that arrived as 900 MB.
   */
  bytesPerTile: number;
};

/* -------------------------------------------------------------------------- */
/* Tile geometry                                                              */
/* -------------------------------------------------------------------------- */

function lonToTileX(lon: number, z: number) {
  return ((lon + 180) / 360) * 2 ** z;
}

function latToTileY(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

/** Ground size of one tile, in metres, at the given latitude and zoom. */
function tileMetres(lat: number, z: number) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180) * 256) / 2 ** z;
}

/**
 * Every tile within `radiusKm` of the route at zoom `z`.
 *
 * A rectangle around the whole trail would be mostly ocean and icecap — at z15
 * that is ~29,000 tiles against ~5,900 for a 3 km corridor. Walking the line
 * and taking a disc of tiles around each step keeps the download to the ground
 * a hiker can actually see.
 */
export function corridorTiles(trail: Trail, z: number, radiusKm: number): TileCoords[] {
  return regionTiles({ trail, points: [], radiusKm }, z);
}

/**
 * What the download should cover.
 *
 * The trail corridor and the user's own points are independent: a fishing lake
 * or a bail-out road they marked may be nowhere near the route, and downloading
 * the corridor would leave exactly the ground they cared enough to mark as a
 * blank square.
 */
export type Region = {
  /** Include a corridor along the route. Null to leave the trail out. */
  trail: Trail | null;
  /** Include a disc around each of these. Empty to leave them out. */
  points: { lat: number; lon: number }[];
  radiusKm: number;
};

/** Cheap identity for the cache — a handful of points, rounded to ~10 m. */
function regionKey(region: Region, z: number): string {
  const pts = region.points
    .map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`)
    .sort()
    .join(";");
  return `${z}:${region.radiusKm}:${region.trail ? "t" : ""}:${pts}`;
}

/**
 * Every tile within `radiusKm` of the requested ground.
 *
 * A rectangle around the whole trail would be mostly ocean and icecap — at z15
 * that is ~29,000 tiles against ~5,900 for a 3 km corridor. Walking the line
 * and taking a disc of tiles around each step keeps the download to the ground
 * a hiker can actually see.
 */
export function regionTiles(region: Region, z: number): TileCoords[] {
  const cacheKey = regionKey(region, z);
  const cached = corridorCache.get(cacheKey);
  if (cached) return cached;

  const span = 2 ** z;
  const midLat =
    region.trail?.stages[0]?.latlngs[0]?.[0] ?? region.points[0]?.lat ?? 67;
  const radiusTiles = Math.max(1, Math.ceil((region.radiusKm * 1000) / tileMetres(midLat, z)));
  const r2 = radiusTiles * radiusTiles;

  // Collect centres first, dilate once. Walking the route densely produces the
  // same tile over and over — at z16 roughly 1,400 steps land on ~700 distinct
  // tiles — and dilating each by a 27x27 disc is where all the work is.
  // Collapsing the centres first roughly halves it, and keeps the estimate
  // responsive enough to recompute while the user is still poking at options.
  const centreKeys = new Set<number>();
  const pushCentre = (x: number, y: number) => {
    if (y < 0 || y >= span) return;
    centreKeys.add(y * span + (((x % span) + span) % span));
  };

  for (const stage of region.trail?.stages ?? []) {
    let prev: { x: number; y: number } | null = null;
    for (const [lat, lon] of stage.latlngs) {
      const cur = { x: lonToTileX(lon, z), y: latToTileY(lat, z) };
      if (prev) {
        // Half-tile steps, so no gap is left between vertices that are far
        // apart at high zoom.
        const steps = Math.max(1, Math.ceil(Math.hypot(cur.x - prev.x, cur.y - prev.y) * 2));
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          pushCentre(
            Math.floor(prev.x + (cur.x - prev.x) * t),
            Math.floor(prev.y + (cur.y - prev.y) * t),
          );
        }
      } else {
        pushCentre(Math.floor(cur.x), Math.floor(cur.y));
      }
      prev = cur;
    }
  }

  for (const p of region.points) {
    pushCentre(Math.floor(lonToTileX(p.lon, z)), Math.floor(latToTileY(p.lat, z)));
  }

  const seen = new Set<number>();
  const out: TileCoords[] = [];
  for (const key of centreKeys) {
    const cx = key % span;
    const cy = (key - cx) / span;
    for (let dy = -radiusTiles; dy <= radiusTiles; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= span) continue;
      for (let dx = -radiusTiles; dx <= radiusTiles; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const x = ((((cx + dx) % span) + span) % span);
        const k = y * span + x;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ x, y, z });
      }
    }
  }

  rememberCorridor(cacheKey, out);
  return out;
}

/**
 * Memoised corridors, keyed by zoom and radius.
 *
 * The result depends only on the route, the zoom and the radius — never on
 * which basemap is being downloaded — so three selected basemaps share one
 * computation, and flipping an option back and forth is free. Bounded because a
 * single z16 corridor is tens of thousands of objects.
 */
const CORRIDOR_CACHE_MAX = 14;
const corridorCache = new Map<string, TileCoords[]>();

function rememberCorridor(key: string, tiles: TileCoords[]) {
  corridorCache.set(key, tiles);
  while (corridorCache.size > CORRIDOR_CACHE_MAX) {
    const oldest = corridorCache.keys().next().value;
    if (oldest === undefined) break;
    corridorCache.delete(oldest);
  }
}

/** Tile zooms actually fetched for a layer, given the deepest zoom requested. */
export function zoomRange(spec: LayerSpec, maxZoom: number): number[] {
  const top = Math.min(maxZoom, spec.maxNativeZoom);
  const zooms: number[] = [];
  for (let z = MIN_ZOOM; z <= top; z++) zooms.push(z);
  return zooms;
}

/* -------------------------------------------------------------------------- */
/* URL generation                                                             */
/* -------------------------------------------------------------------------- */

/** Leaflet internals this module leans on deliberately. */
type PrivateTileLayer = L.TileLayer & {
  _map: L.Map | null | undefined;
  _tileZoom: number | undefined;
  getTileUrl(coords: L.Point & { z: number }): string;
};

/**
 * Leaflet's tile coordinate: an `L.Point` carrying an extra `z`.
 *
 * It has to be a real Point — `getTileUrl` calls `coords.scaleBy()` on the way
 * to computing a WMS bounding box, which a plain `{x, y, z}` object cannot do.
 */
function toLeafletCoords(t: TileCoords): L.Point & { z: number } {
  const p = L.point(t.x, t.y) as L.Point & { z: number };
  p.z = t.z;
  return p;
}

/**
 * Collect tile URLs from the layer itself.
 *
 * `getTileUrl` reads the *current* zoom out of `_tileZoom` rather than taking
 * it from the coordinates, so it is set per zoom level here. The layer also has
 * to be attached to a map — WMS needs the CRS and the projection to compute a
 * bbox — so a layer the user has not selected is attached invisibly for the few
 * milliseconds this takes, then detached.
 */
export function tileUrls(
  spec: LayerSpec,
  map: L.Map,
  tilesByZoom: Map<number, TileCoords[]>,
): string[] {
  const layer = spec.layer as PrivateTileLayer;
  const wasAttached = map.hasLayer(layer);
  const previousZoom = layer._tileZoom;
  const previousOpacity = layer.options.opacity ?? 1;

  if (!wasAttached) {
    layer.setOpacity(0);
    layer.addTo(map);
  }

  try {
    const urls: string[] = [];
    for (const [z, tiles] of tilesByZoom) {
      layer._tileZoom = z;
      for (const t of tiles) urls.push(layer.getTileUrl(toLeafletCoords(t)));
    }
    return urls;
  } finally {
    layer._tileZoom = previousZoom;
    if (!wasAttached) {
      map.removeLayer(layer);
      layer.setOpacity(previousOpacity);
    }
  }
}

/** Build the full de-duplicated URL list for one layer. */
export function planLayer(
  spec: LayerSpec,
  map: L.Map,
  region: Region,
  maxZoom: number,
): string[] {
  const byZoom = new Map<number, TileCoords[]>();
  for (const z of zoomRange(spec, maxZoom)) byZoom.set(z, regionTiles(region, z));
  return [...new Set(tileUrls(spec, map, byZoom))];
}

/** Tile count only — cheap enough to run on every slider move. */
export function planSize(spec: LayerSpec, region: Region, maxZoom: number): number {
  let n = 0;
  for (const z of zoomRange(spec, maxZoom)) n += regionTiles(region, z).length;
  return n;
}

/* -------------------------------------------------------------------------- */
/* Download                                                                   */
/* -------------------------------------------------------------------------- */

/** Parallel requests. Kept low: Safari's per-host cap, and politeness. */
const CONCURRENCY = 6;

export type DownloadOptions = {
  signal: AbortSignal;
  onProgress: (p: DownloadProgress) => void;
};

/**
 * Fetch every URL, letting the service worker do the caching.
 *
 * Already-cached tiles are skipped without touching the network, so re-running
 * a download after a dropped connection resumes rather than starts over.
 */
export async function downloadTiles(urls: string[], opts: DownloadOptions) {
  const cache = await caches.open(TILE_CACHE);
  const progress: DownloadProgress = {
    done: 0,
    total: urls.length,
    cached: 0,
    failed: 0,
    bytes: 0,
  };

  let next = 0;
  let lastReport = 0;

  const report = (force = false) => {
    const now = Date.now();
    if (!force && now - lastReport < 120) return;
    lastReport = now;
    opts.onProgress({ ...progress });
  };

  const worker = async () => {
    while (next < urls.length) {
      if (opts.signal.aborted) return;
      const url = urls[next++];

      try {
        // See the service worker: matching on URL alone is deliberate.
        const hit = await cache.match(url, { ignoreVary: true });
        if (hit) {
          progress.cached++;
        } else {
          const res = await fetch(url, { signal: opts.signal });
          if (res.ok) {
            const blob = await res.blob();
            progress.bytes += blob.size;
          } else {
            progress.failed++;
          }
        }
      } catch {
        if (opts.signal.aborted) return;
        progress.failed++;
      }

      progress.done++;
      report();
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  report(true);
  return progress;
}

/* -------------------------------------------------------------------------- */
/* Cache housekeeping                                                         */
/* -------------------------------------------------------------------------- */

export type StorageStats = {
  tiles: number;
  usage: number | null;
  quota: number | null;
  persisted: boolean;
};

export async function storageStats(): Promise<StorageStats> {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  return {
    tiles: keys.length,
    usage: estimate?.usage ?? null,
    quota: estimate?.quota ?? null,
    persisted,
  };
}

export async function clearTiles() {
  await caches.delete(TILE_CACHE);
}

/**
 * Ask for persistent storage.
 *
 * Without it the browser may evict the whole download to reclaim space — which,
 * on a trail with no signal, means there is no way to get it back. Home-screen
 * web apps are normally granted this without a prompt.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

/* -------------------------------------------------------------------------- */
/* Offline zoom clamp                                                         */
/* -------------------------------------------------------------------------- */

const DEPTH_KEY = "act-offline-maxzoom";

/**
 * Remember how deep the download went.
 *
 * Leaflet draws nothing for a tile it cannot fetch, so without this, pinching
 * past the downloaded zoom on the trail turns the map white — the single worst
 * way for it to fail, because it looks like the download never happened. Given
 * the depth, the layers can instead be told to stop requesting deeper tiles and
 * upscale the ones already stored.
 */
export function rememberDepth(z: number) {
  try {
    const prev = readDepth();
    localStorage.setItem(DEPTH_KEY, String(prev === null ? z : Math.max(prev, z)));
  } catch {
    // Private browsing, or storage full. The clamp is a nicety, not load-bearing.
  }
}

export function readDepth(): number | null {
  try {
    const raw = localStorage.getItem(DEPTH_KEY);
    if (raw === null) return null;
    const z = Number(raw);
    return Number.isFinite(z) && z >= MIN_ZOOM ? z : null;
  } catch {
    return null;
  }
}

export function forgetDepth() {
  try {
    localStorage.removeItem(DEPTH_KEY);
  } catch {
    // As above.
  }
}

export function formatBytes(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
