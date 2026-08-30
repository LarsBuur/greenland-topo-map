import type { Metadata } from "next";
import { TRAIL_MARK_COUNT, TRAIL_SAR, TRAIL_STAGES, TRAIL_TOTAL_KM } from "@/lib/trail-stages";
import { DIRECTION_NOTE, SAR_COLOR } from "@/lib/trail";
import {
  BY_ID,
  DAYS,
  KIND_LABEL,
  KIND_COLOR,
  POINT_ZOOM,
  WAYPOINTS,
  hashFor,
  type Waypoint,
} from "@/lib/waypoints";

export const metadata: Metadata = {
  title: "ACT hotlinks — huts, trailheads, river crossings",
  description:
    "Every Arctic Circle Trail waypoint as a shareable map link that works on a phone.",
};

function CoordLink({ w, zoom = POINT_ZOOM }: { w: Waypoint; zoom?: number }) {
  return (
    <a className="coord" href={`/${hashFor(w.lat, w.lon, zoom)}`}>
      {w.lat.toFixed(6)}, {w.lon.toFixed(6)}
    </a>
  );
}

function Dot({ w }: { w: Waypoint }) {
  return <span className="dot" style={{ background: KIND_COLOR[w.kind] }} aria-hidden="true" />;
}

export default function LinksPage() {
  const huts = WAYPOINTS.filter((w) => w.kind === "hut");
  const altHuts = WAYPOINTS.filter((w) => w.kind === "hut-alt");
  const towns = WAYPOINTS.filter((w) => w.kind === "town");
  const trailheads = WAYPOINTS.filter((w) => w.kind === "trailhead");
  const rivers = WAYPOINTS.filter((w) => w.kind === "river");
  const lodges = WAYPOINTS.filter((w) => w.kind === "lodge");

  return (
    <main className="page">
      <header className="page-head">
        <h1>Arctic Circle Trail — map hotlinks</h1>
        <p className="lede">
          Every link opens the Greenland 1:50,000 topographic map centred on that point, with a
          pin. Works on a phone — no JOSM, no desktop needed.
        </p>
        <p className="head-actions">
          <a className="btn" href="/">
            Open the map
          </a>
          <a className="btn" href="/ACT-North-Trail.gpx" download>
            Download GPX ({TRAIL_TOTAL_KM.toFixed(0)} km track, {TRAIL_MARK_COUNT} km marks)
          </a>
        </p>
      </header>

      <section>
        <h2>Day by day</h2>
        <ol className="days">
          {DAYS.map((day) => (
            <li key={day.date}>
              <div className="day-head">
                <span className="day-date">{day.date}</span>
                <span className="day-label">{day.label}</span>
                {day.km !== undefined && <span className="day-km">~{day.km} km</span>}
              </div>
              <p className="day-note">{day.note}</p>
              <ul className="chips">
                {day.points.map((id) => {
                  const w = BY_ID[id];
                  if (!w) return null;
                  return (
                    <li key={id}>
                      <a className="chip" href={`/${hashFor(w.lat, w.lon)}`}>
                        <Dot w={w} />
                        {w.name}
                        {w.approx && <span className="approx" title="Approximate position">~</span>}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
        <p className="note">
          Mon 24 Aug ends at the house by Hundesø, which has no coordinates in the GPX or the
          itinerary — no link for it yet.
        </p>
      </section>

      <section>
        <h2>Trail stages (official route)</h2>
        <p className="lede">
          The nine hut-to-hut stages as mapped by arcticcircletrail.gl, {TRAIL_TOTAL_KM.toFixed(1)}{" "}
          km in total. These are the trail&rsquo;s own sections and don&rsquo;t line up one-to-one
          with the walking days above.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Stage</th>
                <th className="num">km</th>
                <th className="num">Ascent</th>
                <th className="num">Descent</th>
                <th>Terrain notes</th>
              </tr>
            </thead>
            <tbody>
              {TRAIL_STAGES.map((s) => (
                <tr key={s.order}>
                  <td className="num">{s.order}</td>
                  <td>
                    {s.label}
                    {s.labelKm !== null && Math.abs(s.labelKm - s.km) >= 1 && (
                      <span className="kind">signed as {s.labelKm} km</span>
                    )}
                  </td>
                  <td className="num">{s.km.toFixed(1)}</td>
                  <td className="num">{s.ascent !== null ? `${s.ascent} m` : "—"}</td>
                  <td className="num">{s.descent !== null ? `${s.descent} m` : "—"}</td>
                  <td className="desc">{s.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">{DIRECTION_NOTE}</p>
      </section>

      <section>
        <h2>Access / SAR points</h2>
        <p className="lede">
          Where an operator can reach you, from the official ACT map. Six points along the route,
          west to east. Exact pickup spots depend on tides or the road and must be agreed with the
          operator directly.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Point</th>
                <th>Coordinates (map link)</th>
                <th>Transfers &amp; self-rescue</th>
              </tr>
            </thead>
            <tbody>
              {TRAIL_SAR.map((s) => (
                <tr key={s.name}>
                  <td>
                    <span className="dot" style={{ background: SAR_COLOR }} aria-hidden="true" />
                    {s.name}
                  </td>
                  <td>
                    <a className="coord" href={`/${hashFor(s.lat, s.lon)}`}>
                      {s.lat.toFixed(6)}, {s.lon.toFixed(6)}
                    </a>
                    {s.statedOffByM !== null && s.stated && (
                      <span className="approx-tag">
                        source text says {s.stated.lat}, {s.stated.lon} ({s.statedOffByM} m away)
                      </span>
                    )}
                  </td>
                  <td className="desc">
                    {s.operators.map((o, i) => (
                      <span key={o.url}>
                        {i > 0 && " · "}
                        <a href={o.url} target="_blank" rel="noopener noreferrer">
                          {o.name}
                        </a>
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="warn">
          These are transfer and self-rescue contacts, not an emergency service. For a real
          emergency use your satellite device&rsquo;s SOS — Greenland Police and Arctic Command
          coordinate rescue, and Garmin IERCC relays an inReach SOS to them.
        </p>
      </section>

      <Group title="Before the trail (9–16 Aug)" items={lodges} zoom={12} />
      <Group title="Huts" items={huts} showSleeps />
      <Group title="Huts — southern route (optional)" items={altHuts} showSleeps />
      <Group title="Towns" items={towns} zoom={12} />
      <Group title="Trailheads (17 Aug)" items={trailheads} />

      <section>
        <h2>River crossings</h2>
        <p className="warn">
          These positions are <strong>estimates</strong>. There is no official list of the
          route&rsquo;s rivers, most are unnamed streams, and depth swings with weather and
          meltwater. Use them to know what is coming, never to navigate.
        </p>
        <Table items={rivers} />
      </section>

      <footer className="page-foot">
        <p>
          Topographic map: Klimadatastyrelsen (Dataforsyningen), <code>gl_aabent_land</code>.
          Fallback basemap: OpenStreetMap contributors.
        </p>
        <p className="warn">
          Clear water means fish; grey milky meltwater means none. No mobile coverage on most of
          the route — carry satellite communication.
        </p>
      </footer>
    </main>
  );
}

function Group({
  title,
  items,
  showSleeps = false,
  zoom,
}: {
  title: string;
  items: Waypoint[];
  showSleeps?: boolean;
  zoom?: number;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2>{title}</h2>
      <Table items={items} showSleeps={showSleeps} zoom={zoom} />
    </section>
  );
}

function Table({
  items,
  showSleeps = false,
  zoom,
}: {
  items: Waypoint[];
  showSleeps?: boolean;
  zoom?: number;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Place</th>
            {showSleeps && <th className="num">Sleeps</th>}
            <th>Coordinates (map link)</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {items.map((w) => (
            <tr key={w.id} id={w.id}>
              <td>
                <Dot w={w} />
                {w.name}
                <span className="kind">{KIND_LABEL[w.kind]}</span>
              </td>
              {showSleeps && <td className="num">{w.sleeps ?? "—"}</td>}
              <td>
                <CoordLink w={w} zoom={zoom} />
                {w.approx && <span className="approx-tag">approx.</span>}
              </td>
              <td className="desc">{w.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
