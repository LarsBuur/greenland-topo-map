"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
// Ruler control. Side-effect import: registers L.Control.LinearMeasurement.
import "@/vendor/leaflet-linear-measurement";
import "@/vendor/leaflet-linear-measurement/leaflet-linear-measurement.css";
import {
  DEFAULT_VIEW,
  KIND_COLOR,
  KIND_LABEL,
  POINT_ZOOM,
  WAYPOINTS,
} from "@/lib/waypoints";
import { relativeAge, type Fix } from "@/lib/inreach";
import { useInreach } from "@/lib/useInreach";
import { useGeolocate, type GeoFix } from "@/lib/useGeolocate";
import { groupTrackByDay } from "@/lib/track-days";
import TrackPanel from "./TrackPanel";
import PlanPanel from "./PlanPanel";
import OfflinePanel from "./OfflinePanel";
import PersonalPoints from "./PersonalPoints";
import PointDialog, { type Draft } from "./PointDialog";
import CoordinateDialog from "./CoordinateDialog";
import { parseCoordinates, type LatLon } from "@/lib/coords";
import { readDepth, type LayerSpec } from "@/lib/offline";
import {
  ARCHIVE_GEOJSON,
  ImportError,
  buildExport,
  loadPoints,
  makePoint,
  parseGeoJSON,
  savePoints,
  saveFile,
  type PersonalPoint,
} from "@/lib/personal-points";
import {
  deletePhoto,
  getPhoto,
  photoBytes as readPhotoBytes,
  processPhoto,
  pruneOrphans,
  putPhoto,
} from "@/lib/photos";
import { looksLikeZip, readZip } from "@/lib/zip";
import {
  DIRECTION_NOTE,
  MARK_COLOR,
  NOPADDLE_COLOR,
  SAR_COLOR,
  TRAIL_COLOR,
  loadTrail,
  type SarPoint,
  type Stage,
  type Trail,
} from "@/lib/trail";

type View = { zoom: number; lat: number; lon: number };

/**
 * Deepest zoom at which the Greenland topo carries real information.
 *
 * Measured, not assumed: rendering a 256 m square of ground into 512 px exposes
 * the source pixel grid, and its period puts the raster at 3.74 m/px. Tiles
 * served at z15, z16 and z17 all resolve that same figure, which is what you see
 * when a server is upscaling. 3.74 m/px is one z14 pixel at this latitude, and
 * matches a 1:50,000 sheet scanned at roughly 340 dpi.
 */
const TOPO_NATIVE_ZOOM = 14;

/** Yellow: unused by any other marker, and legible on topo, aerial and OSM alike. */
const PERSONAL_COLOR = "#f0a500";

const PANELS_HIDDEN_KEY = "act-panels-hidden";

/** The conventional "you are here" blue, and used by nothing else on this map. */
const ME_COLOR = "#1c7ed6";

const HIDDEN_DAYS_KEY = "act-hidden-track-days";

/**
 * How much track to ask for.
 *
 * Two weeks covers the whole walk, so a day that scrolled off is never simply
 * gone. The clutter that used to argue for a short window is handled by the
 * per-day toggles instead.
 */
const TRACK_HOURS = 24 * 14;

type Health = { status: "ok" | "no-token" | "rejected" | "unreachable"; message: string };

/** Parse `#zoom/lat/lon`. Returns null for anything malformed or out of range. */
function parseHash(hash: string): View | null {
  const m = /^#\/?(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(hash.trim());
  if (!m) return null;
  const zoom = Number(m[1]);
  const lat = Number(m[2]);
  const lon = Number(m[3]);
  if (!Number.isFinite(zoom) || zoom < 1 || zoom > 20) return null;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return null;
  return { zoom: Math.round(zoom), lat, lon };
}

function formatCoord(lat: number, lon: number) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(6)}° ${ns}, ${Math.abs(lon).toFixed(6)}° ${ew}`;
}

/** Small teardrop pin for the linked point. */
function pinIcon(color: string) {
  return L.divIcon({
    className: "act-pin-wrap",
    html: `<svg class="act-pin" width="28" height="40" viewBox="0 0 28 40" aria-hidden="true">
      <path d="M14 39C14 39 26 22.5 26 14A12 12 0 1 0 2 14C2 22.5 14 39 14 39Z"
            fill="${color}" stroke="#fff" stroke-width="2.5"/>
      <circle cx="14" cy="14" r="4.5" fill="#fff"/>
    </svg>`,
    iconSize: [28, 40],
    iconAnchor: [14, 39],
    popupAnchor: [0, -36],
  });
}

/** Popup for one trail stage: the numbers first, then the source's prose. */
function stagePopup(stage: Stage, total: number) {
  const stats = [
    `${stage.km.toFixed(1)} km`,
    stage.ascent !== null ? `↑ ${stage.ascent} m` : null,
    stage.descent !== null ? `↓ ${stage.descent} m` : null,
  ].filter(Boolean);

  const bits = [
    `<strong>${escapeHtml(stage.label)}</strong>`,
    `<span class="act-meta">Stage ${stage.order} of ${total} · ${stats.join(" · ")}` +
      `${stage.labelKm !== null ? ` · signed ${stage.labelKm} km` : ""}</span>`,
  ];
  if (stage.description) {
    bits.push(`<span class="act-stage-desc">${escapeHtml(stage.description)}</span>`);
    bits.push(`<span class="act-meta">${escapeHtml(DIRECTION_NOTE)}</span>`);
  }
  return bits.join("<br>");
}

/** Popup for an access / SAR point: position, prose, then who to call. */
function sarPopup(point: SarPoint) {
  const bits = [
    `<strong>Access / SAR — ${escapeHtml(point.name)}</strong>`,
    `<span class="act-meta">${formatCoord(point.lat, point.lon)}</span>`,
  ];
  if (point.note) bits.push(`<span class="act-stage-desc">${escapeHtml(point.note)}</span>`);
  if (point.operators.length) {
    const list = point.operators
      .map(
        (o) =>
          `<a href="${escapeHtml(o.url)}" target="_blank" rel="noopener noreferrer">` +
          `${escapeHtml(o.name)}</a>`,
      )
      .join(", ");
    bits.push(`<span class="act-meta">Transfers and self-rescue: ${list}</span>`);
  }
  // The source contradicts itself at one point; say so rather than pick silently.
  if (point.statedOffByM && point.stated) {
    bits.push(
      `<span class="act-warn">The source's own text gives ${point.stated.lat}, ` +
        `${point.stated.lon} — ${point.statedOffByM} m from this marker. Confirm with the ` +
        `operator.</span>`,
    );
  }
  return bits.join("<br>");
}

/** Cross-in-circle marker, so SAR points don't read as another waypoint dot. */
function sarIcon() {
  return L.divIcon({
    className: "act-sar-wrap",
    html: `<svg class="act-sar" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <circle cx="11" cy="11" r="9.5" fill="${SAR_COLOR}" stroke="#fff" stroke-width="2"/>
      <path d="M11 5.5v11M5.5 11h11" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
    </svg>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -12],
  });
}

/**
 * Star for a personal point.
 *
 * Distinct in shape as well as colour: every other marker here is a circle, a
 * cross or a pin, so a star reads as "mine" at a glance even against the topo's
 * yellows, and never gets mistaken for a hut or a SAR point.
 */
function personalIcon() {
  return L.divIcon({
    className: "act-mine-wrap",
    html: `<svg class="act-mine" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.2l2.9 6.1 6.6.9-4.8 4.7 1.2 6.6L12 17.4 6.1 20.5l1.2-6.6L2.5 9.2l6.6-.9z"
            fill="${PERSONAL_COLOR}" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/>
    </svg>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -13],
  });
}

function personalPopup(point: PersonalPoint, photoUrl?: string) {
  const bits = [
    `<strong>${escapeHtml(point.name)}</strong>`,
    `<span class="act-meta">Your point · ${formatCoord(point.lat, point.lon)}</span>`,
  ];
  // The photo comes first after the heading: the whole reason it is attached is
  // to be compared against what is in front of you, so it should not be below
  // the fold of a small popup.
  if (photoUrl) {
    bits.push(
      `<a href="${photoUrl}" target="_blank" rel="noopener">` +
        `<img class="act-mine-photo" src="${photoUrl}" alt="" loading="lazy"></a>`,
    );
  }
  if (point.desc) bits.push(`<span class="act-stage-desc">${escapeHtml(point.desc)}</span>`);
  bits.push('<span class="act-meta">Saved on this device only. Edit it in “My points”.</span>');
  return bits.join("<br>");
}

/**
 * "You are here" — the device's own GNSS fix.
 *
 * Blue and round, the convention everyone already reads correctly, and always
 * drawn with its accuracy circle so a poor fix looks poor instead of falsely
 * precise. Distinct from the orange inReach dot, which is someone's last
 * *transmitted* position and may be hours old.
 */
function meIcon() {
  return L.divIcon({
    className: "act-me-wrap",
    html: '<span class="act-me"></span>',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -11],
  });
}

function mePopup(fix: GeoFix) {
  const bits = [
    "<strong>Your position</strong>",
    `<span class="act-meta">${formatCoord(fix.lat, fix.lon)}</span>`,
    `<span class="act-meta">Accurate to about ${Math.round(fix.accuracy)} m</span>`,
  ];
  const extra = [
    fix.altitude !== null ? `${Math.round(fix.altitude)} m` : null,
    fix.speed !== null && fix.speed > 0.3 ? `${(fix.speed * 3.6).toFixed(1)} km/h` : null,
    fix.heading !== null && fix.speed !== null && fix.speed > 0.3
      ? `${Math.round(fix.heading)}° true`
      : null,
  ].filter(Boolean);
  if (extra.length) bits.push(`<span class="act-meta">${extra.join(" · ")}</span>`);
  bits.push(`<span class="act-meta">${new Date(fix.time).toLocaleTimeString()}</span>`);
  return bits.join("<br>");
}

/** Pulsing dot for the live inReach position. */
function liveIcon(emergency: boolean) {
  return L.divIcon({
    className: "act-live-wrap",
    html: `<span class="act-live${emergency ? " act-live-emergency" : ""}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  });
}

function livePopup(fix: Fix) {
  const bits = [
    `<strong>${escapeHtml(fix.name)}</strong>`,
    `<span class="act-meta">${escapeHtml(fix.deviceType || "inReach")} · ${escapeHtml(
      relativeAge(fix.time),
    )}</span>`,
    `<span class="act-meta">${formatCoord(fix.lat, fix.lon)}</span>`,
  ];
  const stats = [
    fix.elevation !== null ? `${Math.round(fix.elevation)} m` : null,
    fix.velocity !== null ? `${fix.velocity.toFixed(1)} km/h` : null,
    fix.velocity ? `${Math.round(fix.course ?? 0)}° true` : null,
  ].filter(Boolean);
  if (stats.length) bits.push(`<span class="act-meta">${stats.join(" · ")}</span>`);
  if (fix.text) bits.push(`<em>${escapeHtml(fix.text)}</em>`);
  if (!fix.validFix) bits.push(`<span class="act-warn">No valid GPS fix.</span>`);
  if (fix.inEmergency) bits.push(`<span class="act-warn">SOS ACTIVE</span>`);
  bits.push(`<span class="act-meta">${new Date(fix.time).toUTCString()}</span>`);
  return bits.join("<br>");
}

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pinRef = useRef<L.Marker | null>(null);
  const topoRef = useRef<L.TileLayer | null>(null);
  const osmRef = useRef<L.TileLayer | null>(null);
  const aerialRef = useRef<L.TileLayer | null>(null);
  const otmRef = useRef<L.TileLayer | null>(null);
  const controlRef = useRef<L.Control.Layers | null>(null);
  const liveRef = useRef<L.Marker | null>(null);
  const trackRef = useRef<L.LayerGroup | null>(null);
  const trailRef = useRef<L.LayerGroup | null>(null);
  const marksRef = useRef<L.LayerGroup | null>(null);
  const sarRef = useRef<L.LayerGroup | null>(null);
  const noPaddleRef = useRef<L.LayerGroup | null>(null);

  const [view, setView] = useState<View | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  // undefined = still loading, null = unavailable. The layer switcher waits for
  // a settled value either way so the trail can be offered as an overlay.
  const [trail, setTrail] = useState<Trail | null | undefined>(undefined);
  // Flipped once the map and its layers exist, so the offline panel — which
  // needs both to generate tile URLs — can be handed real objects rather than
  // refs that were still null on first render.
  const [mapReady, setMapReady] = useState(false);
  const [copied, setCopied] = useState(false);

  // Whether the whole left rail is collapsed to its toggle. Remembered, because
  // someone who wants the map unobstructed wants it that way next time too —
  // and on a phone the collapsed panel headers alone still cover a third of the
  // screen. Read after mount: the server has no localStorage.
  const [panelsHidden, setPanelsHidden] = useState(false);

  useEffect(() => {
    try {
      setPanelsHidden(localStorage.getItem(PANELS_HIDDEN_KEY) === "1");
    } catch {
      // Private browsing. The default (shown) is the safe one.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PANELS_HIDDEN_KEY, panelsHidden ? "1" : "0");
    } catch {
      // As above — the preference simply will not persist.
    }
  }, [panelsHidden]);

  // Personal points. Loaded from localStorage after mount, never during render:
  // the server has no localStorage, and reading it in the render path would
  // desync the first paint.
  const [points, setPoints] = useState<PersonalPoint[]>([]);
  const [placing, setPlacing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [importNote, setImportNote] = useState<{ ok: boolean; text: string } | null>(null);

  // Photos. The blobs live in IndexedDB; these are the object URLs the DOM
  // needs, rebuilt when the set of photographed points changes and revoked as
  // they go, or every edit would leak one.
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [fullUrls, setFullUrls] = useState<Record<string, string>>({});
  const [photoTotal, setPhotoTotal] = useState(0);
  /** Pending photo for the open form: the processed pair, or null to clear. */
  const [draftPhoto, setDraftPhoto] = useState<{ thumb: Blob; full: Blob } | null>(null);
  const [draftPhotoCleared, setDraftPhotoCleared] = useState(false);
  const [draftPhotoUrl, setDraftPhotoUrl] = useState<string | null>(null);
  // Mirrors of the URL maps, so unmount can revoke them without the cleanup
  // having to depend on state that changes on every edit.
  const thumbUrlsRef = useRef<Record<string, string>>({});
  const fullUrlsRef = useRef<Record<string, string>>({});
  thumbUrlsRef.current = thumbUrls;
  fullUrlsRef.current = fullUrls;
  const mineRef = useRef<L.LayerGroup | null>(null);
  const meRef = useRef<L.Marker | null>(null);
  const meCircleRef = useRef<L.Circle | null>(null);
  const geo = useGeolocate();
  const [geoDismissed, setGeoDismissed] = useState(false);
  const [coordOpen, setCoordOpen] = useState(false);
  const [coordSeed, setCoordSeed] = useState("");

  /**
   * Set when the user asks to be located, cleared once the map has moved there.
   *
   * Without it a one-shot fix drops a dot wherever you happen to be looking —
   * which, if you were reading ahead up the valley, is off screen entirely, and
   * the button appears to have done nothing.
   */
  const recenterRef = useRef(false);
  const [dismissed, setDismissed] = useState(false);
  const [liveDismissed, setLiveDismissed] = useState(false);

  const live = useInreach(TRACK_HOURS);
  const latest = live?.status === "ok" ? live.latest : null;
  const [hiddenDays, setHiddenDays] = useState<Set<string>>(new Set());
  const trackDays = useMemo(
    () => (live?.status === "ok" ? groupTrackByDay(live.track) : []),
    [live],
  );

  // Which days are switched off is remembered: having to hide eight days again
  // every time the app is reopened would make the feature pointless.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_DAYS_KEY);
      if (raw) setHiddenDays(new Set(JSON.parse(raw) as string[]));
    } catch {
      // Nothing saved, or unreadable. Showing every day is the safe default.
    }
  }, []);

  const persistHidden = (next: Set<string>) => {
    setHiddenDays(next);
    try {
      localStorage.setItem(HIDDEN_DAYS_KEY, JSON.stringify([...next]));
    } catch {
      // The preference simply will not survive a restart.
    }
  };

  // Ask the server whether the topo basemap is actually usable.
  useEffect(() => {
    let alive = true;
    fetch("/api/wms-health")
      .then((r) => r.json())
      .then((h: Health) => alive && setHealth(h))
      .catch(() => alive && setHealth({ status: "unreachable", message: "Health check failed." }));
    return () => {
      alive = false;
    };
  }, []);

  // Fetch the extracted trail geometry. A failure is not fatal: the map still
  // works, it just has no route line.
  useEffect(() => {
    const ac = new AbortController();
    loadTrail(ac.signal)
      .then(setTrail)
      .catch((err) => {
        if (ac.signal.aborted) return;
        console.error("trail load failed", err);
        setTrail(null);
      });
    return () => ac.abort();
  }, []);

  // Build the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initial = parseHash(window.location.hash) ?? DEFAULT_VIEW;
    const hadHash = parseHash(window.location.hash) !== null;

    const map = L.map(containerRef.current, {
      center: [initial.lat, initial.lon],
      zoom: initial.zoom,
      // Every control lives in the top-right cluster, so the default top-left
      // zoom buttons are suppressed and re-added there below.
      zoomControl: false,
    });
    L.control.zoom({ position: "topright" }).addTo(map);
    mapRef.current = map;
    setView(initial);

    // The source is raster at 3.74 m/px — measured off the served tiles at z15,
    // z16 and z17, which all resolve the same block grid, and consistent with a
    // 1:50,000 sheet scanned at ~340 dpi. That is exactly one z14 pixel here, so
    // the server is magnifying anything deeper. Capping at z14 has Leaflet
    // upscale the same pixels instead: visually equivalent, a sixteenth of the
    // requests at z16, and a z14 download then covers every zoom offline.
    const topo = L.tileLayer.wms("/api/wms", {
      layers: "gl_aabent_land",
      format: "image/png",
      version: "1.3.0",
      transparent: true,
      maxZoom: 19,
      maxNativeZoom: TOPO_NATIVE_ZOOM,
      attribution:
        'Topo: <a href="https://www.klimadatastyrelsen.dk/">Klimadatastyrelsen</a>',
    });
    topoRef.current = topo;

    const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });

    osmRef.current = osm;

    // Sentinel-2 cloudless: the only aerial imagery that actually has data over
    // this corridor. Native resolution is 10 m/px, so tiles are only fetched up
    // to z14 and upscaled beyond — requesting deeper just returns mush.
    const aerial = L.tileLayer(
      "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg",
      {
        maxZoom: 19,
        maxNativeZoom: 14,
        attribution:
          'Aerial: <a href="https://cloudless.eox.at">EOxCloudless</a> by EOX IT Services GmbH' +
          " (contains modified Copernicus Sentinel data 2025), CC BY-NC-SA 4.0",
      },
    );
    aerialRef.current = aerial;

    // OpenTopoMap: the basemap the arcticcircletrail.gl interactive map uses.
    // Contours and OSM detail all the way to z17 here, though there is no
    // hillshading — its relief shading comes from SRTM, which stops at 60°N.
    const otm = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      subdomains: "abc",
      maxZoom: 19,
      maxNativeZoom: 17,
      attribution:
        'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' +
        ' contributors, SRTM &middot; Style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>' +
        ' (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
    });
    otmRef.current = otm;

    // Topo goes on straight away; the layer switcher is built once the health
    // check has said whether topo is actually selectable (see below).
    topo.addTo(map);

    // Context markers: every hut, town, trailhead and (approximate) river crossing.
    const context = L.layerGroup().addTo(map);
    for (const w of WAYPOINTS) {
      const marker = L.circleMarker([w.lat, w.lon], {
        radius: 6,
        color: "#fff",
        weight: 2,
        fillColor: KIND_COLOR[w.kind],
        fillOpacity: 1,
      });
      marker.bindPopup(
        `<strong>${escapeHtml(w.name)}</strong><br>` +
          `<span class="act-meta">${KIND_LABEL[w.kind]}` +
          `${w.sleeps ? ` · sleeps ${escapeHtml(w.sleeps)}` : ""}</span><br>` +
          `<span class="act-meta">${formatCoord(w.lat, w.lon)}</span>` +
          `${w.approx ? '<br><span class="act-warn">Approximate position — do not navigate by it.</span>' : ""}` +
          `<br>${escapeHtml(w.desc)}`,
      );
      marker.addTo(context);
    }

    // The linked point itself.
    const pin = L.marker([initial.lat, initial.lon], {
      icon: pinIcon("#c92a2a"),
      zIndexOffset: 1000,
      keyboard: false,
    }).addTo(map);
    pinRef.current = pin;
    pin.bindPopup(
      `<strong>Linked point</strong><br><span class="act-meta">${formatCoord(initial.lat, initial.lon)}</span>`,
    );
    if (hadHash) pin.openPopup();

    // Keep the hash in sync so the current view is always copy-pasteable.
    const sync = () => {
      const c = map.getCenter();
      const next = { zoom: map.getZoom(), lat: c.lat, lon: c.lng };
      setView(next);
      const hash = `#${next.zoom}/${next.lat.toFixed(6)}/${next.lon.toFixed(6)}`;
      if (hash !== window.location.hash) {
        window.history.replaceState(null, "", hash);
      }
      setCopied(false);
    };
    map.on("moveend zoomend", sync);

    // Normalise straight away, so a bare "/" or a malformed hash still yields a
    // copy-pasteable URL without having to touch the map first.
    sync();

    setMapReady(true);

    // Ruler: click to lay out legs, each labelled with running distance. Metric
    // and with bearings on, which is what's useful for planning a leg here.
    map.addControl(
      new L.Control.LinearMeasurement({
        position: "topright",
        unitSystem: "metric",
        color: "#e8590c",
        contrastingColor: "#fff",
        show_last_node: true,
        show_azimut: true,
      }),
    );

    // Someone pasted a new hash into the same tab, or hit back.
    const onHashChange = () => {
      const v = parseHash(window.location.hash);
      // Unparseable: keep the current view, but put a valid hash back in the bar.
      if (!v) {
        sync();
        return;
      }
      const c = map.getCenter();
      if (Math.abs(c.lat - v.lat) < 1e-6 && Math.abs(c.lng - v.lon) < 1e-6 && map.getZoom() === v.zoom) {
        return;
      }
      map.setView([v.lat, v.lon], v.zoom);
      pin.setLatLng([v.lat, v.lon]);
      pin.setPopupContent(
        `<strong>Linked point</strong><br><span class="act-meta">${formatCoord(v.lat, v.lon)}</span>`,
      );
    };
    window.addEventListener("hashchange", onHashChange);

    return () => {
      window.removeEventListener("hashchange", onHashChange);
      map.off("moveend zoomend", sync);
      map.remove();
      mapRef.current = null;
      setMapReady(false);
      // Must be cleared, or a remount would skip rebuilding the switcher — and
      // would re-use a personal-points group still attached to the destroyed
      // map, so the user's own marks would silently stop appearing.
      controlRef.current = null;
      mineRef.current = null;
    };
  }, []);

  // Build the layer switcher once both the health verdict and the trail have
  // settled: topo is offered only when it works, so nobody can select their way
  // to a blank map, and the trail overlays only appear if they actually loaded.
  useEffect(() => {
    const map = mapRef.current;
    const topo = topoRef.current;
    const osm = osmRef.current;
    if (!map || !topo || !osm || !health || trail === undefined || controlRef.current) return;

    if (health.status !== "ok") {
      if (map.hasLayer(topo)) map.removeLayer(topo);
      if (!map.hasLayer(osm)) osm.addTo(map);
    }

    const bases: L.Control.LayersObject = {};
    if (health.status === "ok") bases["Greenland topo"] = topo;
    if (otmRef.current) bases["OpenTopoMap"] = otmRef.current;
    if (aerialRef.current) bases["Aerial (Sentinel-2)"] = aerialRef.current;
    bases["OpenStreetMap"] = osm;

    const overlays: L.Control.LayersObject = {};

    if (trail) {
      // White casing under a coloured line: reads on both the topo greens and
      // the OSM greys without competing with the waypoint colours.
      const trailGroup = L.layerGroup();
      for (const stage of trail.stages) {
        L.polyline(stage.latlngs, {
          color: "#ffffff",
          weight: 7,
          opacity: 0.65,
          interactive: false,
        }).addTo(trailGroup);

        L.polyline(stage.latlngs, {
          color: TRAIL_COLOR,
          weight: 3.5,
          opacity: 0.95,
        })
          .bindPopup(stagePopup(stage, trail.stages.length), { maxWidth: 340 })
          .addTo(trailGroup);
      }
      trailGroup.addTo(map);
      trailRef.current = trailGroup;
      overlays[`ACT trail (${trail.totalKm.toFixed(0)} km)`] = trailGroup;

      // 160 dots is a lot at low zoom, so this one starts switched off.
      const markGroup = L.layerGroup();
      for (const mark of trail.marks) {
        // Every tenth mark is labelled permanently, the rest on hover or tap.
        // Bind exactly once: a second bindTooltip() short-circuits Leaflet's
        // handler setup, and a permanent tooltip then never opens itself.
        const permanent = mark.km % 10 === 0;
        L.circleMarker([mark.lat, mark.lon], {
          radius: 3.5,
          color: "#ffffff",
          weight: 1.5,
          fillColor: MARK_COLOR,
          fillOpacity: 1,
        })
          .bindTooltip(
            permanent ? String(mark.km) : `KM ${mark.km}`,
            permanent
              ? { permanent: true, direction: "right", className: "act-km-label" }
              : { direction: "top" },
          )
          .addTo(markGroup);
      }
      marksRef.current = markGroup;
      overlays[`Distance marks (${trail.marks.length})`] = markGroup;

      // Safety layers, both on by default: they matter most to someone who did
      // not go looking for them.
      if (trail.sar.length) {
        const sarGroup = L.layerGroup();
        for (const point of trail.sar) {
          L.marker([point.lat, point.lon], {
            icon: sarIcon(),
            zIndexOffset: 900,
            keyboard: false,
          })
            .bindPopup(sarPopup(point), { maxWidth: 320 })
            .bindTooltip(`Access / SAR — ${point.name}`, { direction: "top" })
            .addTo(sarGroup);
        }
        sarGroup.addTo(map);
        sarRef.current = sarGroup;
        overlays[`Access / SAR points (${trail.sar.length})`] = sarGroup;
      }

      if (trail.noPaddle.length) {
        const noPaddleGroup = L.layerGroup();
        for (const area of trail.noPaddle) {
          L.polygon(area.rings, {
            color: NOPADDLE_COLOR,
            weight: 2,
            fillColor: NOPADDLE_COLOR,
            fillOpacity: 0.18,
            dashArray: "6 4",
          })
            .bindPopup(
              `<strong>${escapeHtml(area.label)}</strong><br>` +
                '<span class="act-meta">Closed to canoes. Marked on the official ACT map; ' +
                "canoes should never be paddled west of the Canoe Centre.</span>",
            )
            .addTo(noPaddleGroup);
        }
        noPaddleGroup.addTo(map);
        noPaddleRef.current = noPaddleGroup;
        overlays["No-paddle area"] = noPaddleGroup;
      }
    }

    controlRef.current = L.control
      .layers(bases, overlays, { position: "topright" })
      .addTo(map);
  }, [health, trail]);

  // Draw (and keep redrawing) the live inReach position and its recent track.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || live?.status !== "ok") return;

    const { latest: fix, track } = live;

    if (!fix) {
      liveRef.current?.remove();
      liveRef.current = null;
      return;
    }

    if (liveRef.current) {
      liveRef.current.setLatLng([fix.lat, fix.lon]);
      liveRef.current.setIcon(liveIcon(fix.inEmergency));
      liveRef.current.setPopupContent(livePopup(fix));
    } else {
      liveRef.current = L.marker([fix.lat, fix.lon], {
        icon: liveIcon(fix.inEmergency),
        zIndexOffset: 1100,
        keyboard: false,
      })
        .bindPopup(livePopup(fix))
        .addTo(map);
    }

  }, [live]);

  /**
   * The track, one polyline per day, so days can be switched off.
   *
   * Nine days of fixes as a single line is a scribble that hides the route
   * underneath it. Older days are drawn fainter and thinner, which reads as
   * recency without needing a colour per day — and there are already six
   * colours in use on this map.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    const group = trackRef.current ?? L.layerGroup().addTo(map);
    trackRef.current = group;
    group.clearLayers();

    for (const day of trackDays) {
      if (hiddenDays.has(day.key)) continue;
      // One fix has nothing to join up.
      if (day.fixes.length < 2) continue;

      L.polyline(
        day.fixes.map((f) => [f.lat, f.lon] as [number, number]),
        {
          color: "#e8590c",
          weight: day.age === 0 ? 3.5 : 2.5,
          opacity: Math.max(0.28, 0.9 - day.age * 0.14),
        },
      )
        .bindPopup(
          `<strong>${escapeHtml(day.label)}</strong><br>` +
            `<span class="act-meta">${day.km.toFixed(1)} km tracked · ` +
            `${day.fixes.length} fixes</span>`,
        )
        .addTo(group);
    }
  }, [trackDays, hiddenDays, mapReady]);

  // Unmount cleanup is handled by map.remove(), but the refs must not outlive it.
  useEffect(
    () => () => {
      liveRef.current = null;
      trackRef.current = null;
      trailRef.current = null;
      marksRef.current = null;
      aerialRef.current = null;
      otmRef.current = null;
      sarRef.current = null;
      noPaddleRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const saved = loadPoints();
    setPoints(saved);
    // Photos can outlive their point if a delete half-failed. Left alone they
    // would consume the same budget as the map tiles, invisibly.
    pruneOrphans(saved.filter((p) => p.hasPhoto).map((p) => p.id)).catch(() => {});
  }, []);

  /** Load object URLs for every photographed point, and revoke the rest. */
  useEffect(() => {
    let live = true;
    const wanted = points.filter((p) => p.hasPhoto).map((p) => p.id);

    (async () => {
      const thumbs: Record<string, string> = {};
      const fulls: Record<string, string> = {};
      for (const id of wanted) {
        const stored = await getPhoto(id).catch(() => undefined);
        if (!live) break;
        if (!stored) continue;
        thumbs[id] = URL.createObjectURL(stored.thumb);
        fulls[id] = URL.createObjectURL(stored.full);
      }
      if (!live) {
        for (const u of [...Object.values(thumbs), ...Object.values(fulls)]) {
          URL.revokeObjectURL(u);
        }
        return;
      }
      setThumbUrls((prev) => {
        for (const u of Object.values(prev)) URL.revokeObjectURL(u);
        return thumbs;
      });
      setFullUrls((prev) => {
        for (const u of Object.values(prev)) URL.revokeObjectURL(u);
        return fulls;
      });
      readPhotoBytes().then((n) => live && setPhotoTotal(n)).catch(() => {});
    })();

    return () => {
      live = false;
    };
  }, [points]);

  // Revoke on unmount. Kept apart from the loader so it does not fire on every
  // change of `points`.
  useEffect(
    () => () => {
      for (const u of Object.values(thumbUrlsRef.current)) URL.revokeObjectURL(u);
      for (const u of Object.values(fullUrlsRef.current)) URL.revokeObjectURL(u);
    },
    [],
  );

  /** Preview URL for the photo attached to the open form. */
  useEffect(() => {
    if (!draftPhoto) {
      setDraftPhotoUrl(null);
      return;
    }
    const url = URL.createObjectURL(draftPhoto.thumb);
    setDraftPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draftPhoto]);

  /** Write through on every change, and surface a refusal rather than swallow it. */
  const commitPoints = (next: PersonalPoint[]) => {
    setPoints(next);
    setStorageFailed(!savePoints(next));
  };

  // Draw the personal points. Rebuilt wholesale on change: there are a handful
  // of them, and a diff would be more code than it saves.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    const group = mineRef.current ?? L.layerGroup().addTo(map);
    mineRef.current = group;
    group.clearLayers();

    for (const p of points) {
      L.marker([p.lat, p.lon], {
        icon: personalIcon(),
        // Above the trail and waypoints, below the live position: the user's
        // own marks should not hide where they actually are.
        zIndexOffset: 1050,
        keyboard: false,
      })
        .bindPopup(personalPopup(p, fullUrls[p.id]), { maxWidth: 300 })
        .bindTooltip(p.name, { direction: "top" })
        .addTo(group);
    }
  }, [points, mapReady, fullUrls]);

  /** Draw the device's own position, and follow it when asked to. */
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    const { fix } = geo;
    if (!fix) {
      meRef.current?.remove();
      meRef.current = null;
      meCircleRef.current?.remove();
      meCircleRef.current = null;
      return;
    }

    const at: [number, number] = [fix.lat, fix.lon];

    // The circle goes on first so the dot sits above it.
    if (meCircleRef.current) {
      meCircleRef.current.setLatLng(at).setRadius(fix.accuracy);
    } else {
      meCircleRef.current = L.circle(at, {
        radius: fix.accuracy,
        color: ME_COLOR,
        weight: 1,
        opacity: 0.5,
        fillColor: ME_COLOR,
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(map);
    }

    if (meRef.current) {
      meRef.current.setLatLng(at).setPopupContent(mePopup(fix));
    } else {
      meRef.current = L.marker(at, {
        icon: meIcon(),
        // Above everything: where you are outranks every other marker.
        zIndexOffset: 1200,
        keyboard: false,
      })
        .bindPopup(mePopup(fix))
        .addTo(map);
    }

    if (geo.following || recenterRef.current) {
      recenterRef.current = false;
      map.setView(at, Math.max(map.getZoom(), TOPO_NATIVE_ZOOM), { animate: true });
    }
  }, [geo, mapReady]);

  /**
   * Dragging the map turns following off.
   *
   * Otherwise the next fix yanks the view back and it feels broken — you cannot
   * look ahead up the valley without fighting it.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !geo.following) return;
    const stop = () => geo.setFollowing(false);
    map.on("dragstart", stop);
    return () => {
      map.off("dragstart", stop);
    };
  }, [geo, mapReady]);

  /**
   * Long press on the map to drop a point, and right-click on a desktop.
   *
   * Leaflet's TapHold handler is on by default for exactly mobile Safari and
   * synthesises `contextmenu` after a 600 ms hold, cancelling if the finger
   * moves more than 15 px — so a pan or a pinch never triggers it.
   *
   * The native callout ("Copy", "Look Up", "Translate") has to be suppressed in
   * CSS as well, via -webkit-touch-callout on the map container; without that,
   * iOS puts its own menu over the map and the gesture appears to do nothing.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    const onHold = (e: L.LeafletMouseEvent) => {
      L.DomEvent.preventDefault(e.originalEvent);
      setPlacing(false);
      setDraftPhoto(null);
      setDraftPhotoCleared(false);
      setDraft({ lat: e.latlng.lat, lon: e.latlng.lng });
    };

    map.on("contextmenu", onHold);
    return () => {
      map.off("contextmenu", onHold);
    };
  }, [mapReady]);

  // Placement mode: the next tap on the map becomes a point.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !placing) return;

    const onClick = (e: L.LeafletMouseEvent) => {
      setDraft({ lat: e.latlng.lat, lon: e.latlng.lng });
      setPlacing(false);
    };
    map.on("click", onClick);
    // A crosshair says "this click does something", which a grab cursor does not.
    const container = map.getContainer();
    const previousCursor = container.style.cursor;
    container.style.cursor = "crosshair";

    return () => {
      map.off("click", onClick);
      container.style.cursor = previousCursor;
    };
  }, [placing, mapReady]);

  /**
   * While offline, stop the basemaps asking for tiles deeper than the download
   * went.
   *
   * Leaflet renders nothing for a tile it cannot fetch, so a pinch past the
   * downloaded zoom would blank the map — which on the trail reads as "the
   * download failed" rather than "you have run out of detail". Capping
   * `maxNativeZoom` makes it upscale stored tiles instead: blurry, but the
   * terrain and the route stay on screen. Lifted again the moment there is a
   * connection, so real detail comes back in town.
   */
  useEffect(() => {
    if (!mapReady) return;

    const layers = [
      { layer: topoRef.current, native: TOPO_NATIVE_ZOOM },
      { layer: otmRef.current, native: 17 },
      { layer: aerialRef.current, native: 14 },
    ];

    const apply = () => {
      const depth = readDepth();
      const offline = !navigator.onLine;
      for (const { layer, native } of layers) {
        if (!layer) continue;
        const cap = offline && depth !== null ? Math.min(native, depth) : native;
        const next = Number.isFinite(cap) ? cap : undefined;
        if (layer.options.maxNativeZoom === next) continue;
        layer.options.maxNativeZoom = next;
        if (mapRef.current?.hasLayer(layer)) layer.redraw();
      }
    };

    apply();
    window.addEventListener("online", apply);
    window.addEventListener("offline", apply);
    return () => {
      window.removeEventListener("online", apply);
      window.removeEventListener("offline", apply);
    };
  }, [mapReady]);

  /**
   * Basemaps the offline download can store.
   *
   * Only raster basemaps qualify — the trail, waypoints and SAR points are
   * drawn from data that is already cached wholesale, so they work offline
   * regardless. Topo is offered only when the health check says the proxy is
   * live, since downloading 503s would be worse than useless.
   */
  const offlineSpecs = useMemo<LayerSpec[]>(() => {
    if (!mapReady) return [];
    const specs: LayerSpec[] = [];
    if (health?.status === "ok" && topoRef.current) {
      specs.push({
        id: "topo",
        label: "Greenland topo",
        note: "Klimadatastyrelsen 1:50,000 — the sharpest terrain for this route",
        layer: topoRef.current,
        maxNativeZoom: TOPO_NATIVE_ZOOM,
        bytesPerTile: 108 * 1024,
      });
    }
    if (otmRef.current) {
      specs.push({
        id: "otm",
        label: "OpenTopoMap",
        note: "contours and OSM paths — a useful cross-check",
        layer: otmRef.current,
        maxNativeZoom: 17,
        bytesPerTile: 29 * 1024,
      });
    }
    if (aerialRef.current) {
      specs.push({
        id: "aerial",
        label: "Aerial (Sentinel-2)",
        note: "10 m imagery, no detail past z14",
        layer: aerialRef.current,
        maxNativeZoom: 14,
        bytesPerTile: 20 * 1024,
      });
    }
    return specs;
  }, [mapReady, health]);

  const clearDraftPhoto = () => {
    setDraftPhoto(null);
    setDraftPhotoCleared(false);
  };

  const commitDraft = async (name: string, desc: string) => {
    if (!draft) return;
    const trimmed = desc.trim();

    if (draft.editing) {
      const id = draft.editing.id;
      // Write the image before the point, so a point can never claim a photo
      // that is not there. The reverse would show a broken thumbnail.
      let hasPhoto = draft.editing.hasPhoto ?? false;
      if (draftPhoto) {
        await putPhoto(id, draftPhoto.thumb, draftPhoto.full).catch(() => {});
        hasPhoto = true;
      } else if (draftPhotoCleared) {
        await deletePhoto(id).catch(() => {});
        hasPhoto = false;
      }

      commitPoints(
        points.map((p) =>
          p.id === id
            ? {
                ...p,
                name: name.trim() || p.name,
                desc: trimmed || undefined,
                hasPhoto: hasPhoto || undefined,
              }
            : p,
        ),
      );
    } else {
      const point = makePoint({ name, desc, lat: draft.lat, lon: draft.lon });
      if (draftPhoto) {
        await putPhoto(point.id, draftPhoto.thumb, draftPhoto.full).catch(() => {});
        point.hasPhoto = true;
      }
      commitPoints([...points, point]);
    }

    setDraft(null);
    clearDraftPhoto();
  };

  const pickPhoto = async (file: File) => {
    try {
      setDraftPhoto(await processPhoto(file));
      setDraftPhotoCleared(false);
    } catch (err) {
      setImportNote({
        ok: false,
        text: err instanceof Error ? err.message : "That photo could not be read.",
      });
    }
  };

  const removeDraftPhoto = () => {
    setDraftPhoto(null);
    setDraftPhotoCleared(true);
  };

  const exportPoints = async () => {
    try {
      const { blob, name } = await buildExport(points, async (id) => {
        const stored = await getPhoto(id).catch(() => undefined);
        return stored?.full ?? null;
      });
      saveFile(blob, name);
    } catch (err) {
      setImportNote({
        ok: false,
        text: err instanceof Error ? err.message : "The export could not be built.",
      });
    }
  };

  /**
   * Merge an imported file into the existing points.
   *
   * Import only ever adds. Replacing outright would make a mistyped file
   * selection destroy the very marks the user is trying to restore, and there
   * is no undo out on the trail — so duplicates are counted and dropped, and
   * nothing already saved is touched.
   */
  const importFile = async (file: File) => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());

      // Sniff the bytes rather than trust the extension: a plain `.geojson`
      // from an older export must keep working exactly as it did, and a ZIP
      // renamed by a file manager should still be read as one.
      let text: string;
      let archive: Map<string, Uint8Array<ArrayBuffer>> | null = null;
      if (looksLikeZip(bytes)) {
        archive = await readZip(bytes.buffer);
        const geo =
          archive.get(ARCHIVE_GEOJSON) ??
          [...archive.entries()].find(([n]) => n.endsWith(".geojson") || n.endsWith(".json"))?.[1];
        if (!geo) throw new ImportError("That archive has no GeoJSON file in it.");
        text = new TextDecoder().decode(geo);
      } else {
        text = new TextDecoder().decode(bytes);
      }

      const { fresh, photoPaths, duplicates, skipped } = parseGeoJSON(text, points);

      // Photos before points, for the same reason as an edit: a saved point
      // must never promise an image that failed to store.
      let photos = 0;
      if (archive) {
        for (const point of fresh) {
          const path = photoPaths.get(point.id);
          const raw = path ? archive.get(path) : undefined;
          if (!raw) continue;
          try {
            const { thumb, full } = await processPhoto(new Blob([raw], { type: "image/jpeg" }));
            await putPhoto(point.id, thumb, full);
            point.hasPhoto = true;
            photos++;
          } catch {
            // Keep the point; it is still a place worth having on the map.
          }
        }
      }

      if (fresh.length) commitPoints([...points, ...fresh]);

      const parts = [
        fresh.length
          ? `Added ${fresh.length} point${fresh.length === 1 ? "" : "s"}.`
          : "Nothing new to add.",
      ];
      if (photos) {
        parts.push(`${photos} photo${photos === 1 ? "" : "s"} restored.`);
      }
      if (duplicates) {
        parts.push(`${duplicates} already saved, left alone.`);
      }
      if (skipped) {
        parts.push(`${skipped} feature${skipped === 1 ? "" : "s"} skipped — not a point.`);
      }
      setImportNote({ ok: true, text: parts.join(" ") });
    } catch (err) {
      setImportNote({
        ok: false,
        text: err instanceof ImportError ? err.message : "That file could not be read.",
      });
    }
  };

  /**
   * What the form shows in its photo slot: a newly picked image, or the one the
   * point already has — unless the user has just removed it.
   */
  const draftPreview = draftPhoto
    ? draftPhotoUrl
    : draft?.editing?.hasPhoto && !draftPhotoCleared
      ? (thumbUrls[draft.editing.id] ?? null)
      : null;

  /**
   * Add a point from a pasted position.
   *
   * Tries the clipboard first, because when it works this is one tap. Safari
   * can refuse the read outright, and the text may not be a coordinate at all,
   * so either way it falls through to the dialog rather than failing silently.
   */
  const addFromClipboard = async () => {
    let clip = "";
    try {
      clip = await navigator.clipboard.readText();
    } catch {
      // Refused or unsupported — the dialog has a field to paste into.
    }

    const parsed = clip ? parseCoordinates(clip) : null;
    if (parsed?.ok) {
      openDraftAt(parsed.value);
      return;
    }
    setCoordSeed(clip);
    setCoordOpen(true);
  };

  const openDraftAt = (at: LatLon) => {
    setCoordOpen(false);
    setPlacing(false);
    setDraftPhoto(null);
    setDraftPhotoCleared(false);
    setDraft({ lat: at.lat, lon: at.lon });
    // Show where it landed, so a mis-read hemisphere is obvious at once.
    mapRef.current?.setView([at.lat, at.lon], Math.max(mapRef.current.getZoom(), POINT_ZOOM));
  };

  const goToPoint = (p: PersonalPoint) => {
    const map = mapRef.current;
    if (!map) return;
    map.setView([p.lat, p.lon], Math.max(map.getZoom(), POINT_ZOOM));
  };

  const goToLive = () => {
    const map = mapRef.current;
    if (!map || !latest) return;
    map.setView([latest.lat, latest.lon], Math.max(map.getZoom(), POINT_ZOOM));
    liveRef.current?.openPopup();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const showBanner = health && health.status !== "ok" && !dismissed;
  const liveError = live && live.status !== "ok" ? live : null;
  const showLiveBanner = liveError && !liveDismissed;

  return (
    <div className="act-map-root">
      <div ref={containerRef} className="act-map" />

      {/* Placement takes the whole screen: the rail would otherwise cover the
          map the user is being asked to tap. */}
      {placing && (
        <div className="act-placing" role="status">
          <span>Tap the map to place your point</span>
          <button type="button" className="act-btn" onClick={() => setPlacing(false)}>
            Cancel
          </button>
        </div>
      )}

      <CoordinateDialog
        open={coordOpen}
        initialText={coordSeed}
        onAccept={openDraftAt}
        onCancel={() => setCoordOpen(false)}
      />

      <PointDialog
        draft={draft}
        photoUrl={draftPreview}
        onPickPhoto={pickPhoto}
        onRemovePhoto={removeDraftPhoto}
        onSave={commitDraft}
        onCancel={() => {
          setDraft(null);
          clearDraftPhoto();
        }}
      />

      <div
        className={`act-rail${panelsHidden || placing ? " act-rail-hidden" : ""}`}
        // Out of the way while placing *and* while the form is open, so the map
        // behind the modal shows where the point is actually going.
        hidden={placing || draft !== null}
      >
        <button
          type="button"
          className="act-rail-toggle"
          onClick={() => setPanelsHidden((v) => !v)}
          aria-expanded={!panelsHidden}
          title={panelsHidden ? "Show the panels" : "Hide the panels and see the map"}
        >
          {panelsHidden ? (
            <>
              Panels
              {points.length > 0 && <span className="act-rail-count">{points.length}</span>}
            </>
          ) : (
            <>Hide panels</>
          )}
        </button>

        {/* Kept mounted while placing — the rail is hidden with an attribute
            instead. Unmounting would reset each panel's open/closed state, so
            saving a point would collapse the very list it was added to. */}
        {!panelsHidden && (
          <>
            <OfflinePanel
              map={mapReady ? mapRef.current : null}
              trail={trail ?? null}
              specs={offlineSpecs}
              points={points}
            />

            <PersonalPoints
              points={points}
              placing={placing}
              storageFailed={storageFailed}
              onStartPlacing={() => {
                setDraft(null);
                setPlacing(true);
              }}
              onCancelPlacing={() => setPlacing(false)}
              onEdit={(p) => {
                clearDraftPhoto();
                setDraft({ lat: p.lat, lon: p.lon, editing: p });
              }}
              onDelete={(id) => {
                deletePhoto(id).catch(() => {});
                commitPoints(points.filter((p) => p.id !== id));
              }}
              onGoTo={goToPoint}
              onImport={importFile}
              importNote={importNote}
              thumbUrls={thumbUrls}
              onExport={exportPoints}
              onPastePosition={addFromClipboard}
              photoBytes={photoTotal}
            />

            <TrackPanel
              days={trackDays}
              hidden={hiddenDays}
              onToggle={(key) => {
                const next = new Set(hiddenDays);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                persistHidden(next);
              }}
              onShowAll={() => persistHidden(new Set())}
              onShowLatestOnly={() =>
                persistHidden(new Set(trackDays.filter((d) => d.age !== 0).map((d) => d.key)))
              }
            />

            <PlanPanel />
          </>
        )}
      </div>

      {showBanner && (
        <div className="act-banner" role="status">
          <div>
            <strong>Greenland topo basemap unavailable</strong> — showing OpenStreetMap instead.
            <div className="act-banner-detail">
              {health.status === "no-token"
                ? "No Dataforsyningen token is configured. Set DATAFORSYNINGEN_TOKEN and redeploy — register for a free token at dataforsyningen.dk."
                : health.message}
            </div>
          </div>
          <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {showLiveBanner && (
        <div className="act-banner act-banner-live" role="status">
          <div>
            <strong>Live tracking unavailable</strong>
            <div className="act-banner-detail">{liveError.message}</div>
          </div>
          <button type="button" onClick={() => setLiveDismissed(true)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {latest?.inEmergency && (
        <div className="act-banner act-banner-sos" role="alert">
          <div>
            <strong>SOS active</strong> — {latest.name} triggered an emergency{" "}
            {relativeAge(latest.time)}.
            <div className="act-banner-detail">
              Garmin IERCC handles the response. Do not rely on this page for it.
            </div>
          </div>
        </div>
      )}

      {/* Bottom right, clear of the panels and of the HUD along the bottom
          left — and reachable with a thumb. */}
      <div className="act-locate">
        <button
          type="button"
          className={`act-locate-btn${geo.status === "locating" ? " act-locate-busy" : ""}`}
          onClick={() => {
            setGeoDismissed(false);
            recenterRef.current = true;
            geo.locate();
          }}
          disabled={geo.status === "locating"}
          aria-label="Find my position"
          title={
            geo.fix
              ? `Accurate to about ${Math.round(geo.fix.accuracy)} m — tap for a fresh fix`
              : "Find my position"
          }
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="12" cy="12" r="1.6" fill="currentColor" />
            <path
              d="M12 1.5v3.2M12 19.3v3.2M1.5 12h3.2M19.3 12h3.2"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {geo.fix && (
          <button
            type="button"
            className={`act-follow${geo.following ? " act-follow-on" : ""}`}
            onClick={() => geo.setFollowing(!geo.following)}
            aria-pressed={geo.following}
            title={
              geo.following
                ? "Stop following — saves battery"
                : "Keep the map centred on you. Uses more battery."
            }
          >
            {geo.following ? "Following" : "Follow"}
          </button>
        )}

        {geo.fix && (
          <span
            className={`act-locate-acc${geo.fix.accuracy > 100 ? " act-locate-coarse" : ""}`}
            title={
              geo.fix.accuracy > 100
                ? "This is a network-derived position, not a satellite fix. A Wi-Fi-only iPad " +
                  "has no GPS receiver at all and can only locate this way."
                : "Satellite fix"
            }
          >
            ±{Math.round(geo.fix.accuracy)} m
          </span>
        )}
      </div>

      {geo.message && !geoDismissed && (
        <div className="act-banner act-banner-geo" role="status">
          <div>
            <strong>
              {geo.status === "denied" ? "Location is switched off" : "No position yet"}
            </strong>
            <div className="act-banner-detail">{geo.message}</div>
          </div>
          <button type="button" onClick={() => setGeoDismissed(true)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <div className="act-hud">
        <span className="act-hud-coord">
          {view ? formatCoord(view.lat, view.lon) : "—"}
          <span className="act-hud-zoom">z{view?.zoom ?? POINT_ZOOM}</span>
        </span>
        {latest && (
          <button
            type="button"
            onClick={goToLive}
            className="act-btn act-btn-live"
            title={`${latest.name} · ${formatCoord(latest.lat, latest.lon)}`}
          >
            <span className="act-live-dot" aria-hidden="true" />
            Live · {relativeAge(latest.time)}
          </button>
        )}
        <button type="button" onClick={copyLink} className="act-btn">
          {copied ? "Copied" : "Copy link"}
        </button>
        <a href="/links" className="act-btn">
          Hut links
        </a>
      </div>
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
