"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The device's own position.
 *
 * Deliberately nothing to do with the inReach. The Garmin feed needs the device
 * to have sent a tracking point *and* the phone to have internet, so on the
 * trail it gives you nothing — while the phone's own GNSS receiver works with
 * no signal at all, in Airplane Mode, as long as Location Services is on.
 *
 * On-demand by default. A continuous watch is the right thing while actually
 * walking, but it keeps the GPS powered, so it is an explicit toggle rather
 * than something that quietly runs flat in a pocket.
 */

export type GeoFix = {
  lat: number;
  lon: number;
  /** Radius of the 95% confidence circle, in metres. Always present. */
  accuracy: number;
  altitude: number | null;
  /** Degrees true, only while moving. */
  heading: number | null;
  /** Metres per second. */
  speed: number | null;
  time: number;
};

export type GeoStatus =
  | "idle"
  | "locating"
  | "ok"
  | "denied"
  | "unavailable"
  | "timeout"
  | "unsupported";

export type GeoState = {
  status: GeoStatus;
  fix: GeoFix | null;
  message: string | null;
  following: boolean;
};

/**
 * A first fix with no cell assistance can genuinely take this long — the
 * receiver has to download almanac data off the satellites themselves. Failing
 * at the usual few seconds would report "unavailable" while it was merely busy.
 */
const FIRST_FIX_TIMEOUT = 30_000;

function toFix(p: GeolocationPosition): GeoFix {
  return {
    lat: p.coords.latitude,
    lon: p.coords.longitude,
    accuracy: p.coords.accuracy,
    altitude: p.coords.altitude,
    heading: p.coords.heading,
    speed: p.coords.speed,
    time: p.timestamp,
  };
}

function describe(err: GeolocationPositionError): { status: GeoStatus; message: string } {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return {
        status: "denied",
        message:
          "Location permission was refused. On iPadOS or iPhone, turn it on in " +
          "Settings → Privacy & Security → Location Services, and check this app is allowed.",
      };
    case err.POSITION_UNAVAILABLE:
      return {
        status: "unavailable",
        message:
          "No position available. A Wi-Fi-only iPad has no GPS receiver and can only place " +
          "itself from nearby Wi-Fi networks, so it will not work out of town at all. On a " +
          "phone, step into the open — indoors or under a cliff the sky is blocked.",
      };
    case err.TIMEOUT:
      return {
        status: "timeout",
        message:
          "Timed out waiting for a fix. Without a mobile signal the first one can take a " +
          "couple of minutes; keep the sky in view and try again.",
      };
    default:
      return { status: "unavailable", message: err.message || "Could not get a position." };
  }
}

export function useGeolocate() {
  const [state, setState] = useState<GeoState>({
    status: "idle",
    fix: null,
    message: null,
    following: false,
  });
  const watchRef = useRef<number | null>(null);

  const supported = typeof navigator !== "undefined" && "geolocation" in navigator;

  /** Take a single fix. */
  const locate = useCallback(() => {
    if (!supported) {
      setState((s) => ({
        ...s,
        status: "unsupported",
        message: "This browser cannot report a position.",
      }));
      return;
    }

    setState((s) => ({ ...s, status: "locating", message: null }));
    navigator.geolocation.getCurrentPosition(
      (p) => setState((s) => ({ ...s, status: "ok", fix: toFix(p), message: null })),
      (err) => setState((s) => ({ ...s, ...describe(err) })),
      // maximumAge 0: a cached fix from before you walked half a valley is
      // worse than waiting, because it looks current.
      { enableHighAccuracy: true, timeout: FIRST_FIX_TIMEOUT, maximumAge: 0 },
    );
  }, [supported]);

  const setFollowing = useCallback(
    (on: boolean) => setState((s) => ({ ...s, following: on && supported })),
    [supported],
  );

  // The continuous watch, mounted only while following.
  useEffect(() => {
    if (!state.following || !supported) return;

    setState((s) => (s.fix ? s : { ...s, status: "locating" }));
    const id = navigator.geolocation.watchPosition(
      (p) => setState((s) => ({ ...s, status: "ok", fix: toFix(p), message: null })),
      (err) => {
        const described = describe(err);
        // A dropped fix mid-walk is normal — under a cliff, in a tent. Stop
        // following only when the permission itself is gone; otherwise keep
        // the watch alive and let it recover.
        setState((s) => ({
          ...s,
          ...described,
          following: described.status === "denied" ? false : s.following,
        }));
      },
      { enableHighAccuracy: true, timeout: FIRST_FIX_TIMEOUT, maximumAge: 5_000 },
    );
    watchRef.current = id;

    return () => {
      navigator.geolocation.clearWatch(id);
      watchRef.current = null;
    };
  }, [state.following, supported]);

  // Belt and braces: never leave the receiver running after unmount.
  useEffect(
    () => () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    },
    [],
  );

  return { ...state, supported, locate, setFollowing };
}
