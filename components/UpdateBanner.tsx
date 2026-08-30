"use client";

import { useCallback, useEffect, useState } from "react";

const BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

/** Checked on return to the app, and hourly while it stays open. */
const POLL_MS = 60 * 60 * 1000;

/**
 * Tells the user when the app on screen is older than the app on the server.
 *
 * An iOS Home Screen web app resumes rather than reloads, so it can run the
 * same JavaScript for days. Without this, a fix ships and the person who asked
 * for it sees no change, reasonably concludes it was never done, and asks
 * again — while carrying a stale copy to somewhere with no signal.
 *
 * Prompted, never automatic: reloading out from under someone mid-way through
 * naming a point would lose it.
 */
export default function UpdateBanner() {
  const [stale, setStale] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) return;
      const { build } = (await res.json()) as { build?: string };
      if (build && BUILD !== "dev" && build !== BUILD) setStale(true);
    } catch {
      // Offline, or the check itself failed. Silence is right: this must never
      // become another thing that shouts at you on the trail.
    }
  }, []);

  useEffect(() => {
    check();
    const timer = setInterval(check, POLL_MS);
    const onShow = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("online", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("online", check);
    };
  }, [check]);

  if (!stale || dismissed) return null;

  return (
    <div className="act-banner act-banner-update" role="status">
      <div>
        <strong>A newer version is available</strong>
        <div className="act-banner-detail">
          This app has been open a while and is running an older build. Reloading keeps your
          points and your downloaded maps.
        </div>
      </div>
      <button
        type="button"
        className="act-btn act-btn-primary"
        onClick={async () => {
          // Let a waiting worker take over first, so the reload lands on the
          // new code rather than repeating the old one.
          const reg = await navigator.serviceWorker?.getRegistration();
          await reg?.update().catch(() => {});
          location.reload();
        }}
      >
        Reload
      </button>
      <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
