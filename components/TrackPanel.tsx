"use client";

import { useState } from "react";
import type { TrackDay } from "@/lib/track-days";

type Props = {
  days: TrackDay[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
  onShowAll: () => void;
  onShowLatestOnly: () => void;
};

export default function TrackPanel({
  days,
  hidden,
  onToggle,
  onShowAll,
  onShowLatestOnly,
}: Props) {
  const [open, setOpen] = useState(false);

  if (!days.length) return null;

  const shown = days.filter((d) => !hidden.has(d.key)).length;
  const totalKm = days.reduce((n, d) => n + d.km, 0);

  return (
    <aside className={`trk${open ? "" : " trk-closed"}`} aria-label="Tracked days">
      <button
        type="button"
        className="trk-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="trk-head-text">
          <span className="trk-title">Track</span>
          <span className="trk-sub">
            {shown} of {days.length} day{days.length === 1 ? "" : "s"} shown ·{" "}
            {totalKm.toFixed(0)} km
          </span>
        </span>
        <span className="trk-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="trk-body">
          <div className="trk-actions">
            <button type="button" className="act-btn" onClick={onShowAll}>
              Show all
            </button>
            <button type="button" className="act-btn" onClick={onShowLatestOnly}>
              Latest only
            </button>
          </div>

          <ul className="trk-list">
            {/* Newest first: the day you care about is the one you just walked. */}
            {[...days].reverse().map((day) => (
              <li key={day.key}>
                <label className="trk-day">
                  <input
                    type="checkbox"
                    checked={!hidden.has(day.key)}
                    onChange={() => onToggle(day.key)}
                  />
                  <span
                    className="trk-swatch"
                    style={{ opacity: Math.max(0.28, 1 - day.age * 0.16) }}
                    aria-hidden="true"
                  />
                  <span className="trk-day-text">
                    <span className="trk-day-label">
                      {day.label}
                      {day.age === 0 && <span className="trk-latest">latest</span>}
                    </span>
                    <span className="trk-day-meta">
                      {day.km.toFixed(1)} km · {day.fixes.length} fix
                      {day.fixes.length === 1 ? "" : "es"}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <p className="trk-hint">
            Older days are drawn fainter. This is where the inReach reported being, not the
            route — gaps mean it did not get a message out.
          </p>
        </div>
      )}
    </aside>
  );
}
