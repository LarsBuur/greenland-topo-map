"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type L from "leaflet";
import type { Trail } from "@/lib/trail";
import {
  clearTiles,
  downloadTiles,
  forgetDepth,
  formatBytes,
  rememberDepth,
  planLayer,
  planSize,
  requestPersistence,
  storageStats,
  type DownloadProgress,
  type LayerSpec,
  type Region,
  type StorageStats,
} from "@/lib/offline";
import type { PersonalPoint } from "@/lib/personal-points";

const RADIUS_CHOICES = [
  { km: 0.5, label: "500 m", hint: "the trail and little else — leaves no room to be off route" },
  { km: 1, label: "1 km", hint: "close in, but enough to find the line again" },
  { km: 2, label: "2 km", hint: "the trail and its immediate slopes" },
  { km: 3, label: "3 km", hint: "recommended — room to detour or go astray" },
  { km: 5, label: "5 km", hint: "wide — alternates, fishing lakes, bail-outs" },
];

const ZOOM_CHOICES = [
  { z: 13, label: "z13", hint: "overview" },
  {
    z: 14,
    label: "z14",
    hint: "recommended — the full detail the 1:50,000 topo actually holds",
  },
  { z: 15, label: "z15", hint: "beyond the topo's native scale; real detail only on OpenTopoMap" },
  { z: 16, label: "z16", hint: "OpenTopoMap only — the topo is pure magnification here" },
];

type Props = {
  map: L.Map | null;
  trail: Trail | null;
  specs: LayerSpec[];
  /** The user's own marks, offered as download targets in their own right. */
  points: PersonalPoint[];
};

export default function OfflinePanel({ map, trail, specs, points }: Props) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [radiusKm, setRadiusKm] = useState(3);
  const [coverTrail, setCoverTrail] = useState(true);
  const [coverPoints, setCoverPoints] = useState(true);
  // z14 is where the Greenland topo runs out of real resolution, so it is the
  // deepest level worth storing for the basemap that matters most here.
  const [maxZoom, setMaxZoom] = useState(14);
  const [selected, setSelected] = useState<string[]>([]);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [persistWarn, setPersistWarn] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Downloading only works once the worker is in control of the page — before
  // that, fetches bypass it entirely and nothing would be cached.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const sync = () => setReady(Boolean(navigator.serviceWorker.controller));
    sync();
    navigator.serviceWorker.addEventListener("controllerchange", sync);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", sync);
  }, []);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  /*
   * Default to the primary basemap.
   *
   * The list grows: Greenland topo only joins it once the health check has
   * confirmed the proxy works, so latching onto whatever arrived first would
   * leave OpenTopoMap selected — the cross-check rather than the map you
   * actually want on the trail. So the default follows the head of the list
   * until the user expresses a preference, and never overrides them after that.
   */
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current || !specs.length) return;
    setSelected([specs[0].id]);
  }, [specs]);

  const refreshStats = useCallback(() => {
    storageStats().then(setStats).catch(() => {});
  }, []);

  // Also on mount, so the collapsed header can report what is already stored
  // without the panel having to be opened first.
  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  useEffect(() => {
    if (open) refreshStats();
  }, [open, refreshStats]);

  const chosen = useMemo(
    () => specs.filter((s) => selected.includes(s.id)),
    [specs, selected],
  );

  const region = useMemo<Region>(
    () => ({
      trail: coverTrail ? trail : null,
      points: coverPoints ? points.map((p) => ({ lat: p.lat, lon: p.lon })) : [],
      radiusKm,
    }),
    [coverTrail, coverPoints, trail, points, radiusKm],
  );

  const hasArea = Boolean(region.trail) || region.points.length > 0;

  // Counting is pure arithmetic over the route, but at z16 it touches ~20,000
  // tiles per layer — enough to stutter if it ran on every render.
  const estimate = useMemo(() => {
    if (!open || !hasArea) return null;
    let tiles = 0;
    let bytes = 0;
    for (const spec of chosen) {
      const n = planSize(spec, region, maxZoom);
      tiles += n;
      bytes += n * spec.bytesPerTile;
    }
    // Sources that run out of resolution before the requested zoom. Without
    // saying so, the estimate simply stops growing when you press z15 or z16
    // and it looks like the control is broken.
    const capped = chosen.filter((s) => s.maxNativeZoom < maxZoom);
    return { tiles, bytes, capped };
  }, [chosen, maxZoom, region, hasArea, open]);

  const start = async () => {
    if (!map || !hasArea || !chosen.length || running) return;
    setNote(null);
    setRunning(true);

    // Kept apart from `note`, which the run's own outcome will overwrite. This
    // one has to stay on screen: it is the difference between a download that
    // survives to Greenland and one iPadOS quietly reclaims.
    setPersistWarn(!(await requestPersistence()));

    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ done: 0, total: 0, cached: 0, failed: 0, bytes: 0 });

    try {
      const urls: string[] = [];
      for (const spec of chosen) urls.push(...planLayer(spec, map, region, maxZoom));
      setProgress({ done: 0, total: urls.length, cached: 0, failed: 0, bytes: 0 });

      const result = await downloadTiles(urls, {
        signal: controller.signal,
        onProgress: setProgress,
      });

      if (!controller.signal.aborted) {
        // Only after a full pass. Recording the depth of a run that was stopped
        // a tenth of the way through would cap the map at a zoom most of the
        // route never reached — exactly the blank tiles this is meant to avoid.
        rememberDepth(maxZoom);

        // Name what was actually covered. Saying "the route" after a download
        // of only the user's own points would be a promise the cache cannot
        // keep, and they would not find out until there was no signal.
        const covered: string[] = [];
        if (region.trail) covered.push("the route");
        if (region.points.length) {
          covered.push(
            region.points.length === 1 ? "your point" : `your ${region.points.length} points`,
          );
        }

        // Plural verb for a compound subject ("the route and your point"), or
        // for more than one point on its own.
        const plural = covered.length > 1 || region.points.length > 1;
        const subject = covered.join(" and ");

        setNote(
          result.failed > 0
            ? `Finished with ${result.failed} tile${result.failed === 1 ? "" : "s"} missing. ` +
              "Run it again on a better connection to fill the gaps."
            : `Download complete. ${subject.charAt(0).toUpperCase()}${subject.slice(1)} ` +
              `now ${plural ? "work" : "works"} with the network switched off.`,
        );
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Download failed.");
    } finally {
      abortRef.current = null;
      setRunning(false);
      refreshStats();
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    setNote("Stopped. Tiles already downloaded are kept — starting again resumes from there.");
    refreshStats();
  };

  const wipe = async () => {
    if (!window.confirm("Delete all downloaded map tiles? This cannot be undone offline.")) return;
    await clearTiles();
    forgetDepth();
    setProgress(null);
    setNote("Downloaded tiles deleted.");
    refreshStats();
  };

  useEffect(() => () => abortRef.current?.abort(), []);

  const pct =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <aside className={`offline${open ? "" : " offline-closed"}`} aria-label="Offline maps">
      <button
        type="button"
        className="offline-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="offline-head-text">
          <span className="offline-title">
            Offline maps
            {!online && <span className="offline-badge">NO SIGNAL</span>}
          </span>
          <span className="offline-sub">
            {stats?.tiles
              ? `${stats.tiles.toLocaleString()} tiles stored${
                  stats.usage !== null ? ` · ${formatBytes(stats.usage)}` : ""
                }`
              : "Download the trail before you leave"}
          </span>
        </span>
        <span className="offline-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="offline-body">
          {!ready && (
            <p className="offline-warn">
              Offline storage is still starting up. Reload the page once, then come back.
            </p>
          )}

          <fieldset className="offline-field">
            <legend>Basemap</legend>
            {specs.map((spec) => (
              <label key={spec.id} className="offline-check">
                <input
                  type="checkbox"
                  checked={selected.includes(spec.id)}
                  disabled={running}
                  onChange={(e) => {
                    touched.current = true;
                    setSelected((prev) =>
                      e.target.checked
                        ? [...prev, spec.id]
                        : prev.filter((id) => id !== spec.id),
                    );
                  }}
                />
                <span>
                  <strong>{spec.label}</strong>
                  {spec.note && <em className="offline-hint">{spec.note}</em>}
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="offline-field">
            <legend>Cover</legend>
            <label className="offline-check">
              <input
                type="checkbox"
                checked={coverTrail}
                disabled={running || !trail}
                onChange={(e) => setCoverTrail(e.target.checked)}
              />
              <span>
                <strong>The trail</strong>
                <em className="offline-hint">
                  {trail
                    ? "a corridor along the whole route"
                    : "the route has not loaded, so it cannot be planned"}
                </em>
              </span>
            </label>
            <label className="offline-check">
              <input
                type="checkbox"
                checked={coverPoints}
                disabled={running || points.length === 0}
                onChange={(e) => setCoverPoints(e.target.checked)}
              />
              <span>
                <strong>
                  My points
                  {points.length > 0 && ` (${points.length})`}
                </strong>
                <em className="offline-hint">
                  {points.length === 0
                    ? "none saved yet — add them in My points, then come back"
                    : "the ground around each of your own marks, wherever they are"}
                </em>
              </span>
            </label>
            {!hasArea && (
              <p className="offline-hint">
                Nothing selected, so there is nothing to download.
              </p>
            )}
          </fieldset>

          <fieldset className="offline-field">
            <legend>Radius around each</legend>
            <div className="offline-choices">
              {RADIUS_CHOICES.map((c) => (
                <button
                  key={c.km}
                  type="button"
                  disabled={running}
                  className={`offline-chip${radiusKm === c.km ? " offline-chip-on" : ""}`}
                  onClick={() => setRadiusKm(c.km)}
                  title={c.hint}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <p className="offline-hint">{RADIUS_CHOICES.find((c) => c.km === radiusKm)?.hint}</p>
          </fieldset>

          <fieldset className="offline-field">
            <legend>Detail</legend>
            <div className="offline-choices">
              {ZOOM_CHOICES.map((c) => (
                <button
                  key={c.z}
                  type="button"
                  disabled={running}
                  className={`offline-chip${maxZoom === c.z ? " offline-chip-on" : ""}`}
                  onClick={() => setMaxZoom(c.z)}
                  title={c.hint}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <p className="offline-hint">{ZOOM_CHOICES.find((c) => c.z === maxZoom)?.hint}</p>
          </fieldset>

          {estimate && (
            <p className="offline-estimate">
              <strong>{estimate.tiles.toLocaleString()}</strong> tiles ·{" "}
              <strong>~{formatBytes(estimate.bytes)}</strong>
              <span className="offline-hint">
                Estimate only. Tiles already stored are skipped, so a repeat run is far quicker.
              </span>
              {estimate.capped.length > 0 && (
                <span className="offline-hint">
                  {estimate.capped.map((s) => `${s.label} (z${s.maxNativeZoom})`).join(", ")}{" "}
                  {estimate.capped.length === 1 ? "stops" : "stop"} short of z{maxZoom}, so nothing
                  further is downloaded for {estimate.capped.length === 1 ? "it" : "them"} — the
                  map upscales what is stored instead.
                </span>
              )}
            </p>
          )}

          {progress && (
            <div className="offline-progress">
              <div className="offline-bar" role="progressbar" aria-valuenow={pct}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <span className="offline-hint">
                {progress.done.toLocaleString()} / {progress.total.toLocaleString()} ·{" "}
                {formatBytes(progress.bytes)} downloaded
                {progress.cached > 0 && ` · ${progress.cached.toLocaleString()} already stored`}
                {progress.failed > 0 && ` · ${progress.failed.toLocaleString()} failed`}
              </span>
            </div>
          )}

          <div className="offline-actions">
            {running ? (
              <button type="button" className="act-btn" onClick={cancel}>
                Stop
              </button>
            ) : (
              <button
                type="button"
                className="act-btn act-btn-primary"
                onClick={start}
                disabled={!ready || !online || !hasArea || !chosen.length}
              >
                {online ? "Download" : "Offline — cannot download"}
              </button>
            )}
            <button
              type="button"
              className="act-btn"
              onClick={wipe}
              disabled={running || !stats?.tiles}
            >
              Delete
            </button>
          </div>

          {note && <p className="offline-note">{note}</p>}

          {persistWarn && (
            <p className="offline-note">
              iPadOS would not mark this storage as permanent, so it may be reclaimed if the
              device runs low on space — and there is no way to re-download it on the trail. Add
              the app to the Home Screen, open it from there, and download again.
            </p>
          )}

          {stats && (
            <p className="offline-hint offline-storage">
              {stats.persisted
                ? "Storage is marked permanent — iPadOS will not evict it."
                : "Storage is not marked permanent. Add this to the Home Screen for the download to survive."}
              {stats.quota !== null &&
                ` Space available: ${formatBytes(Math.max(0, stats.quota - (stats.usage ?? 0)))}.`}
            </p>
          )}

          <p className="offline-hint">
            Tiles come from third-party services. Download the corridor you need and no more —
            these are free, volunteer-funded servers, and OpenTopoMap in particular asks that bulk
            downloading be kept modest.
          </p>
        </div>
      )}
    </aside>
  );
}
