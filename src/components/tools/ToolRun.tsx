import { useState } from "react";
import { api, errorText } from "../../lib/api";
import { sendToBoard } from "../../lib/boardInbox";
import { latestGuard } from "../../lib/latest";
import { saveToNotes } from "../../lib/notes";
import { AiText } from "../AiText";

const guards = new Map<string, ReturnType<typeof latestGuard>>();
const guardFor = (k: string) => guards.get(k) ?? (guards.set(k, latestGuard()), guards.get(k)!);

/** One structured tool: optional text input, a Run button, the result, and Save to notes / Send to Whiteboard. */
export function ToolRun({
  kind, title, help, button, placeholder, inputRequired, onError, onSaved, onBoard, meetingId, rows = 3,
}: {
  kind: string; title: string; help: string; button: string; placeholder?: string; inputRequired?: boolean;
  onError: (m: string) => void; onSaved: () => void; onBoard?: () => void; meetingId?: string | null; rows?: number;
}) {
  const [text, setText] = useState("");
  const [out, setOut] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const guard = guardFor(kind);

  const run = async () => {
    const mine = guard.next();
    setBusy(true);
    setOut(null);
    setSaved(false);
    try {
      const r = await api.studioGenerate(crypto.randomUUID(), kind, text.trim() || undefined, meetingId ?? null);
      if (guard.isCurrent(mine)) setOut(r);
    } catch (e) {
      if (guard.isCurrent(mine)) onError(errorText(e));
    } finally {
      if (guard.isCurrent(mine)) setBusy(false);
    }
  };
  return (
    <section className="dash-card tool">
      <header><h2>{title}</h2></header>
      <p className="hint">{help}</p>
      {placeholder !== undefined && <textarea rows={rows} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={title} maxLength={6000} />}
      <div className="tc-actions"><button className="btn btn-primary" onClick={() => void run()} disabled={busy || (inputRequired && text.trim().length < 3)}>{busy ? "Working…" : button}</button></div>
      {out && (
        <div className="tc-result">
          <AiText text={out} />
          <div className="tc-actions">
            <button className="btn btn-ghost btn-sm" disabled={saved} onClick={() => void saveToNotes(out, { title, meetingId }).then(() => { setSaved(true); onSaved(); })}>{saved ? "Saved to notes" : "Save to notes"}</button>
            {onBoard && <button className="btn btn-ghost btn-sm" onClick={() => { sendToBoard(out); onBoard(); }}>Draw on Whiteboard</button>}
          </div>
        </div>
      )}
    </section>
  );
}
