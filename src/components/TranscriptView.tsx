import { useEffect, useRef } from "react";
import type { SideNote } from "../lib/liveReducer";
import type { AiSlot, Segment, Transcript } from "../lib/types";
import { AiText } from "./AiText";
import { displayText } from "../lib/citations";
import { filterSegments, splitHighlight } from "../lib/search";

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function Line({ seg, query }: { seg: Segment; query?: string }) {
  return (
    <div className={`line line-${seg.source}`}>
      <span className="who">{seg.source === "mic" ? "Me" : "Them"}</span>
      <span className="when">{fmt(seg.start_ms)}</span>
      <p>{splitHighlight(seg.text, query ?? "").map((part, i) => (part.hit ? <mark key={i}>{part.text}</mark> : part.text))}</p>
    </div>
  );
}

function NotePart({ label, slot }: { label: string; slot: AiSlot }) {
  const streaming = slot.state === "streaming";
  return (
    <div className={`note-part ${label === "You could say" ? "is-answer" : ""}`}>
      <span className="note-label">{label}</span>
      {slot.state === "error" ? (
        <p className="note-error">{slot.error}</p>
      ) : slot.text ? (
        <AiText text={displayText(slot)} streaming={streaming} />
      ) : (
        <span className="thinking">Thinking </span>
      )}
    </div>
  );
}

/** Automatic plain-English meaning (and answer, for questions) beside a line. */
function Side({ note }: { note?: SideNote }) {
  if (!note?.meaning && !note?.answer) return <div className="side-note empty-note" />;
  return (
    <div className="side-note">
      {note.meaning && <NotePart label="Insight" slot={note.meaning} />}
      {note.answer && <NotePart label="You could say" slot={note.answer} />}
    </div>
  );
}

export function TranscriptView({
  transcript,
  compact,
  emptyHint,
  side,
  query,
}: {
  transcript: Transcript;
  compact?: boolean;
  emptyHint?: string;
  /** When given, show automatic notes side by side with each line. */
  side?: Record<number, SideNote>;
  /** Show only lines containing this text. */
  query?: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const searching = !!query?.trim();
  const finals = searching ? filterSegments(transcript.finals, query!) : compact ? transcript.finals.slice(-12) : transcript.finals;
  const parallel = !!side;

  useEffect(() => {
    if (stick.current && !searching) end.current?.scrollIntoView({ block: "end" });
  }, [transcript, side]);

  const onScroll = () => {
    const el = box.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const partials = searching ? [] : (["system", "mic"] as const).filter((s) => transcript.partials[s]);
  return (
    <div className={`transcript ${parallel ? "parallel" : ""}`} ref={box} onScroll={onScroll} aria-live="polite">
      {parallel && finals.length > 0 && (
        <div className="pair pair-head">
          <span className="label">What was said</span>
          <span className="label">Live insight · Auto-assist</span>
        </div>
      )}
      {finals.length === 0 && (searching || partials.length === 0) && <div className="empty">{searching ? "No line matches your search." : emptyHint ?? "Transcript will appear here."}</div>}
      {finals.map((s) =>
        parallel ? (
          <div key={`${s.id}-${s.start_ms}`} className="pair">
            <Line seg={s} query={query} />
            {s.source === "system" ? <Side note={side[s.id]} /> : <div className="side-note empty-note" />}
          </div>
        ) : (
          <Line key={`${s.id}-${s.start_ms}`} seg={s} query={query} />
        ),
      )}
      {partials.map((s) => (
        <div key={`p-${s}`} className={parallel ? "pair" : undefined}>
          <div className={`line line-${s} partial`}>
            <span className="who">{s === "mic" ? "Me" : "Them"}</span>
            <span className="when">…</span>
            <p>{transcript.partials[s]}</p>
          </div>
          {parallel && <div className="side-note empty-note" />}
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}
