/*
 * Service worker for the ACT map.
 *
 * The point of this file is a hiker standing on the Arctic Circle Trail with no
 * signal: the app shell, the route data and every map tile that was downloaded
 * beforehand must come out of the cache with the network entirely absent.
 *
 * Three caches, deliberately separate:
 *   shell — HTML and hashed /_next/static assets. Cheap, thrown away on upgrade.
 *   data  — the trail GeoJSON/GPX. Small, stale-while-revalidate.
 *   tiles — map imagery. Large, expensive to refetch, and explicitly NOT
 *           versioned: a code deploy must never wipe a 300 MB tile download
 *           that took an hour over hotel wifi.
 *
 * Live inReach positions are deliberately never cached. A stale fix rendered as
 * a live one is worse than no fix at all.
 */

const VERSION = "v1";
const SHELL_CACHE = `act-shell-${VERSION}`;
const DATA_CACHE = `act-data-${VERSION}`;
const TILE_CACHE = "act-tiles"; // unversioned on purpose — see above
const KEEP = new Set([SHELL_CACHE, DATA_CACHE, TILE_CACHE]);

/** Pages whose HTML and referenced bundles are pulled in at install time. */
const SHELL_PAGES = ["/", "/links"];

const STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

const DATA_ASSETS = ["/act-north-trail.geojson", "/ACT-North-Trail.gpx"];

/** Tile hosts that may be cached. Anything else is left to the network. */
const TILE_HOSTS = new Set([
  "tile.openstreetmap.org",
  "tiles.maps.eox.at",
  "a.tile.opentopomap.org",
  "b.tile.opentopomap.org",
  "c.tile.opentopomap.org",
  "tile.opentopomap.org",
]);

function isTileRequest(url) {
  if (url.origin === self.location.origin) {
    // The WMS proxy serves tiles; the health probe next to it does not.
    return url.pathname === "/api/wms";
  }
  return TILE_HOSTS.has(url.hostname);
}

function isShellAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");
}

function isDataAsset(url) {
  return url.origin === self.location.origin && DATA_ASSETS.includes(url.pathname);
}

/**
 * Pull the bundles a page references straight out of its HTML.
 *
 * Next.js emits content-hashed filenames, so there is no fixed list to precache
 * — but the served HTML names every chunk it needs, and those URLs are
 * immutable. Regex rather than DOMParser, which workers do not have.
 */
function assetsFromHtml(html) {
  const found = new Set();
  const re = /(?:src|href)="(\/_next\/static\/[^"]+)"/g;
  let m;
  while ((m = re.exec(html))) found.add(m[1].replace(/&amp;/g, "&"));
  return [...found];
}

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await cache.addAll(STATIC_ASSETS).catch(() => {});

  for (const page of SHELL_PAGES) {
    try {
      const res = await fetch(page, { cache: "reload" });
      if (!res.ok) continue;
      const html = await res.clone().text();
      await cache.put(page, res);
      await Promise.all(
        assetsFromHtml(html).map((href) =>
          cache.add(href).catch(() => {}),
        ),
      );
    } catch {
      // Offline at install time. The runtime handlers fill the gaps later.
    }
  }

  const data = await caches.open(DATA_CACHE);
  await Promise.all(DATA_ASSETS.map((u) => data.add(u).catch(() => {})));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith("act-") && !KEEP.has(n)).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

/**
 * Cache-first: for immutable things — tiles and hashed bundles.
 *
 * `ignoreVary` matters for tiles. They are pre-downloaded with `fetch()`, which
 * sends an `Origin` header, but replayed by Leaflet as `<img src>`, which does
 * not — and EOX answers with `Vary: Origin`. Honouring Vary would miss every
 * pre-downloaded tile, which is the entire point of the exercise. The URL is
 * the only thing that identifies a tile, so matching on it alone is correct.
 */
async function cacheFirst(request, cacheName, matchOptions) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, matchOptions);
  if (hit) return hit;

  const res = await fetch(request);
  // Opaque responses hide their status and can silently poison the cache with
  // errors, so only store responses we can actually inspect.
  if (res.ok && res.type !== "opaque") cache.put(request, res.clone());
  return res;
}

/** Network-first with a cache fallback: for HTML, which does change. */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    // A deep link to a page never visited online still deserves the map.
    const root = await cache.match("/");
    if (root) return root;
    throw err;
  }
}

/** Serve from cache immediately, refresh in the background. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || (await network) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // Always the network, never the cache:
  //   /api/inreach — a cached fix shown as current could put someone in the
  //     wrong valley.
  //   /api/version — a cached answer would keep reporting the old build, which
  //     is exactly the staleness it exists to detect.
  if (
    url.origin === self.location.origin &&
    (url.pathname === "/api/inreach" || url.pathname === "/api/version")
  ) {
    return;
  }

  if (isTileRequest(url)) {
    event.respondWith(
      cacheFirst(request, TILE_CACHE, { ignoreVary: true }).catch(
        // A missing tile must fail quietly — Leaflet just leaves it blank —
        // rather than surfacing as a console error storm offline.
        () => new Response("", { status: 504, statusText: "Tile unavailable offline" }),
      ),
    );
    return;
  }

  if (isShellAsset(url)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  if (isDataAsset(url)) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }

  // The basemap health probe. Offline the proxy cannot be reached, but that
  // says nothing about whether the topo layer is usable — what matters is
  // whether its tiles were downloaded. Answer from the tile cache, so the layer
  // is offered when it will actually draw and withheld when it would be blank.
  if (url.origin === self.location.origin && url.pathname === "/api/wms-health") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(TILE_CACHE);
        const keys = await cache.keys();
        const hasTopo = keys.some((r) => new URL(r.url).pathname === "/api/wms");
        // Built by hand rather than with Response.json(), which only arrived in
        // Safari 17 — this has to work on whatever iPad is to hand.
        const body = hasTopo
          ? { status: "ok", message: "Offline — drawing from downloaded tiles." }
          : {
              status: "unreachable",
              message:
                "Offline, and no Greenland topo tiles were downloaded. " +
                "Showing OpenStreetMap instead.",
            };
        return new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        });
      }),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      staleWhileRevalidate(request, SHELL_CACHE).catch(() => fetch(request)),
    );
  }
});

/*
 * The download itself runs in the page, not here: it has to be cancellable and
 * report progress, and the page already holds the Leaflet layers that generate
 * the exact tile URLs. It reaches the same cache through `caches.open()`, so
 * there is no message protocol to keep in sync.
 */
