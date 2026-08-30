"use client";

import { useEffect, useRef, useState } from "react";
import { formatLatLon, parseCoordinates, type LatLon } from "@/lib/coords";

type Props = {
  open: boolean;
  /** Prefilled when the clipboard was readable but unparseable. */
  initialText: string;
  onAccept: (at: LatLon) => void;
  onCancel: () => void;
};

/**
 * Turn a pasted position into a pin.
 *
 * The fallback path, and on iOS often the only one: reading the clipboard from
 * script needs permission that Safari may simply refuse, so there has to be a
 * field to paste into by hand. Parsing happens as you type, and the decoded
 * position is shown back in full — pasting `V 53°` and silently getting east
 * would be a hundred degrees of wrong with nothing on screen to catch it.
 */
export default function CoordinateDialog({ open, initialText, onAccept, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      setText(initialText);
      if (!dialog.open) dialog.showModal();
      setTimeout(() => fieldRef.current?.focus(), 60);
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open, initialText]);

  const result = text.trim() ? parseCoordinates(text) : null;

  const paste = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip) setText(clip);
    } catch {
      setText("");
      fieldRef.current?.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      className="pd"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onCancel();
      }}
    >
      <form
        className="pd-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (result?.ok) onAccept(result.value);
        }}
      >
        <div className="pd-head">
          <h2 className="pd-title">Add from a position</h2>
          <span className="pd-coord">
            Paste from Garmin Explore, or type it in
          </span>
        </div>

        <label className="pd-label">
          Position
          <textarea
            ref={fieldRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="N 66.939300°  V 53.643149°"
            spellCheck={false}
            autoCapitalize="characters"
          />
        </label>

        <div className="pd-actions pd-actions-start">
          <button type="button" className="act-btn" onClick={paste}>
            Paste
          </button>
        </div>

        {result &&
          (result.ok ? (
            <p className="cd-ok">
              <strong>{formatLatLon(result.value)}</strong>
              <span className="pd-hint">
                {result.value.lon < 0 ? "West" : "East"} of Greenwich,{" "}
                {result.value.lat >= 0 ? "north" : "south"} of the equator.
                {result.swapped && " Read longitude first."}
              </span>
            </p>
          ) : (
            <p className="cd-bad">{result.reason}</p>
          ))}

        <div className="pd-actions">
          <button type="button" className="act-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="act-btn act-btn-primary" disabled={!result?.ok}>
            Continue
          </button>
        </div>
      </form>
    </dialog>
  );
}
