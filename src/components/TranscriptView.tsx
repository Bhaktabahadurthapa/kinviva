import { useEffect, useRef } from "react";
import type { Segment, Transcript } from "../lib/types";

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function Line({ seg }: { seg: Segment }) {
  return (
    <div className={`line line-${seg.source}`}>
      <span className="who">{seg.source === "mic" ? "Me" : "Them"}</span>
      <span className="when">{fmt(seg.start_ms)}</span>
      <p>{seg.text}</p>
    </div>
  );
}

export function TranscriptView({ transcript, compact, emptyHint }: { transcript: Transcript; compact?: boolean; emptyHint?: string }) {
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const finals = compact ? transcript.finals.slice(-12) : transcript.finals;

  useEffect(() => {
    if (stick.current) end.current?.scrollIntoView({ block: "end" });
  }, [transcript]);

  const onScroll = () => {
    const el = box.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const partials = (["system", "mic"] as const).filter((s) => transcript.partials[s]);
  return (
    <div className="transcript" ref={box} onScroll={onScroll} aria-live="polite">
      {finals.length === 0 && partials.length === 0 && <div className="empty">{emptyHint ?? "Transcript will appear here."}</div>}
      {finals.map((s) => (
        <Line key={`${s.id}-${s.start_ms}`} seg={s} />
      ))}
      {partials.map((s) => (
        <div key={`p-${s}`} className={`line line-${s} partial`}>
          <span className="who">{s === "mic" ? "Me" : "Them"}</span>
          <span className="when">…</span>
          <p>{transcript.partials[s]}</p>
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}
