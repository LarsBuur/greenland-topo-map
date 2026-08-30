"use client";

import { useRef, useState } from "react";
import { PRIVACY_NOTE, type PersonalPoint } from "@/lib/personal-points";
import { formatBytes } from "@/lib/offline";

type Props = {
  points: PersonalPoint[];
  /** Object URLs for stored thumbnails, by point id. */
  thumbUrls: Record<string, string>;
  onExport: () => void;
  /** Add a point from a position on the clipboard. */
  onPastePosition: () => void;
  /** Bytes held by photos, for the storage line. */
  photoBytes: number;
  /** Set when the map is waiting for a tap to place a point. */
  placing: boolean;
  onStartPlacing: () => void;
  onCancelPlacing: () => void;
  onEdit: (point: PersonalPoint) => void;
  onDelete: (id: string) => void;
  onGoTo: (point: PersonalPoint) => void;
  /** Receives the chosen file; the parent decides whether it is GeoJSON or a ZIP. */
  onImport: (file: File) => void;
  /** Outcome of the last import, success or failure. */
  importNote: { ok: boolean; text: string } | null;
  /** True when the last write to localStorage was refused. */
  storageFailed: boolean;
};

function formatCoord(lat: number, lon: number) {
  return `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(5)}° ${
    lon >= 0 ? "E" : "W"
  }`;
}

export default function PersonalPoints({
  points,
  thumbUrls,
  onExport,
  onPastePosition,
  photoBytes,
  placing,
  onStartPlacing,
  onCancelPlacing,
  onEdit,
  onDelete,
  onGoTo,
  onImport,
  importNote,
  storageFailed,
}: Props) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * Reset the input before handing the file on: picking the same file twice in
   * a row fires no change event otherwise, which reads as a broken button.
   */
  const takeFile = (e: React.ChangeEvent<HTMLInputElement>, then: (f: File) => void) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) then(file);
  };

  return (
    <aside className={`mine${open ? "" : " mine-closed"}`} aria-label="My points">
      <button
        type="button"
        className="mine-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="mine-head-text">
          <span className="mine-title">
            My points
            <span className="mine-badge" title="Stored only on this device">
              PRIVATE
            </span>
          </span>
          <span className="mine-sub">
            {points.length === 0
              ? "Nothing saved yet — this device only"
              : `${points.length} point${points.length === 1 ? "" : "s"} · this device only`}
          </span>
        </span>
        <span className="mine-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="mine-body">
          <p className="mine-privacy">
            <strong>These are yours alone.</strong> {PRIVACY_NOTE} Export them if you want a copy
            that survives clearing this browser&rsquo;s data.
          </p>

          {storageFailed && (
            <p className="mine-warn">
              The browser refused to save. Points added now will be lost when the page closes —
              check that storage is not full and that you are not in Private Browsing.
            </p>
          )}

          <div className="mine-actions">
              <button
                type="button"
                className="act-btn act-btn-primary"
                onClick={placing ? onCancelPlacing : onStartPlacing}
              >
                {placing ? "Cancel" : "Add a point"}
              </button>
              <button
                type="button"
                className="act-btn"
                onClick={onPastePosition}
                title="Add a point from a position you have copied, e.g. from Garmin Explore"
              >
                Paste position
              </button>
              <button
                type="button"
                className="act-btn"
                onClick={onExport}
                disabled={!points.length}
                title="Download all your points, with any photos"
              >
                Export
              </button>
              <button
                type="button"
                className="act-btn"
                onClick={() => fileRef.current?.click()}
                title="Restore points from an exported file"
              >
                Import
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".geojson,.json,.zip,application/geo+json,application/json,application/zip"
                onChange={(e) => takeFile(e, onImport)}
                hidden
              />
          </div>

          {importNote && (
            <p className={importNote.ok ? "mine-note" : "mine-warn"}>{importNote.text}</p>
          )}

          {photoBytes > 0 && (
            <p className="mine-hint">
              Photos are using {formatBytes(photoBytes)}. That comes out of the same allowance as
              your downloaded maps.
            </p>
          )}

          {points.length > 0 && (
            <ul className="mine-list">
              {points.map((p) => (
                <li key={p.id} className="mine-item">
                  <button type="button" className="mine-item-main" onClick={() => onGoTo(p)}>
                    {p.hasPhoto &&
                      (thumbUrls[p.id] ? (
                        <img className="mine-thumb" src={thumbUrls[p.id]} alt="" />
                      ) : (
                        // Held open while the photo loads, so the row does not
                        // jump under a thumb the user is about to tap.
                        <span className="mine-thumb mine-thumb-loading" aria-hidden="true" />
                      ))}
                    <span className="mine-item-text">
                      <span className="mine-item-name">{p.name}</span>
                      <span className="mine-item-coord">{formatCoord(p.lat, p.lon)}</span>
                      {p.desc && <span className="mine-item-desc">{p.desc}</span>}
                    </span>
                  </button>
                  <span className="mine-item-tools">
                    <button type="button" onClick={() => onEdit(p)} aria-label={`Edit ${p.name}`}>
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete “${p.name}”? This cannot be undone.`)) {
                          onDelete(p.id);
                        }
                      }}
                      aria-label={`Delete ${p.name}`}
                    >
                      Delete
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
