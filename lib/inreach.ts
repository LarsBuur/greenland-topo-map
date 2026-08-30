/** Shape of `/api/inreach`, shared by the route and the client that polls it. */

export type Fix = {
  name: string;
  /** ISO 8601, UTC. */
  time: string;
  lat: number;
  lon: number;
  /** Metres above MSL, or null when the feed omits it. */
  elevation: number | null;
  /** km/h, or null. */
  velocity: number | null;
  /** Degrees true, or null. */
  course: number | null;
  validFix: boolean;
  inEmergency: boolean;
  /** e.g. "Tracking interval received." */
  event: string;
  /** Free text sent from the device, if any. */
  text: string;
  deviceType: string;
};

export type InreachResponse =
  | { status: "ok"; latest: Fix | null; track: Fix[]; fetchedAt: string }
  | { status: "not-configured" | "unauthorized" | "upstream-error"; message: string };

/** "4 min ago", "2 h ago", "3 d ago" — coarse on purpose; the feed is not real-time. */
export function relativeAge(iso: string, now = Date.now()): string {
  const secs = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (secs < 90) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
