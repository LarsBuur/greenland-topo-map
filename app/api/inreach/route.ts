import type { NextRequest } from "next/server";
import type { Fix, InreachResponse } from "@/lib/inreach";

const FEED_BASE = "https://share.garmin.com/Feed/Share";

/** How far back the track is fetched when the caller doesn't say. */
const DEFAULT_TRACK_HOURS = 72;
const MAX_TRACK_HOURS = 24 * 30;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ErrorStatus = Exclude<InreachResponse["status"], "ok">;

function bad(status: ErrorStatus, message: string, http: number) {
  return Response.json({ status, message } satisfies InreachResponse, {
    status: http,
    headers: { "cache-control": "no-store" },
  });
}

export async function GET(req: NextRequest) {
  const shareId = process.env.GARMIN_MAPSHARE_ID;
  if (!shareId) {
    return bad("not-configured", "GARMIN_MAPSHARE_ID is not set.", 503);
  }
  // MapShare feeds are only password-protected if the owner enabled it.
  const password = process.env.GARMIN_MAPSHARE_PASSWORD ?? "";

  const hoursParam = Number(req.nextUrl.searchParams.get("hours"));
  const hours =
    Number.isFinite(hoursParam) && hoursParam > 0
      ? Math.min(hoursParam, MAX_TRACK_HOURS)
      : DEFAULT_TRACK_HOURS;

  const upstream = new URL(`${FEED_BASE}/${encodeURIComponent(shareId)}`);
  upstream.searchParams.set("d1", new Date(Date.now() - hours * 3600_000).toISOString());

  const headers: Record<string, string> = { Accept: "application/vnd.google-earth.kml+xml" };
  if (password) {
    // Garmin uses HTTP Basic with an empty username and the MapShare password.
    headers.Authorization = `Basic ${Buffer.from(`:${password}`).toString("base64")}`;
  }

  let res: Response;
  try {
    res = await fetch(upstream, { headers, cache: "no-store" });
  } catch {
    return bad("upstream-error", "Garmin MapShare is unreachable.", 502);
  }

  if (res.status === 401) {
    return bad(
      "unauthorized",
      "Garmin rejected the MapShare credentials. Check GARMIN_MAPSHARE_PASSWORD.",
      502,
    );
  }
  if (!res.ok) {
    return bad("upstream-error", `Garmin MapShare returned ${res.status}.`, 502);
  }

  const kml = await res.text();
  const track = parseFeed(kml);
  const latest = track.length ? track[track.length - 1] : null;

  return Response.json(
    {
      status: "ok",
      latest,
      track,
      fetchedAt: new Date().toISOString(),
    } satisfies InreachResponse,
    // Garmin's own tracking interval is minutes at best, and the device is on a
    // satellite link — a short shared cache spares the upstream without making
    // the position meaningfully staler than it already is.
    { headers: { "cache-control": "public, max-age=30, s-maxage=60" } },
  );
}

/**
 * Pull the point Placemarks out of a MapShare KML feed, oldest first.
 *
 * The feed is small, machine-generated and structurally stable, so it is picked
 * apart with regexes rather than dragging in an XML parser. Anything without a
 * usable timestamp and coordinate pair is dropped — a truncated or reshaped feed
 * should yield fewer points, never bogus ones.
 *
 * Note that IMEI and the device identifier are deliberately *not* extracted:
 * this response is public, and they are not needed to draw a dot on a map.
 */
function parseFeed(kml: string): Fix[] {
  const fixes: Fix[] = [];

  for (const block of kml.split("<Placemark>").slice(1)) {
    // Track-log Placemarks hold a LineString and no timestamp; skip them, the
    // line is redrawn from the points anyway.
    const coords = /<Point>[\s\S]*?<coordinates>\s*([^<]+?)\s*<\/coordinates>/.exec(block);
    if (!coords) continue;

    const when = /<when>\s*([^<]+?)\s*<\/when>/.exec(block)?.[1];
    if (!when) continue;
    const time = new Date(when);
    if (Number.isNaN(time.getTime())) continue;

    // ExtendedData carries full precision; <coordinates> is the fallback.
    const [lonRaw, latRaw, eleRaw] = coords[1].split(",");
    const lat = num(data(block, "Latitude") ?? latRaw);
    const lon = num(data(block, "Longitude") ?? lonRaw);
    if (lat === null || lon === null) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

    fixes.push({
      name: data(block, "Name") || text(block, "name") || "Unknown",
      time: time.toISOString(),
      lat,
      lon,
      // Values arrive with units attached ("10.46 m from MSL", "0.0 km/h").
      elevation: num(data(block, "Elevation")) ?? num(eleRaw),
      velocity: num(data(block, "Velocity")),
      course: num(data(block, "Course")),
      validFix: (data(block, "Valid GPS Fix") ?? "").toLowerCase() === "true",
      inEmergency: (data(block, "In Emergency") ?? "").toLowerCase() === "true",
      event: data(block, "Event") ?? "",
      text: data(block, "Text") ?? "",
      deviceType: data(block, "Device Type") ?? "",
    });
  }

  fixes.sort((a, b) => a.time.localeCompare(b.time));
  return fixes;
}

/** Value of an `<Data name="…"><value>…</value></Data>` pair. */
function data(block: string, name: string): string | null {
  const re = new RegExp(
    `<Data name="${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">\\s*<value\\s*/>|` +
      `<Data name="${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">\\s*<value>([\\s\\S]*?)</value>`,
  );
  const m = re.exec(block);
  if (!m) return null;
  return decode((m[1] ?? "").trim());
}

function text(block: string, tag: string): string {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
  return m ? decode(m[1].trim()) : "";
}

/** Leading number of a value that may carry a unit suffix. */
function num(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = /-?\d+(?:\.\d+)?/.exec(raw);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function decode(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
