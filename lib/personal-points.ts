/**
 * Personal points — the user's own marks on the map.
 *
 * These live in `localStorage` and nowhere else. Nothing is sent to a server,
 * there is no account, and no other device can see them. That is a deliberate
 * property, not an unfinished feature: the whole app is otherwise made of
 * shareable links, and a private note about a campsite or a river crossing
 * should not become one by accident.
 *
 * The flip side is that the browser owns the only copy. Clearing website data,
 * or iPadOS reclaiming storage, takes them with it — which is why export exists
 * and why the panel says so in plain words rather than burying it.
 */

export type PersonalPoint = {
  id: string;
  name: string;
  /** Optional free text. Empty string is normalised away to undefined. */
  desc?: string;
  lat: number;
  lon: number;
  /** ISO 8601, UTC. */
  created: string;
  /**
   * A photo is held in IndexedDB under this same point's id — see lib/photos.
   * Only the flag lives here, so the marks stay a small synchronous read.
   */
  hasPhoto?: boolean;
};

import { makeZip, type ZipEntry } from "./zip";

const KEY = "act-personal-points";
const VERSION = 1;

/** The stored envelope. Versioned so a future shape change can migrate rather than discard. */
type Stored = { version: number; points: PersonalPoint[] };

export const PRIVACY_NOTE =
  "Your points are stored only in this browser, on this device. They are never uploaded, " +
  "they are not part of any link you share, and nobody else can see them.";

function isPoint(v: unknown): v is PersonalPoint {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    typeof p.lat === "number" &&
    typeof p.lon === "number" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lon >= -180 &&
    p.lon <= 180 &&
    (p.desc === undefined || typeof p.desc === "string") &&
    (p.hasPhoto === undefined || typeof p.hasPhoto === "boolean") &&
    typeof p.created === "string"
  );
}

/**
 * Read the saved points.
 *
 * Every entry is validated individually: a single malformed record — from a
 * hand-edited export, or a half-written value after the tab was killed — must
 * not take the rest of someone's marks down with it, and must never throw into
 * the map's render path.
 */
export function loadPoints(): PersonalPoint[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    const list =
      parsed && typeof parsed === "object" && Array.isArray((parsed as Stored).points)
        ? (parsed as Stored).points
        : Array.isArray(parsed)
          ? parsed // tolerate a bare array, in case an early version wrote one
          : [];
    return (list as unknown[]).filter(isPoint);
  } catch {
    return [];
  }
}

/** Persist. Returns false when the browser refused — quota, or private mode. */
export function savePoints(points: PersonalPoint[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: VERSION, points } satisfies Stored));
    return true;
  } catch {
    return false;
  }
}

function newId(): string {
  // randomUUID needs a secure context; the fallback keeps this working if the
  // page is ever opened over plain http on a local network.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function makePoint(input: {
  name: string;
  desc?: string;
  lat: number;
  lon: number;
}): PersonalPoint {
  const desc = input.desc?.trim();
  return {
    id: newId(),
    name: input.name.trim() || "Untitled point",
    ...(desc ? { desc } : {}),
    lat: input.lat,
    lon: input.lon,
    created: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * GeoJSON, in the same shape as the trail file the app already reads.
 *
 * Coordinates are [lon, lat] — GeoJSON's order, the reverse of Leaflet's — and
 * rounded to six decimals, which is about 4 cm here and well past what any of
 * these positions are actually known to.
 */
export function toGeoJSON(points: PersonalPoint[]) {
  return {
    type: "FeatureCollection" as const,
    features: points.map((p) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))],
      },
      properties: {
        // Carried so that re-importing this file restores the same points
        // rather than duplicating them. Random UUIDs; they say nothing about
        // the user.
        id: p.id,
        name: p.name,
        ...(p.desc ? { description: p.desc } : {}),
        // A path into the archive alongside this file. Harmless in a plain
        // GeoJSON export — other tools ignore it — and the link import needs.
        ...(p.hasPhoto ? { photo: photoPath(p.id) } : {}),
        created: p.created,
        source: "ACT map — personal point",
      },
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Import                                                                     */
/* -------------------------------------------------------------------------- */

/** Where a point's photo lives inside an exported archive. */
export function photoPath(pointId: string): string {
  return `photos/${pointId}.jpg`;
}

/** Name of the GeoJSON member inside an exported archive. */
export const ARCHIVE_GEOJSON = "points.geojson";

export type ImportResult = {
  /** Points not already present, ready to be merged. */
  fresh: PersonalPoint[];
  /**
   * Archive paths of photos for the fresh points, by point id. Empty for a
   * plain `.geojson` import, which carries no images.
   */
  photoPaths: Map<string, string>;
  /** Already held, matched by id or by name and position. */
  duplicates: number;
  /** Features that were not usable points — lines, polygons, bad coordinates. */
  skipped: number;
};

export class ImportError extends Error {}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * Identity for de-duplication when no id matches.
 *
 * Five decimals is about a metre here — close enough that two marks at the same
 * name and place are the same mark, and far finer than anything placed by
 * tapping a screen.
 */
function fingerprint(p: { name: string; lat: number; lon: number }): string {
  return `${p.name.toLowerCase()}|${p.lat.toFixed(5)}|${p.lon.toFixed(5)}`;
}

/**
 * Read points out of a GeoJSON file.
 *
 * Accepts this app's own export first and foremost, but deliberately tolerates
 * files from elsewhere: any FeatureCollection (or lone Feature) with Point
 * geometry, taking whichever of the conventional property names is present.
 * Someone restoring a backup in a hut should not be told their file is the
 * wrong dialect of a format it plainly is.
 *
 * Non-point features are counted and skipped rather than treated as failure —
 * importing the waypoints out of a mixed file is a perfectly good outcome.
 */
export function parseGeoJSON(text: string, existing: PersonalPoint[]): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError("That file is not valid JSON.");
  }

  const root = data as Record<string, unknown> | null;
  if (!root || typeof root !== "object") throw new ImportError("That file is not GeoJSON.");

  const features: unknown[] =
    root.type === "FeatureCollection" && Array.isArray(root.features)
      ? root.features
      : root.type === "Feature"
        ? [root]
        : [];

  if (features.length === 0) {
    throw new ImportError("No GeoJSON features found in that file.");
  }

  const usedIds = new Set(existing.map((p) => p.id));
  const seen = new Set(existing.map(fingerprint));
  const fresh: PersonalPoint[] = [];
  const photoPaths = new Map<string, string>();
  let duplicates = 0;
  let skipped = 0;

  for (const raw of features) {
    const f = raw as Record<string, unknown> | null;
    const geom = f?.geometry as Record<string, unknown> | undefined;
    const coords = geom?.coordinates;

    if (geom?.type !== "Point" || !Array.isArray(coords) || coords.length < 2) {
      skipped++;
      continue;
    }

    const [lon, lat] = coords as unknown[];
    if (
      typeof lon !== "number" ||
      typeof lat !== "number" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      skipped++;
      continue;
    }

    const props = (f?.properties ?? {}) as Record<string, unknown>;
    const name =
      str(props.name) ?? str(props.title) ?? str(props.Name) ?? `Imported point ${fresh.length + 1}`;
    const desc = str(props.description) ?? str(props.desc) ?? str(props.note);

    const id = str(props.id);
    const print = fingerprint({ name, lat, lon });
    if ((id && usedIds.has(id)) || seen.has(print)) {
      duplicates++;
      continue;
    }

    const point: PersonalPoint = {
      // Keep the file's id when it is free, so an export/import round trip is
      // exact and a second import of the same file adds nothing.
      id: id && !usedIds.has(id) ? id : newId(),
      name,
      ...(desc ? { desc } : {}),
      lat,
      lon,
      created: str(props.created) ?? new Date().toISOString(),
    };

    usedIds.add(point.id);
    seen.add(print);
    fresh.push(point);

    // Recorded against the point's *new* id, which may differ from the one in
    // the file; the caller resolves the path against the archive's contents.
    const photo = str(props.photo);
    if (photo) photoPaths.set(point.id, photo);
  }

  if (!fresh.length && !duplicates) {
    throw new ImportError(
      skipped
        ? `No points in that file — ${skipped} feature${skipped === 1 ? " was" : "s were"} not a point.`
        : "No points found in that file.",
    );
  }

  return { fresh, photoPaths, duplicates, skipped };
}

/** Local YYYY-MM-DD, so the filename matches the day the user is actually having. */
function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function exportFileName(withPhotos: boolean, now: Date = new Date()): string {
  return `act-personal-points-${localDate(now)}.${withPhotos ? "zip" : "geojson"}`;
}

/**
 * Build the export.
 *
 * A plain `.geojson` when there are no photos — the same single file as before,
 * readable by any GIS tool. A `.zip` when there are, holding that same GeoJSON
 * plus one JPEG per photographed point. Photos would otherwise have no way off
 * the device at all.
 */
export async function buildExport(
  points: PersonalPoint[],
  loadPhoto: (id: string) => Promise<Blob | null>,
): Promise<{ blob: Blob; name: string }> {
  const photographed = points.filter((p) => p.hasPhoto);
  const geojson = JSON.stringify(toGeoJSON(points), null, 2);

  if (!photographed.length) {
    return {
      blob: new Blob([geojson], { type: "application/geo+json" }),
      name: exportFileName(false),
    };
  }

  const entries: ZipEntry[] = [
    { name: ARCHIVE_GEOJSON, data: new TextEncoder().encode(geojson) },
  ];
  for (const p of photographed) {
    const blob = await loadPhoto(p.id);
    // A missing image must not abort the whole export — the marks matter more
    // than the picture, and the GeoJSON still describes every one of them.
    if (!blob) continue;
    entries.push({ name: photoPath(p.id), data: new Uint8Array(await blob.arrayBuffer()) });
  }

  return { blob: makeZip(entries), name: exportFileName(true) };
}

/** Hand a built export to the browser as a download. */
export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick: Safari has been known to cancel the download if
  // the object URL disappears synchronously.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
