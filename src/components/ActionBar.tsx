import { useState } from "react";
import { api, errorText } from "../lib/api";
import { DecisionsDialog } from "./tools/DecisionsDialog";
import type { AiAction, LiveStateLike } from "./actionTypes";

export function useActions(onError: (msg: string) => void) {
  return async (action: AiAction, question?: string) => {
    try {
      await api.aiRun(action, question);
      return true;
    } catch (e) {
      onError(errorText(e));
      return false;
    }
  };
}

export function ActionBar({ live, onError, compact, onNoteSaved }: { live: LiveStateLike; onError: (m: string) => void; compact?: boolean; onNoteSaved?: () => void }) {
  const [q, setQ] = useState("");
  const [dec, setDec] = useState(false);
  const run = useActions(onError);
  const busy = (slot: "meaning" | "reply") => live.ai[slot]?.state === "streaming";
  return (
    <div className={`actionbar ${compact ? "compact" : ""}`}>
      <form
        className="ask"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run("ask", q)) setQ("");
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this meeting…" aria-label="Ask a question" />
        <button className="btn" type="submit" disabled={!q.trim()}>
          Ask
        </button>
      </form>
      <div className="actions">
        <button className="btn" onClick={() => run("explain")} disabled={busy("meaning")} title="Explain the latest point in simple English">
          Explain
        </button>
        <button className="btn btn-primary" onClick={() => run("suggest")} disabled={busy("reply")} title="Draft a short reply you can edit">
          Suggest reply
        </button>
        <button className="btn" onClick={() => run("recap")} disabled={busy("meaning")}>
          Recap
        </button>
        {!compact && <button className="btn" onClick={() => setDec(true)} title="List what was decided and who owns which action">Decisions</button>}
        {dec && <DecisionsDialog onClose={() => setDec(false)} onError={onError} onSaved={() => onNoteSaved?.()} />}
      </div>
    </div>
  );
}
