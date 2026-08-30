// Waypoints for the Arctic Circle Trail (Sisimiut -> Kangerlussuaq).
//
// Huts, towns and trailheads use precise coordinates. River crossings marked
// `approx: true` are estimated positions only — the real fording point moves
// with weather and meltwater. Do not navigate by them.
//
// Source: Arctic-Circle-Trail.gpx + ACT-Personal-Itinerary.md

export type WaypointKind = "town" | "hut" | "hut-alt" | "river" | "trailhead" | "lodge";

export type Waypoint = {
  /** Stable slug, used in link anchors. */
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: WaypointKind;
  /** Sleeping capacity, for huts. */
  sleeps?: string;
  /** Position is an estimate, not a surveyed point. */
  approx?: boolean;
  desc: string;
};

/** Default zoom for a single-point hotlink. */
export const POINT_ZOOM = 13;

/** Fallback view: all of West Greenland, per the spec. */
export const DEFAULT_VIEW = { zoom: 6, lat: 67.0, lon: -50.0 };

export const WAYPOINTS: Waypoint[] = [
  // --- Towns -------------------------------------------------------------
  {
    id: "sisimiut",
    name: "Sisimiut (START)",
    lat: 66.9395,
    lon: -53.6735,
    kind: "town",
    desc: "Start town. Day 1 climbs the pass by Nasaasaaq.",
  },
  {
    id: "kangerlussuaq",
    name: "Kangerlussuaq (FINISH)",
    lat: 67.0122,
    lon: -50.6886,
    kind: "town",
    desc: "Finish town by the ice sheet. No huts on the last ~37 km from Katiffik.",
  },

  // --- Before the trail ---------------------------------------------------
  {
    id: "erfalik-lodge",
    name: "Erfalik Lodge",
    lat: 66.42633,
    lon: -53.6098,
    kind: "lodge",
    desc:
      "Fishing lodge on the Erfalik river, about 60 km south of Sisimiut. Base for the char week, " +
      "Sun 9 – Sun 16 Aug, before the trail starts.",
  },

  // --- Trailheads (day 1 options) ----------------------------------------
  {
    id: "trailhead-main",
    name: "Trailhead (taxi drop-off)",
    lat: 66.9409,
    lon: -53.6118,
    kind: "trailhead",
    desc: "Standard trailhead. Taxi from Sisimiut, Mon 17 Aug.",
  },
  {
    id: "trailhead-ufo",
    name: "Trailhead — UFO point",
    lat: 66.9524,
    lon: -53.5804,
    kind: "trailhead",
    desc: "Alternative start, a small detour compared to the standard trailhead.",
  },

  // --- Huts (precise coordinates) ----------------------------------------
  {
    id: "kangerluarsuk-tulleq-syd",
    name: "Kangerluarsuk Tulleq Syd",
    lat: 66.98024,
    lon: -53.251228,
    kind: "hut",
    sleeps: "6",
    desc: "Small cooking bench. About 2 km from the Nord hut.",
  },
  {
    id: "kangerluarsuk-tulleq-nord",
    name: "Kangerluarsuk Tulleq Nord",
    lat: 66.9879,
    lon: -53.205986,
    kind: "hut",
    sleeps: "6+",
    desc: "Large cooking and eating area, right by the fjord. Night 1 (Mon 17 Aug).",
  },
  {
    id: "nerumaq",
    name: "Nerumaq",
    lat: 67.005844,
    lon: -52.965691,
    kind: "hut",
    sleeps: "6",
    desc: "Small cooking bench. Boggy valley with willow scrub and several stream crossings. Night 2 (Tue 18 Aug).",
  },
  {
    id: "innajuatooq-2",
    name: "Innajuatooq II (Lake House)",
    lat: 67.056519,
    lon: -52.628017,
    kind: "hut",
    sleeps: "10+",
    desc: "Best hut on the route: large kitchen, lake view, dry toilet. Night 3 (Wed 19 Aug).",
  },
  {
    id: "innajuatooq-1",
    name: "Innajuatooq I",
    lat: 67.056667,
    lon: -52.614664,
    kind: "hut",
    sleeps: "6",
    desc: "Small cooking bench. First of the two Innajuatooq huts.",
  },
  {
    id: "eqalugaarniarfik",
    name: "Eqalugaarniarfik",
    lat: 66.995605,
    lon: -52.356991,
    kind: "hut",
    sleeps: "4+",
    desc: 'Name means "the place where you catch Arctic char" — good fishing river here. Read the notes in the hut about the water source. Night 4 (Thu 20 Aug).',
  },
  {
    id: "ikkattooq",
    name: "Ikkattooq",
    lat: 66.971863,
    lon: -52.170223,
    kind: "hut",
    sleeps: "6",
    desc: "Small cooking bench, fine views. Night 5 (Fri 21 Aug).",
  },
  {
    id: "canoe-centre",
    name: "Canoe Centre",
    lat: 66.921463,
    lon: -51.747997,
    kind: "hut",
    sleeps: "21+",
    desc: "Big kitchen, two dorms, charging point, dry toilet. On Amitsorsuaq lake — look for canoes. Night 6 (Sat 22 Aug).",
  },
  {
    id: "katiffik",
    name: "Katiffik",
    lat: 66.920334,
    lon: -51.360867,
    kind: "hut",
    sleeps: "6",
    desc: "Small cooking bench, dry toilet, views over Amitsorsuaq. Look for canoes. Night 7 (Sun 23 Aug).",
  },

  // --- Southern route huts (optional) ------------------------------------
  {
    id: "uttoqqaat",
    name: "Uttoqqaat (southern route)",
    lat: 66.92108,
    lon: -53.07003,
    kind: "hut-alt",
    sleeps: "6",
    desc: "About 1 km off the main trail. Not really a trail hut; used by anglers.",
  },
  {
    id: "ilagassat",
    name: "Ilagassat / Igalassat (southern route)",
    lat: 66.93645,
    lon: -52.5876,
    kind: "hut-alt",
    sleeps: "6",
    desc: "Small cooking bench, outdoor dry toilet.",
  },

  // --- River crossings (approximate) -------------------------------------
  {
    id: "river-kangerluarsuk",
    name: "Kangerluarsuk tidal river",
    lat: 66.987,
    lon: -53.212,
    kind: "river",
    approx: true,
    desc: "Tidal outlet at the fjord. Easiest at low tide. Fish: yes.",
  },
  {
    id: "river-nerumaq",
    name: "Nerumaq valley river",
    lat: 66.998,
    lon: -53.07,
    kind: "river",
    approx: true,
    desc: "About 10–12 m wide, typically knee- to thigh-deep. Several crossings in boggy willow scrub. Fish: yes in the clear stretches.",
  },
  {
    id: "river-itinneq",
    name: "Itinneq / Ole's Lakseelv — bridge",
    lat: 66.984,
    lon: -52.264,
    kind: "river",
    approx: true,
    desc: "The largest river on the route, glacier-cold. Crossed dry on the bridge — do not wade if the bridge is standing. Fish from the bridge (running char).",
  },
  {
    id: "river-innajuatooq",
    name: "Innajuatooq outlet river",
    lat: 67.05,
    lon: -52.61,
    kind: "river",
    approx: true,
    desc: "Drains the lake by the huts. Cross where it leaves the lake. Fish: yes — inlets and outlets are hotspots.",
  },
  {
    id: "river-amitsorsuaq",
    name: "Amitsorsuaq outlet",
    lat: 66.93,
    lon: -51.95,
    kind: "river",
    approx: true,
    desc: "At the end of the lake. You do not wade along the lake — walk the shore or paddle a canoe. Fish: yes, known for char.",
  },
];

export const BY_ID: Record<string, Waypoint> = Object.fromEntries(
  WAYPOINTS.map((w) => [w.id, w]),
);

export const KIND_LABEL: Record<WaypointKind, string> = {
  town: "Town",
  hut: "Hut",
  "hut-alt": "Hut (southern route)",
  river: "River crossing",
  trailhead: "Trailhead",
  lodge: "Fishing lodge",
};

/** Marker colour per kind. */
export const KIND_COLOR: Record<WaypointKind, string> = {
  town: "#d9480f",
  hut: "#1971c2",
  "hut-alt": "#5f7d95",
  river: "#0ca678",
  trailhead: "#6741d9",
  lodge: "#c2255c",
};

/** The hash form the whole app shares: #zoom/lat/lon */
export function hashFor(lat: number, lon: number, zoom: number = POINT_ZOOM) {
  return `#${zoom}/${lat.toFixed(6)}/${lon.toFixed(6)}`;
}

/** Day-by-day plan, for the hotlink index. */
export type Day = {
  date: string;
  label: string;
  km?: number;
  note: string;
  /** Waypoint ids relevant to the day, in walking order. */
  points: string[];
};

export const DAYS: Day[] = [
  {
    date: "Sun 9 – Sun 16 Aug",
    label: "Erfalik Lodge — Arctic char",
    note: "A week at the lodge on the Erfalik river before the trail. No walking days.",
    points: ["erfalik-lodge"],
  },
  {
    date: "Mon 17 Aug",
    label: "Trailhead → Kangerluarsuk Tulleq Nord",
    km: 22,
    note: "09:00 buy gas, leave spare baggage at Tusass, taxi to the trailhead. Hardest day: the climb over the pass.",
    points: [
      "sisimiut",
      "trailhead-main",
      "trailhead-ufo",
      "river-kangerluarsuk",
      "kangerluarsuk-tulleq-nord",
    ],
  },
  {
    date: "Tue 18 Aug",
    label: "Kangerluarsuk Tulleq Nord → Nerumaq",
    km: 17,
    note: "Boggy valley with willow scrub, several small rivers. Easy stage.",
    points: ["kangerluarsuk-tulleq-nord", "river-nerumaq", "nerumaq"],
  },
  {
    date: "Wed 19 Aug",
    label: "Nerumaq → Innajuatooq II (Lake House)",
    km: 17,
    note: "Char at the lake outlet ~3 km before the hut. Best hut on the route.",
    points: ["nerumaq", "river-innajuatooq", "innajuatooq-2", "innajuatooq-1"],
  },
  {
    date: "Thu 20 Aug",
    label: "Innajuatooq II → Eqalugaarniarfik",
    km: 21,
    note: "Longest pure walking day. Read the notes in the hut about the water source.",
    points: ["innajuatooq-2", "eqalugaarniarfik"],
  },
  {
    date: "Fri 21 Aug",
    label: "Eqalugaarniarfik → Ikkattooq (via the Itinneq bridge)",
    km: 11,
    note: "Short day — spend the spare time fishing at the bridge. The bridge is a dry crossing of the route's largest river.",
    points: ["eqalugaarniarfik", "river-itinneq", "ikkattooq"],
  },
  {
    date: "Sat 22 Aug",
    label: "Ikkattooq → Canoe Centre",
    km: 22,
    note: "Big hut (21 places), charging point at Amitsorsuaq.",
    points: ["ikkattooq", "river-amitsorsuaq", "canoe-centre"],
  },
  {
    date: "Sun 23 Aug",
    label: "Canoe Centre → Katiffik",
    km: 20,
    note: "Amitsorsuaq is known for char. Canoe option: paddle the lake instead of walking, if one is free.",
    points: ["canoe-centre", "katiffik"],
  },
  {
    date: "Mon 24 Aug",
    label: "Katiffik → house at Hundesø",
    km: 20,
    note: "Key day for the flight: get as far east as possible. Further than Hundesø makes Tuesday easier still.",
    points: ["katiffik"],
  },
  {
    date: "Tue 25 Aug",
    label: "Hundesø → road (2–3 km) → taxi → Kangerlussuaq",
    km: 3,
    note: "Only 2–3 km to the road. Collect gear at Tusass, check in, flight 13:00. Missing it means losing the ticket.",
    points: ["kangerlussuaq"],
  },
];
