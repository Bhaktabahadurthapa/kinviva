import type { LiveStateLike } from "./actionTypes";
import { useContext, useEffect, useRef, useState } from "react";
import { addAnswer, clearAnswers, FeedSearch, useAnswerLog } from "../lib/answerLog";
import { saveToNotes } from "../lib/notes";
import { spokenPart } from "../lib/citations";
import { AiText } from "./AiText";

const TITLES: Record<string, string> = { recap: "Recap", suggest: "Suggested reply", explain: "Explanation" };

/** Answers to the Ask, Explain, Suggest reply and Recap buttons (the automatic stream shows its own). */
export function ManualAnswers({ live }: { live: LiveStateLike & { transcript?: { finals: unknown[] } } }) {
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [gone, setGone] = useState<string[]>([]);
  // A manual Explain belongs to the moment it was asked: once a few newer sentences have been spoken it steps aside,
  // so an old answer is never mistaken for the explanation of what is being said now.
  const seen = useRef<Record<string, number>>({});
  const now = live.transcript?.finals.length ?? 0;
  const q = useContext(FeedSearch).trim().toLowerCase();
  const log = useAnswerLog();
  // Keep every finished answer, so an older one is still there after a newer one replaces it on screen.
  useEffect(() => {
    for (const k of ["meaning", "reply"] as const) {
      const a = live.ai[k];
      if (a && a.state === "done" && a.text.trim() && a.request_id) addAnswer({ id: a.request_id, action: a.action ?? "explain", question: a.question ?? "", text: a.text, at: Date.now() });
    }
  }, [live.ai.meaning?.state, live.ai.reply?.state, live.ai.meaning?.request_id, live.ai.reply?.request_id]);
  useEffect(() => {
    if (live.transcript && now === 0) clearAnswers();
  }, [now === 0]);
  const cards = (["meaning", "reply"] as const)
    .map((k) => ({ k, a: live.ai[k] }))
    .filter(({ a }) => a && a.state !== "idle" && (a.text || a.state === "error" || a.state === "streaming"))
    .filter(({ k, a }) => {
      const id = a!.request_id ?? k;
      if (gone.includes(id)) return false;
      if (seen.current[id] === undefined) seen.current[id] = now;
      if (q && !`${a!.question ?? ""} ${a!.text}`.toLowerCase().includes(q)) return false;
      return !(a!.action === "explain" && a!.state === "done" && now - seen.current[id] >= 3 && !q);
    });
  const shownIds = new Set(cards.map(({ k, a }) => a!.request_id ?? k));
  const older = log.filter((x) => !shownIds.has(x.id) && !gone.includes(x.id) && (!q || `${x.question} ${x.text}`.toLowerCase().includes(q)));
  if (!cards.length && !older.length) return null;
  return (
    <div className="manual-answers" aria-live="polite">
      {cards.map(({ k, a }) => (
        <div key={k} className="iv-card iv-ask-result">
          <button className="ma-x" aria-label="Dismiss this answer" title="Dismiss" onClick={() => setGone((g) => [...g, a!.request_id ?? k])}>✕</button>
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
      {older.length > 0 && (
        <section className="earlier ma-log" aria-label="Earlier answers">
          <h3>Earlier answers <span>{older.length}</span></h3>
          {older.map((x) => (
            <details key={x.id} className="step step-earlier" open={!!q}>
              <summary>
                <span className="ma-kind">{x.action === "ask" ? "Ask" : TITLES[x.action] ?? "Answer"}</span>
                <span className="step-line">{x.question ? x.question : spokenPart(x.text).slice(0, 110)}</span>
              </summary>
              <AiText text={x.text} />
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
