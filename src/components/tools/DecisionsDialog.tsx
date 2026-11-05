import { useEffect, useState } from "react";
import { api, errorText } from "../../lib/api";
import { saveToNotes } from "../../lib/notes";

interface Result { summary: string; decisions: { text: string; quote: string }[]; actions: { task: string; owner: string; due: string; quote: string }[]; open_questions: string[] }

export function resultToText(r: Result): string {
  const L = (h: string, items: string[]) => (items.length ? `\n${h}\n${items.map((i) => `- ${i}`).join("\n")}\n` : "");
  return [r.summary, L("Decisions (confirmed in the conversation)", r.decisions.map((d) => d.text)), L("Action items", r.actions.map((a) => `${a.task}${a.owner ? ` (owner: ${a.owner})` : ""}${a.due ? ` (due: ${a.due})` : ""}`)), L("Open questions", r.open_questions)].join("\n").trim();
}

/** Decisions and action items. A decision needs a real quote; an owner or deadline appears only when someone said it. */
export function DecisionsDialog({ meetingId, onClose, onError, onSaved }: { meetingId?: string | null; onClose: () => void; onError: (m: string) => void; onSaved: () => void }) {
  const [r, setR] = useState<Result | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let live = true;
    api.studioGenerate(crypto.randomUUID(), "decisions", undefined, meetingId ?? null).then((x) => live && setR(JSON.parse(x) as Result)).catch((e) => { if (live) { onError(errorText(e)); onClose(); } });
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => { live = false; window.removeEventListener("keydown", key); };
  }, [meetingId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="dec-title">
        <h2 id="dec-title">Decisions &amp; action items</h2>
        {!r ? <p className="hint" role="status">Reading the conversation…</p> : (
          <div className="dec">
            {r.summary && <p>{r.summary}</p>}
            <h3>Decisions <span className="tc-chip">confirmed in the conversation</span></h3>
            {r.decisions.length === 0 ? <p className="hint">Nothing was clearly decided yet.</p> : <ul>{r.decisions.map((d, i) => <li key={i}><strong>{d.text}</strong><br /><span className="hint">“{d.quote}”</span></li>)}</ul>}
            <h3>Action items</h3>
            {r.actions.length === 0 ? <p className="hint">No action items were assigned.</p> : <ul>{r.actions.map((a, i) => <li key={i}><strong>{a.task}</strong><br /><span className="hint">Owner: {a.owner || "not stated"} · Due: {a.due || "not stated"}</span></li>)}</ul>}
            {r.open_questions.length > 0 && (<><h3>Open questions</h3><ul>{r.open_questions.map((q, i) => <li key={i}>{q}</li>)}</ul></>)}
          </div>
        )}
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>Close</button>
          {r && <button className="btn btn-primary" disabled={saved} onClick={() => void saveToNotes(resultToText(r), { title: "Decisions and actions", meetingId }).then(() => { setSaved(true); onSaved(); })}>{saved ? "Saved to notes" : "Save to notes"}</button>}
        </div>
      </div>
    </div>
  );
}
