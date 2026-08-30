/**
 * Lars's personal day-by-day plan, shown in the side panel.
 *
 * Route stops are structured rather than a single string, so each place can be
 * linked to its position on the map. `id` refers to a waypoint in
 * `lib/waypoints.ts`; a stop without one has no known coordinates (Hundesø) or
 * is not a place at all ("taxi").
 *
 * `iso` is the local calendar date, used to highlight the current day while the
 * trip is running.
 *
 * `note` and `fishing` accept a minimal inline subset: **bold** and
 * [text](href). Links are relative (`/#zoom/lat/lon`) so clicking one is a
 * same-document hash change that moves the map instead of a full page load.
 */

export type RouteStop = {
  label: string;
  /** Waypoint id in lib/waypoints.ts, when the place has coordinates. */
  id?: string;
};

export type PlanDay = {
  /** Local calendar date, YYYY-MM-DD. */
  iso: string;
  /** Last day, for an entry spanning several days (the lodge week). */
  isoEnd?: string;
  /** e.g. "Mon 17 Aug" */
  date: string;
  /** Short marker shown as a chip. */
  tag?: string;
  /** Walking route, rendered as stops joined by arrows. */
  route: RouteStop[];
  /** Optional "via …" qualifier, e.g. a bridge. */
  via?: RouteStop;
  /** Fishing note; omitted where there is none. */
  fishing?: string;
  note: string;
  /** Walking distance; omitted where the day involves no walking. */
  km?: number;
  /** Render the distance as "~3 km". */
  approx?: boolean;
};

export const PLAN_TITLE = "Itinerary";

export const PLAN_SUBTITLE =
  "Lars · Erfalik Lodge 9–16 Aug · Sisimiut → Kangerlussuaq 17–25 Aug · hut to hut, with fishing";

export const PLAN_DAYS: PlanDay[] = [
  {
    iso: "2026-08-09",
    isoEnd: "2026-08-16",
    date: "Sun 9 – Sun 16 Aug",
    tag: "LODGE",
    route: [{ label: "Erfalik Lodge", id: "erfalik-lodge" }],
    fishing: "**Arctic char** in the Erfalik river — the whole point of the week",
    note:
      "A week at [Erfalik Lodge](/#13/66.426330/-53.609800), about 60 km south of Sisimiut. " +
      "Ends Sun 16 Aug, the day before the trail starts.",
  },
  {
    iso: "2026-08-17",
    date: "Mon 17 Aug",
    tag: "START",
    route: [
      { label: "Trailhead", id: "trailhead-main" },
      { label: "Kangerluarsuk Tulleq Nord", id: "kangerluarsuk-tulleq-nord" },
    ],
    fishing: "Arctic char by the hut and in the fjord",
    note:
      "09:00 buy gas · leave spare baggage at **Tusass** · taxi to the trailhead " +
      "([66.9409, -53.6118](/#13/66.940900/-53.611800), or the " +
      "[UFO point at 66.9524, -53.5804](/#13/66.952400/-53.580400), a small detour). " +
      "Hardest day: the climb over the pass.",
    km: 22,
  },
  {
    iso: "2026-08-18",
    date: "Tue 18 Aug",
    route: [
      { label: "Kangerluarsuk Tulleq Nord", id: "kangerluarsuk-tulleq-nord" },
      { label: "Nerumaq", id: "nerumaq" },
    ],
    fishing: "Along the way, in the clear stretches",
    note: "Boggy valley with willow scrub and several small rivers. Easy stage.",
    km: 17,
  },
  {
    iso: "2026-08-19",
    date: "Wed 19 Aug",
    route: [
      { label: "Nerumaq", id: "nerumaq" },
      { label: "Innajuatooq II (Lake House)", id: "innajuatooq-2" },
    ],
    fishing: "Char at the lake outlet, ~3 km before the hut",
    note: "Best hut on the route: 10 places, lake view, dry toilet.",
    km: 17,
  },
  {
    iso: "2026-08-20",
    date: "Thu 20 Aug",
    route: [
      { label: "Innajuatooq II", id: "innajuatooq-2" },
      { label: "Eqalugaarniarfik", id: "eqalugaarniarfik" },
    ],
    fishing: "A little along the way",
    note: "Longest pure walking day. Read the notes in the hut about the water source.",
    km: 21,
  },
  {
    iso: "2026-08-21",
    date: "Fri 21 Aug",
    route: [
      { label: "Eqalugaarniarfik", id: "eqalugaarniarfik" },
      { label: "Ikkattooq", id: "ikkattooq" },
    ],
    via: { label: "the Itinneq bridge", id: "river-itinneq" },
    fishing: "**At the Itinneq bridge** — running char",
    note:
      "Short day, so use the spare time at the bridge. The bridge is a dry crossing of the " +
      "route's largest river.",
    km: 11,
  },
  {
    iso: "2026-08-22",
    date: "Sat 22 Aug",
    route: [
      { label: "Ikkattooq", id: "ikkattooq" },
      { label: "Canoe Centre", id: "canoe-centre" },
    ],
    fishing: "The river running into the big lake halfway along",
    note: "Large hut (21 places), charging point at Amitsorsuaq.",
    km: 22,
  },
  {
    iso: "2026-08-23",
    date: "Sun 23 Aug",
    route: [
      { label: "Canoe Centre", id: "canoe-centre" },
      { label: "Katiffik", id: "katiffik" },
    ],
    fishing: "Amitsorsuaq, known for char",
    note: "**Canoe option:** paddle the lake instead of walking, if a canoe is free.",
    km: 20,
  },
  {
    iso: "2026-08-24",
    date: "Mon 24 Aug",
    route: [
      { label: "Katiffik", id: "katiffik" },
      { label: "the house at Hundesø" },
    ],
    note:
      "**Key day for the flight:** get as far east as possible. Getting past Hundesø makes " +
      "Tuesday easier still.",
    km: 20,
  },
  {
    iso: "2026-08-25",
    date: "Tue 25 Aug",
    tag: "FLIGHT",
    route: [
      { label: "Hundesø" },
      { label: "road (2–3 km)" },
      { label: "taxi" },
      { label: "Kangerlussuaq", id: "kangerlussuaq" },
    ],
    note:
      "Easy: only 2–3 km to the road. Collect your gear at Tusass, check in, flight at 13:00. " +
      "Missing it means losing the ticket.",
    km: 3,
    approx: true,
  },
];

/** Total as stated in the source, not a sum of the rows above. */
export const PLAN_TOTAL_KM = 150;

export const PLAN_TOTAL_LABEL = "Total on foot";

export const PLAN_FOOTNOTE =
  "~150 km of walking, plus 2–3 km to the road on Tuesday. Eight walking days with no rest " +
  "day — everything has to go right to catch the flight.";
