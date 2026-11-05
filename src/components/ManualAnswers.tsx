import type { LiveStateLike } from "./actionTypes";
import { useState } from "react";
import { saveToNotes } from "../lib/notes";
import { spokenPart } from "../lib/citations";
import { AiText } from "./AiText";

const TITLES: Record<string, string> = { recap: "Recap", suggest: "Suggested reply", explain: "Explanation" };

/** Answers to the Ask, Explain, Suggest reply and Recap buttons (the automatic stream shows its own). */
export function ManualAnswers({ live }: { live: LiveStateLike }) {
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const cards = (["meaning", "reply"] as const)
    .map((k) => ({ k, a: live.ai[k] }))
    .filter(({ a }) => a && a.state !== "idle" && (a.text || a.state === "error" || a.state === "streaming"));
  if (!cards.length) return null;
  return (
    <div className="manual-answers" aria-live="polite">
      {cards.map(({ k, a }) => (
        <div key={k} className="iv-card iv-ask-result">
          <h3>{a!.action === "ask" ? `You asked: ${a!.question ?? ""}` : TITLES[a!.action ?? "explain"]}</h3>
          {a!.state === "error" ? (
            <p className="iv-wait">{a!.error}</p>
          ) : a!.text ? (
            <AiText text={a!.text} streaming={a!.state === "streaming"} />
          ) : (
            <p className="iv-wait">Writing the answer…</p>
          )}
          {a!.state === "done" && a!.text && (
            <button className="btn btn-ghost btn-sm" disabled={saved[a!.request_id ?? k]} onClick={() => void saveToNotes(a!.action === "ask" && a!.question ? `${a!.question}\n\n${spokenPart(a!.text)}` : spokenPart(a!.text), { title: a!.question ?? undefined }).then(() => setSaved((s) => ({ ...s, [a!.request_id ?? k]: true })))}>
              {saved[a!.request_id ?? k] ? "Saved to notes" : "Save to notes"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
