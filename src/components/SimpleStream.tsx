import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SideNote } from "../lib/liveReducer";
import type { AiSlot, Segment } from "../lib/types";
import { AiText, isNoAnswer } from "./AiText";
import { citationText, displayText, spokenPart } from "../lib/citations";

/** Minimum time between new explanations appearing, so each can be read. */
const REVEAL_GAP_MS = 300;
/** If the speaker races ahead, skip older waiting notes instead of flooding. */
const MAX_WAITING = 1;

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Text worth showing: complete, or still arriving (shown as it is written, not after). */
const isDone = (n?: SideNote["meaning"]) => (n?.state === "done" || n?.state === "streaming") && !!n.text.trim();
const isFinished = (n?: SideNote["meaning"]) => n?.state === "done";
/** While streaming, "NO_ANSWER" arrives in pieces: hide any start of it. */
const maybeNoAnswer = (t: string) => "NO_ANSWER".startsWith(t.trim().toUpperCase()) || isNoAnswer(t);

/**
 * The reading pane: what the other side said, in simple words. Notes appear
 * only once complete (no word-by-word typing), one at a time with a pause
 * between them; the newest is large and earlier ones fade back.
 */
export function SimpleStream({ finals, side, running }: { finals: Segment[]; side: Record<number, SideNote>; running: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const prevHeight = useRef(0);
  const lastReveal = useRef(0);
  const [shown, setShown] = useState<number[]>([]);

  // A line is worth showing once its key points or its answer is complete.
  const hasAnswer = (n?: SideNote) => isDone(n?.answer) && !maybeNoAnswer(n!.answer!.text);
  const ready = finals.filter((s) => s.source === "system" && (isDone(side[s.id]?.meaning) || hasAnswer(side[s.id]))).map((s) => s.id);
  const writing = finals.some(
    (s) => s.source === "system" && (side[s.id]?.meaning?.state === "streaming" || side[s.id]?.answer?.state === "streaming") && !ready.includes(s.id),
  );

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

  // A failed request used to vanish silently. Show why, for the newest failure
  // that no later answer has replaced.
  const failure = (() => {
    for (const seg of [...finals].reverse()) {
      if (seg.source !== "system") continue;
      const n = side[seg.id];
      if (isDone(n?.meaning) || hasAnswer(n)) return null;
      const err = [n?.meaning, n?.answer].find((x) => x?.state === "error" && x.error);
      if (err) return friendlyError(err.error!);
    }
    return null;
  })();

  const visible = shown.filter((id) => id >= 0);
  const latest = visible[visible.length - 1];

  // Newest note sits at the top and nothing scrolls by itself. If you have
  // scrolled down to re-read an older note, new ones are added above without
  // moving what you are reading.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const grew = el.scrollHeight - prevHeight.current;
    if (prevHeight.current && el.scrollTop > 24 && grew > 0) el.scrollTop += grew;
    prevHeight.current = el.scrollHeight;
  }, [visible.length]);

  const byId = new Map(finals.map((s) => [s.id, s]));

  return (
    <div className="simple-stream" ref={box} aria-live="polite">
      {failure && (
        <div className="banner" role="alert">
          <b>The AI could not answer.</b> {failure}
        </div>
      )}
      {visible.length === 0 && running && !failure && <p className="empty">When they finish a thought, its meaning appears here in simple words.</p>}
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
      {running && writing && <div className="simple-writing">Writing the key points…</div>}
      {[...visible].reverse().map((id) => {
        const seg = byId.get(id);
        const note = side[id];
        if (!seg || !note || (!note.meaning && !hasAnswer(note))) return null;
        const answer = note.answer;
        return (
          <article key={id} className={`simple-item ${id === latest ? "is-latest" : "is-earlier"}`}>
            <div className="simple-said">
              <span className="when">{fmt(seg.start_ms)}</span> They said: “{seg.text}”
            </div>
            {note.meaning && (
              <div className="simple-meaning">
                <AiText text={displayText(note.meaning)} streaming={!isFinished(note.meaning)} />
              </div>
            )}
            {answer && hasAnswer(note) && (
              <div className={`simple-answer${note.meaning ? "" : " is-primary"}`}>
                <div className="script-head">
                  <span className="note-label">{/^\s*asking:/i.test(answer.text) ? "Your turn" : (note.meaning ? "Your script — you could say" : "Answer — you could say")}</span>
                  <CopyButton text={spokenPart(answer.text)} />
                </div>
                <AiText text={displayText(answer)} streaming={!isFinished(answer)} />
                {isFinished(answer) && answer.sources.length === 0 && (answer.web ?? []).length === 0 && !/SOURCES/i.test(displayText(answer)) && <SourceLine sources={answer.sources} web={answer.web} />}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

/** Turns a provider error into what to do next. */
function friendlyError(e: string): string {
  if (/could not read key|credential store|add your ai provider/i.test(e)) return `${e} Open Settings → AI and save your API key again.`;
  if (/401|403|api key|unauthor|permission/i.test(e)) return `${e} Check your API key in Settings → AI.`;
  if (/429|quota|rate/i.test(e)) return `${e} The provider is limiting requests; wait a moment.`;
  return e;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text.trim());
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
function SourceLine({ sources, web }: { sources: AiSlot["sources"]; web?: AiSlot["web"] }) {
  const names = [...new Set(sources.map(citationText))];
  const hosts = [...new Set((web ?? []).map((w) => { try { return new URL(w.url).host; } catch { return w.url; } }))];
  return names.length || hosts.length ? (
    <p className="script-sources">
      {names.length > 0 && <>From your files: {names.join(", ")}. </>}
      {hosts.length > 0 && <>Web: {hosts.join(", ")}.</>}
    </p>
  ) : (
    <p className="script-sources script-sources-none">Not based on your files. Add notes or files under Documents to get scripts with your own facts.</p>
  );
}
