/**
 * Loader for the extracted ACT northern route.
 *
 * The GeoJSON in `public/act-north-trail.geojson` is produced by
 * `scripts/build-trail.mjs` from the arcticcircletrail.gl interactive map. It
 * holds nine stage LineStrings plus the 1 km distance marks as Points.
 */

export type StageProps = {
  kind: "stage";
  order: number;
  label: string;
  km: number;
  labelKm: number | null;
  ascent: number | null;
  descent: number | null;
  description: string;
};

export type MarkProps = { kind: "km"; km: number };

/** A stage with coordinates already flipped to Leaflet's [lat, lon]. */
export type Stage = StageProps & { latlngs: [number, number][] };

export type Mark = { km: number; lat: number; lon: number };

export type Operator = { name: string; url: string };

/** An access / SAR point: where an operator can reach you, and who to call. */
export type SarPoint = {
  name: string;
  lat: number;
  lon: number;
  note: string;
  operators: Operator[];
  /** Set when the source's own popup text states a different position. */
  statedOffByM: number | null;
  stated: { lat: number; lon: number } | null;
};

/** The "Do not paddle here!" area, as Leaflet [lat, lon] rings. */
export type NoPaddle = { label: string; rings: [number, number][][] };

export type Trail = {
  stages: Stage[];
  marks: Mark[];
  sar: SarPoint[];
  noPaddle: NoPaddle[];
  totalKm: number;
};

const URL_PATH = "/act-north-trail.geojson";

/** Fetch and reshape the trail. Throws if the file is missing or malformed. */
export async function loadTrail(signal?: AbortSignal): Promise<Trail> {
  const res = await fetch(URL_PATH, { signal });
  if (!res.ok) throw new Error(`${URL_PATH} -> HTTP ${res.status}`);
  const fc = await res.json();
  if (fc?.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
    throw new Error(`${URL_PATH} is not a FeatureCollection`);
  }

  const stages: Stage[] = [];
  const marks: Mark[] = [];
  const sar: SarPoint[] = [];
  const noPaddle: NoPaddle[] = [];

  for (const f of fc.features) {
    const p = f?.properties;
    if (p?.kind === "stage" && f.geometry?.type === "LineString") {
      stages.push({
        ...(p as StageProps),
        latlngs: (f.geometry.coordinates as [number, number][]).map(
          ([lon, lat]) => [lat, lon] as [number, number],
        ),
      });
    } else if (p?.kind === "km" && f.geometry?.type === "Point") {
      const [lon, lat] = f.geometry.coordinates as [number, number];
      marks.push({ km: (p as MarkProps).km, lat, lon });
    } else if (p?.kind === "sar" && f.geometry?.type === "Point") {
      const [lon, lat] = f.geometry.coordinates as [number, number];
      sar.push({
        name: p.name ?? "Access / SAR point",
        lat,
        lon,
        note: p.note ?? "",
        operators: Array.isArray(p.operators) ? p.operators : [],
        statedOffByM: p.statedOffByM ?? null,
        stated: p.stated ?? null,
      });
    } else if (p?.kind === "nopaddle" && f.geometry?.type === "Polygon") {
      noPaddle.push({
        label: p.label ?? "Do not paddle here!",
        rings: (f.geometry.coordinates as [number, number][][]).map((ring) =>
          ring.map(([lon, lat]) => [lat, lon] as [number, number]),
        ),
      });
    }
  }

  stages.sort((a, b) => a.order - b.order);
  marks.sort((a, b) => a.km - b.km);
  // West to east, matching the walking direction.
  sar.sort((a, b) => a.lon - b.lon);

  return { stages, marks, sar, noPaddle, totalKm: Number(fc.properties?.totalKm ?? 0) };
}

/** The trail line colour, kept away from the categorical waypoint colours. */
export const TRAIL_COLOR = "#9c36b5";
export const MARK_COLOR = "#212529";
/** Safety layers get warning colours: red for SAR, amber for the closed area. */
export const SAR_COLOR = "#e03131";
export const NOPADDLE_COLOR = "#e8590c";

/**
 * The source describes each stage walking east to west (Kangerlussuaq ->
 * Sisimiut). Labels and km numbering here run the other way, so the prose reads
 * back-to-front relative to the stage title.
 */
export const DIRECTION_NOTE =
  "Description is from the source map, which walks the stage in the opposite direction (east to west).";
