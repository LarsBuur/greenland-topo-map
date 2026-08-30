"use client";

import { useEffect, useRef, useState } from "react";
import type { PersonalPoint } from "@/lib/personal-points";

export type Draft = { lat: number; lon: number; editing?: PersonalPoint };

type Props = {
  draft: Draft | null;
  photoUrl: string | null;
  onPickPhoto: (file: File) => void;
  onRemovePhoto: () => void;
  onSave: (name: string, desc: string) => void;
  onCancel: () => void;
};

function formatCoord(lat: number, lon: number) {
  return `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(5)}° ${
    lon >= 0 ? "E" : "W"
  }`;
}

/**
 * The point form, as a modal.
 *
 * It used to sit inside the side panel, which is unusable on a phone: the panel
 * is a column a third of the screen wide, and once the keyboard is up there is
 * nothing left of it. A modal gets the full width, and `showModal` brings focus
 * trapping and Escape with it rather than reimplementing both.
 */
export default function PointDialog({
  draft,
  photoUrl,
  onPickPhoto,
  onRemovePhoto,
  onSave,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (draft) {
      setName(draft.editing?.name ?? "");
      setDesc(draft.editing?.desc ?? "");
      if (!dialog.open) dialog.showModal();
      // Deliberately not autofocusing the field. On iOS that throws the
      // keyboard up over the map the moment the dialog opens, and the first
      // thing most people want is to check they tapped the right spot.
      dialog.scrollTop = 0;
    } else if (dialog.open) {
      dialog.close();
    }
  }, [draft]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(name, desc);
  };

  return (
    <dialog
      ref={ref}
      className="pd"
      onCancel={(e) => {
        // Escape, or the iPad's back gesture. Let the parent own the state.
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        // A click landing on the dialog itself is the backdrop; anything inside
        // the card stops here.
        if (e.target === ref.current) onCancel();
      }}
    >
      {draft && (
        <form className="pd-card" onSubmit={submit}>
          <div className="pd-head">
            <h2 className="pd-title">{draft.editing ? "Edit point" : "New point"}</h2>
            <span className="pd-coord">{formatCoord(draft.lat, draft.lon)}</span>
          </div>

          <label className="pd-label">
            Name
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Good camp spot"
              enterKeyHint="done"
              required
            />
          </label>

          <label className="pd-label">
            Description <span className="pd-optional">optional</span>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Flat, sheltered, water 50 m north"
            />
          </label>

          <div className="pd-label">
            Photo <span className="pd-optional">optional — to recognise the spot</span>
            <div className="pd-photo-row">
              {photoUrl ? (
                <img className="pd-photo" src={photoUrl} alt="" />
              ) : (
                <span className="pd-photo pd-photo-empty" aria-hidden="true" />
              )}
              <span className="pd-photo-buttons">
                <button type="button" className="act-btn" onClick={() => photoRef.current?.click()}>
                  {photoUrl ? "Replace" : "Add photo"}
                </button>
                {photoUrl && (
                  <button type="button" className="act-btn" onClick={onRemovePhoto}>
                    Remove
                  </button>
                )}
              </span>
              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) onPickPhoto(file);
                }}
                hidden
              />
            </div>
            <span className="pd-hint">
              Shrunk before saving, and the location, time and camera details the file carries are
              discarded.
            </span>
          </div>

          <div className="pd-actions">
            <button type="button" className="act-btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="act-btn act-btn-primary">
              {draft.editing ? "Save" : "Add point"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
