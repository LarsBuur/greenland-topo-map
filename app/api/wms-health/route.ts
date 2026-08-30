/**
 * Cheap liveness check for the topo basemap: requests one tiny tile so the
 * client can tell "no token configured" and "token rejected" apart from an
 * ordinary tile hiccup, and show a real message instead of a blank map.
 */
const UPSTREAM = "https://api.dataforsyningen.dk/wms/gl_aabent_land";

export const runtime = "nodejs";
// Must be evaluated at request time, not baked in at build: the answer depends
// on the runtime env var. The CDN still caches it via the cache-control header.
export const dynamic = "force-dynamic";

type Status = "ok" | "no-token" | "rejected" | "unreachable";

export async function GET() {
  const token = process.env.DATAFORSYNINGEN_TOKEN;
  if (!token) {
    return json("no-token", "No Dataforsyningen token is configured on the server.");
  }

  const url = new URL(UPSTREAM);
  url.search = new URLSearchParams({
    token,
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.3.0",
    LAYERS: "gl_aabent_land",
    STYLES: "",
    FORMAT: "image/png",
    TRANSPARENT: "TRUE",
    CRS: "EPSG:3857",
    // A small box over Sisimiut — guaranteed to be inside the coverage area.
    BBOX: "-5975000,10100000,-5970000,10105000",
    WIDTH: "16",
    HEIGHT: "16",
  }).toString();

  try {
    const res = await fetch(url, { headers: { Accept: "image/png" } });
    const contentType = res.headers.get("content-type") ?? "";
    if (res.ok && contentType.startsWith("image/")) {
      return json("ok", "Greenland topo basemap is available.");
    }
    const body = contentType.startsWith("image/") ? "" : await res.text();
    return json(
      "rejected",
      summarise(body) || `Upstream returned HTTP ${res.status}.`,
    );
  } catch {
    return json("unreachable", "Could not reach api.dataforsyningen.dk.");
  }
}

/** Pull the human-readable part out of a WMS ServiceException document. */
function summarise(body: string): string {
  const match = body.match(/<ServiceException[^>]*>([\s\S]*?)<\/ServiceException>/i);
  const text = (match?.[1] ?? body).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, 200);
}

function json(status: Status, message: string) {
  return Response.json(
    { status, message },
    { headers: { "cache-control": "public, s-maxage=300" } },
  );
}
