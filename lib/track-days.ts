/**
 * The inReach track, split into days.
 *
 * Over a couple of days a single polyline is fine. Over nine it becomes a
 * scribble that hides the route underneath it, so each day is drawn separately
 * and can be switched off.
 */

import type { Fix } from "./inreach";

export type TrackDay = {
  /** Local calendar date, `YYYY-MM-DD`. The key the UI toggles on. */
  key: string;
  /** e.g. "Mon 17 Aug". */
  label: string;
  fixes: Fix[];
  km: number;
  /** 0 for the most recent day, rising into the past. Drives the fading. */
  age: number;
};

/** Local date, not UTC: a fix at 23:30 belongs to the day you were walking. */
function localKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const EARTH_R = 6371;

function haversineKm(a: Fix, b: Fix): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Group a track into days, newest last.
 *
 * Only fixes with a valid GPS lock are used: the feed reports failed attempts
 * too, and joining those into the line would draw straight legs across country
 * nobody walked.
 */
export function groupTrackByDay(track: Fix[]): TrackDay[] {
  const byDay = new Map<string, Fix[]>();

  for (const fix of track) {
    if (!fix.validFix) continue;
    const when = new Date(fix.time);
    if (Number.isNaN(when.getTime())) continue;
    const key = localKey(when);
    const list = byDay.get(key);
    if (list) list.push(fix);
    else byDay.set(key, [fix]);
  }

  const days = [...byDay.entries()]
    .map(([key, fixes]) => {
      fixes.sort((a, b) => a.time.localeCompare(b.time));
      let km = 0;
      for (let i = 1; i < fixes.length; i++) km += haversineKm(fixes[i - 1], fixes[i]);
      return {
        key,
        label: new Date(fixes[0].time).toLocaleDateString(undefined, {
          weekday: "short",
          day: "numeric",
          month: "short",
        }),
        fixes,
        km,
        age: 0,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  const newest = days.length - 1;
  for (const [i, day] of days.entries()) day.age = newest - i;
  return days;
}
