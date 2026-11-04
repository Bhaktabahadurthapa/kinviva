import { useEffect, useRef, useState } from "react";
import type { SideNote } from "../lib/liveReducer";
import type { AiSlot, Segment } from "../lib/types";
import { AiText, isNoAnswer } from "./AiText";

/** Minimum time between new explanations appearing, so each can be read. */
const REVEAL_GAP_MS = 4500;
/** If the speaker races ahead, skip older waiting notes instead of flooding. */
const MAX_WAITING = 1;

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const isDone = (n?: SideNote["meaning"]) => n?.state === "done" && !!n.text.trim();

/**
 * The reading pane: what the other side said, in simple words. Notes appear
 * only once complete (no word-by-word typing), one at a time with a pause
 * between them; the newest is large and earlier ones fade back.
 */
export function SimpleStream({ finals, side, running }: { finals: Segment[]; side: Record<number, SideNote>; running: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastReveal = useRef(0);
  const [shown, setShown] = useState<number[]>([]);

  const ready = finals.filter((s) => s.source === "system" && isDone(side[s.id]?.meaning)).map((s) => s.id);
  const writing = finals.some((s) => s.source === "system" && side[s.id]?.meaning?.state === "streaming");

  // Reveal ready notes one at a time, at a readable pace.
  useEffect(() => {
    let pending = ready.filter((id) => !shown.includes(id));
    if (!pending.length) return;
    if (pending.length > MAX_WAITING + 1) {
      // Keep the newest; older waiting notes stay in History instead.
      const skipped = pending.slice(0, pending.length - (MAX_WAITING + 1));
      pending = pending.slice(skipped.length);
      setShown((s) => [...s, ...skipped.map((id) => -id - 1)]);
      return;
    }
    const wait = Math.max(0, lastReveal.current + REVEAL_GAP_MS - Date.now());
    const t = window.setTimeout(() => {
      lastReveal.current = Date.now();
      setShown((s) => [...s, pending[0]]);
    }, wait);
    return () => window.clearTimeout(t);
  }, [ready.join(","), shown]);

  // New meeting: start fresh.
  useEffect(() => {
    if (finals.length === 0) setShown([]);
  }, [finals.length === 0]);

  const visible = shown.filter((id) => id >= 0);
  const latest = visible[visible.length - 1];

  useEffect(() => {
    if (stick.current) end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [visible.length, side]);

  const onScroll = () => {
    const el = box.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const byId = new Map(finals.map((s) => [s.id, s]));

  return (
    <div className="simple-stream" ref={box} onScroll={onScroll} aria-live="polite">
      {visible.length === 0 && running && <p className="empty">When they finish a thought, its meaning appears here in simple words.</p>}
      {visible.length === 0 && !running && (
        <div className="how">
          <p className="empty">Simple explanations appear here automatically.</p>
          <ol className="how-steps">
            <li><b>Start meeting</b><span>MeetingLens listens to the call and your microphone.</span></li>
            <li><b>They speak</b><span>Each finished thought is explained in plain words.</span></li>
            <li><b>You reply</b><span>A short answer you could say is drafted when a question is asked.</span></li>
          </ol>
        </div>
      )}
      {visible.map((id) => {
        const seg = byId.get(id);
        const note = side[id];
        if (!seg || !note?.meaning) return null;
        const answer = note.answer;
        return (
          <article key={id} className={`simple-item ${id === latest ? "is-latest" : "is-earlier"}`}>
            <div className="simple-said">
              <span className="when">{fmt(seg.start_ms)}</span> They said: “{seg.text}”
            </div>
            <div className="simple-meaning">
              <AiText text={note.meaning.text} />
            </div>
            {answer && isDone(answer) && !isNoAnswer(answer.text) && (
              <div className="simple-answer">
                <div className="script-head">
                  <span className="note-label">{/^\s*asking:/i.test(answer.text) ? "Your turn" : "Your script — you could say"}</span>
                  <CopyButton text={answer.text} />
                </div>
                <AiText text={answer.text} />
                <SourceLine sources={answer.sources} />
              </div>
            )}
          </article>
        );
      })}
      {running && writing && <div className="simple-writing">Writing it in simple words…</div>}
      <div ref={end} />
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text.replace(/^\s*(Answer|Details|Fill in):\s*/gim, "").trim());
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable: nothing to do */
        }
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** Which of the user's files were searched for this answer (not a claim the model quoted them). */
function SourceLine({ sources }: { sources: AiSlot["sources"] }) {
  const names = [...new Set(sources.map((p) => p.document))];
  return names.length ? (
    <p className="script-sources">From your files: {names.join(", ")}</p>
  ) : (
    <p className="script-sources script-sources-none">Not based on your files. Add notes or files under Documents to get scripts with your own facts.</p>
  );
}
