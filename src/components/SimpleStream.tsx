import { useEffect, useRef } from "react";
import type { SideNote } from "../lib/liveReducer";
import type { Segment } from "../lib/types";
import { AiText } from "./AiText";

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The reading pane: what the other side said, rewritten in simple words,
 * newest at the bottom. Questions also show a draft answer.
 */
export function SimpleStream({ finals, side, running }: { finals: Segment[]; side: Record<number, SideNote>; running: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const items = finals.filter((s) => s.source === "system" && (side[s.id]?.meaning || side[s.id]?.answer));

  useEffect(() => {
    if (stick.current) end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [side, finals.length]);

  const onScroll = () => {
    const el = box.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  return (
    <div className="simple-stream" ref={box} onScroll={onScroll} aria-live="polite">
      {items.length === 0 && (
        <p className="empty">{running ? "As they speak, what they mean will appear here in simple words." : "Start a meeting. Simple explanations appear here automatically."}</p>
      )}
      {items.map((s) => {
        const note = side[s.id];
        const meaning = note.meaning;
        const answer = note.answer;
        return (
          <article key={s.id} className="simple-item">
            <div className="simple-said">
              <span className="when">{fmt(s.start_ms)}</span> “{s.text}”
            </div>
            {meaning &&
              (meaning.state === "error" ? (
                <p className="note-error">{meaning.error}</p>
              ) : meaning.text ? (
                <div className="simple-meaning">
                  <AiText text={meaning.text} streaming={meaning.state === "streaming"} />
                </div>
              ) : (
                <span className="thinking">Thinking </span>
              ))}
            {answer && (
              <div className="simple-answer">
                <span className="note-label">You could say</span>
                {answer.state === "error" ? (
                  <p className="note-error">{answer.error}</p>
                ) : answer.text ? (
                  <AiText text={answer.text} streaming={answer.state === "streaming"} />
                ) : (
                  <span className="thinking">Thinking </span>
                )}
              </div>
            )}
          </article>
        );
      })}
      <div ref={end} />
    </div>
  );
}
