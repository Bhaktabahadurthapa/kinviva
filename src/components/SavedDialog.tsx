import { useEffect, useRef } from "react";
import { FORMAT_LABEL, type NotesFormat } from "../lib/download";

const OPTIONS: { f: NotesFormat; hint: string }[] = [
  { f: "docx", hint: "Opens in Word or Pages" },
  { f: "md", hint: "Plain notes, easy to edit" },
  { f: "txt", hint: "Works everywhere" },
];

/** Shown when a meeting or interview ends: a clear, centred confirmation with the export choices. */
export function SavedDialog({
  title,
  message,
  onPick,
  onOpenSessions,
  onClose,
}: {
  title: string;
  message: string | null;
  onPick: (f: NotesFormat) => void;
  onOpenSessions: () => void;
  onClose: () => void;
}) {
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primary.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="saved-title">
        <div className="dialog-icon" aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </div>
        <h2 id="saved-title">Session saved</h2>
        <p className="dialog-name">{title}</p>
        {message ? (
          <p className="dialog-note" role="status">{message}</p>
        ) : (
          <>
            <p className="dialog-sub">Download your transcript, scripts, key points and references.</p>
            <div className="dialog-options" role="group" aria-label="Download as">
              {OPTIONS.map(({ f, hint }) => (
                <button key={f} className="dialog-option" onClick={() => onPick(f)}>
                  <strong>{FORMAT_LABEL[f]}</strong>
                  <span>{hint}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>Close</button>
          <button ref={primary} className="btn btn-primary" onClick={onOpenSessions}>View in Sessions</button>
        </div>
      </div>
    </div>
  );
}
