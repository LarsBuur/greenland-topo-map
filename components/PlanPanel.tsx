"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  PLAN_DAYS,
  PLAN_FOOTNOTE,
  PLAN_SUBTITLE,
  PLAN_TITLE,
  PLAN_TOTAL_KM,
  PLAN_TOTAL_LABEL,
  type RouteStop,
} from "@/lib/itinerary";
import { BY_ID, hashFor } from "@/lib/waypoints";

/** Minimal inline markup: **bold** and [text](href), rendered as React nodes. */
const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(<strong key={key++}>{m[1]}</strong>);
    } else {
      out.push(
        <a key={key++} href={m[3]}>
          {m[2]}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Today as a local YYYY-MM-DD — not toISOString(), which would be UTC. */
function localISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A route stop: a map link when the place has coordinates, plain text if not. */
function Stop({ stop }: { stop: RouteStop }) {
  const w = stop.id ? BY_ID[stop.id] : undefined;
  if (!w) return <span>{stop.label}</span>;
  return (
    <a
      className="plan-stop"
      href={`/${hashFor(w.lat, w.lon)}`}
      title={`${w.name} — ${w.lat.toFixed(5)}, ${w.lon.toFixed(5)}`}
    >
      {stop.label}
    </a>
  );
}

export default function PlanPanel() {
  // Collapsed by default on a phone, where an open panel would cover the map.
  const [open, setOpen] = useState(true);
  // Resolved on the client so the highlight follows the viewer's own date
  // rather than whenever the page happened to be built.
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => {
    setOpen(!window.matchMedia("(max-width: 700px)").matches);
    setToday(localISODate(new Date()));
  }, []);

  return (
    <aside className={`plan${open ? "" : " plan-closed"}`} aria-label={PLAN_TITLE}>
      <button
        type="button"
        className="plan-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="plan-head-text">
          <span className="plan-title">{PLAN_TITLE}</span>
          <span className="plan-sub">{PLAN_SUBTITLE}</span>
        </span>
        <span className="plan-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="plan-body">
          {PLAN_DAYS.map((day) => {
            // A span (the lodge week) counts as "today" on every day it covers.
            const isToday =
              today !== null && today >= day.iso && today <= (day.isoEnd ?? day.iso);
            return (
              <article
                className={`plan-day${isToday ? " plan-day-today" : ""}`}
                key={day.iso}
                aria-current={isToday ? "date" : undefined}
              >
                <div className="plan-day-head">
                  <span className="plan-date">{day.date}</span>
                  {isToday && <span className="plan-tag plan-tag-today">TODAY</span>}
                  {day.tag && <span className="plan-tag">{day.tag}</span>}
                  {day.km !== undefined && (
                    <span className="plan-km">
                      {day.approx ? "~" : ""}
                      {day.km} km
                    </span>
                  )}
                </div>

                <p className="plan-route">
                  {day.route.map((stop, i) => (
                    <span key={`${day.iso}-${i}`}>
                      {i > 0 && <span className="plan-arrow"> → </span>}
                      <Stop stop={stop} />
                    </span>
                  ))}
                  {day.via && (
                    <span className="plan-via">
                      {" "}
                      via <Stop stop={day.via} />
                    </span>
                  )}
                </p>

                {day.fishing && (
                  <p className="plan-fish">
                    <span className="plan-label">Fishing</span>
                    {renderInline(day.fishing)}
                  </p>
                )}
                <p className="plan-note">{renderInline(day.note)}</p>
              </article>
            );
          })}

          <div className="plan-total">
            <span>{PLAN_TOTAL_LABEL}</span>
            <strong>~{PLAN_TOTAL_KM} km</strong>
          </div>
          <p className="plan-foot">{PLAN_FOOTNOTE}</p>
          <p className="plan-foot plan-foot-links">
            <a href="/links">All map links, stages and SAR points →</a>
          </p>
        </div>
      )}
    </aside>
  );
}
