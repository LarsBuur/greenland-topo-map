import type { NextRequest } from "next/server";

const UPSTREAM = "https://api.dataforsyningen.dk/wms/gl_aabent_land";

/**
 * Only these WMS parameters are forwarded upstream. An allowlist keeps the
 * proxy from being used as a general-purpose request forwarder, and stops a
 * caller from overriding `token`.
 */
const ALLOWED = new Set([
  "service",
  "request",
  "version",
  "layers",
  "styles",
  "format",
  "transparent",
  "crs",
  "srs",
  "bbox",
  "width",
  "height",
  "bgcolor",
  "exceptions",
  "dpi",
  "map_resolution",
]);

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const token = process.env.DATAFORSYNINGEN_TOKEN;
  if (!token) {
    // The client checks /api/wms-health and shows a banner; this keeps tile
    // requests cheap and unambiguous in the meantime.
    return new Response("Missing DATAFORSYNINGEN_TOKEN", { status: 503 });
  }

  const upstream = new URL(UPSTREAM);
  for (const [key, value] of req.nextUrl.searchParams) {
    if (ALLOWED.has(key.toLowerCase())) upstream.searchParams.set(key, value);
  }
  upstream.searchParams.set("token", token);

  let res: Response;
  try {
    res = await fetch(upstream, {
      headers: { Accept: "image/png,image/*" },
      // Tiles are immutable for a given bbox, so let the CDN keep them.
      next: { revalidate: 86400 },
    });
  } catch {
    return new Response("Upstream WMS unreachable", { status: 502 });
  }

  if (!res.ok) {
    return new Response(`Upstream WMS error ${res.status}`, { status: 502 });
  }

  const contentType = res.headers.get("content-type") ?? "image/png";

  // Dataforsyningen reports auth and request errors as an XML ServiceException
  // with HTTP 200, so a non-image body means the request failed.
  if (!contentType.startsWith("image/")) {
    const body = await res.text();
    return new Response(body.slice(0, 500), {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(res.body, {
    status: 200,
    headers: {
      "content-type": contentType,
      // 30 days in both caches. gl_aabent_land is a 1:50,000 sheet revised
      // rarely, not live data, so the browser copy is the one that matters —
      // it survives redeploys, which reset the CDN cache. To bust it early,
      // add a version parameter to the tile URL in MapView.
      "cache-control": "public, max-age=2592000, s-maxage=2592000, immutable",
    },
  });
}
