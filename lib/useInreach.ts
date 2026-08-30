"use client";

import { useEffect, useState } from "react";
import type { InreachResponse } from "./inreach";

/** Garmin's own tracking interval is minutes at best; polling faster buys nothing. */
const POLL_MS = 60_000;

/**
 * Poll `/api/inreach`. Returns the last response, or null before the first one
 * lands. Errors surface as the route's own error statuses so the caller has a
 * single thing to render.
 */
export function useInreach(hours = 72): InreachResponse | null {
  const [data, setData] = useState<InreachResponse | null>(null);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    const load = async () => {
      try {
        const res = await fetch(`/api/inreach?hours=${hours}`, { signal: controller.signal });
        const body: InreachResponse = await res.json();
        if (alive) setData(body);
      } catch {
        if (alive && !controller.signal.aborted) {
          setData({ status: "upstream-error", message: "Could not reach the tracking endpoint." });
        }
      }
    };

    load();
    const timer = setInterval(load, POLL_MS);
    // A tab left open on a phone in a pocket shouldn't keep polling; catch up
    // the moment it comes back instead.
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hours]);

  return data;
}
