import { useState } from "react";
import { api, errorText } from "../../lib/api";
import { latestGuard } from "../../lib/latest";
import { saveToNotes } from "../../lib/notes";
import type { LiveState } from "../../lib/liveReducer";
import { AiText } from "../AiText";

const guard = latestGuard();

/** Explains a technical term or the latest technical point: simple words first, then depth. */
export function ExplainTool({ live, onError, onSaved }: { live: LiveState; onError: (m: string) => void; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [out, setOut] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = [...live.transcript.finals].reverse().find((s) => s.source === "system")?.text;

  const run = async () => {
    const mine = guard.next();
    setBusy(true);
    setOut(null);
    try {
      const r = await api.studioGenerate(crypto.randomUUID(), "technical_explain", text.trim() || undefined);
      if (guard.isCurrent(mine)) setOut(r);
    } catch (e) {
      if (guard.isCurrent(mine)) onError(errorText(e));
    } finally {
      if (guard.isCurrent(mine)) setBusy(false);
    }
  };

  return (
    <div className="tc-tool">
      <label className="tc-label" htmlFor="tc-explain">What should be explained?</label>
      <textarea id="tc-explain" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000} placeholder="A term, a command, an error, or a design question. Leave empty to explain the latest point in the conversation." />
      <div className="tc-actions">
        <button className="btn btn-primary" onClick={() => void run()} disabled={busy || (!text.trim() && live.transcript.finals.length === 0)}>{busy ? "Explaining…" : "Explain"}</button>
        {latest && <button className="btn btn-ghost" onClick={() => setText(latest)}>Use what they just said</button>}
      </div>
      {out && (
        <div className="tc-result">
          <AiText text={out} />
          <button className="btn btn-ghost btn-sm" onClick={() => void saveToNotes(out, { title: text.trim().slice(0, 80) || "Technical explanation" }).then(onSaved)}>Save to notes</button>
        </div>
      )}
    </div>
  );
}
