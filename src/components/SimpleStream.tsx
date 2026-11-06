import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SideNote } from "../lib/liveReducer";
import type { AiSlot, Segment } from "../lib/types";
import { AiText, isNoAnswer } from "./AiText";
import { citationText, displayText, spokenPart } from "../lib/citations";


/**
 * Notes still waiting to be revealed. An id counts as handled when it was shown
 * (`id`) or skipped because newer notes arrived (`-id - 1`); missing the second case
 * made the reveal effect loop forever whenever three or more notes arrived at once.
 */
export function pendingNotes(ready: number[], shown: number[]): number[] {
  return ready.filter((id) => !shown.includes(id) && !shown.includes(-id - 1));
}

const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4));
/** True when two explanations say nearly the same thing (most of their longer words are shared). */
export function similarText(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (x.size < 5 || y.size < 5) return false;
  let shared = 0;
  x.forEach((w) => y.has(w) && shared++);
  return shared / (x.size + y.size - shared) >= 0.5;
}
/** Drops an explanation that repeats the one just before it, so the same points are not shown again and again. */
export function dropRepeats(ids: number[], text: (id: number) => string | null): number[] {
  const out: number[] = [];
  let last: string | null = null;
  for (const id of ids) {
    const t = text(id);
    if (t !== null && last !== null && similarText(t, last)) continue;
    out.push(id);
    if (t !== null) last = t;
  }
  return out;
}

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
 * The reading pane, step by step. Each thing the other side says becomes a numbered step the moment
 * it is being explained: their words first, the explanation filling in below them. Steps stay in the
 * order they were spoken, none is skipped or moved, and the view follows the newest step until you scroll
 * up to read; then it stays put and offers a button to jump back.
 */
export function SimpleStream({ finals, side, running, extraKey = "", children }: { finals: Segment[]; side: Record<number, SideNote>; running: boolean; extraKey?: string; children?: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);

  const hasAnswer = (n?: SideNote) => isDone(n?.answer) && !maybeNoAnswer(n!.answer!.text);
  const active = (n?: SideNote) => {
    if (!n) return false;
    const m = n.meaning;
    if (m && m.state !== "idle") return true;
    return !!n.answer && n.answer.state !== "idle" && !(n.answer.state === "done" && maybeNoAnswer(n.answer.text)) && !(n.answer.state === "cancelled" && !n.answer.text);
  };
  const steps = finals.filter((sg) => sg.source === "system" && active(side[sg.id]));
  // Which steps repeat the one before them (shown folded, never removed).
  const kept = new Set(dropRepeats(steps.map((sg) => sg.id), (id) => (hasAnswer(side[id]) || !isFinished(side[id]?.meaning) ? null : side[id]!.meaning!.text)));
  let lastKept = 0;
  const sameAs = new Map<number, number>();
  steps.forEach((sg, i) => (kept.has(sg.id) ? (lastKept = i + 1) : sameAs.set(sg.id, lastKept)));

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

  // A new step starts at the top of the view and fills downward, so it is read from its first line, top to bottom.
  // The view is only moved when a new step (or a new answer you asked for) begins, never while its text is arriving.
  const startKey = `${extraKey}|${steps.length}`;
  const goToNewest = () => {
    const el = box.current;
    if (!el) return;
    const items = el.querySelectorAll<HTMLElement>(".step, .manual-answers .iv-ask-result");
    const last = items[items.length - 1];
    if (last) el.scrollTop += last.getBoundingClientRect().top - el.getBoundingClientRect().top - 8;
  };
  useLayoutEffect(() => {
    if (follow) goToNewest();
  }, [startKey, follow]);
  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const items = el.querySelectorAll<HTMLElement>(".step, .manual-answers .iv-ask-result");
    const last = items[items.length - 1];
    if (!last) return;
    // Following means the newest step's first line is on screen or already scrolled past; scrolling up above it pauses following.
    const away = last.getBoundingClientRect().top - el.getBoundingClientRect().top > el.clientHeight - 24;
    if (away !== !follow) setFollow(!away);
  };
  useEffect(() => {
    if (finals.length === 0) setFollow(true);
  }, [finals.length === 0]);

  return (
    <div className="simple-wrap">
      <div className="simple-stream" ref={box} onScroll={onScroll} aria-live="polite">
        {failure && (
          <div className="banner" role="alert">
            <b>MeetingLens could not generate an answer.</b> {failure}
          </div>
        )}
        {steps.length === 0 && running && !failure && <p className="empty">When they finish a thought, it appears here as a numbered step with its meaning in simple words.</p>}
        {steps.length === 0 && !running && (
          <div className="how">
            <p className="empty">Simple explanations appear here automatically.</p>
            <ol className="how-steps">
              <li><b>Begin session</b><span>MeetingLens listens to the call and your microphone.</span></li>
              <li><b>They speak</b><span>Each finished thought becomes a numbered step.</span></li>
              <li><b>You reply</b><span>A short answer you could say is drafted when a question is asked.</span></li>
            </ol>
          </div>
        )}
        {steps.map((seg, i) => {
          const note = side[seg.id]!;
          const answer = note.answer;
          const m = note.meaning;
          const isNewest = i === steps.length - 1;
          const folded = sameAs.get(seg.id);
          const meaningState = !m || m.state === "idle" ? null : m.text.trim() ? "text" : m.state === "error" ? "error" : m.state === "cancelled" ? "covered" : "waiting";
          return (
            <article key={seg.id} className={`step ${isNewest ? "is-newest" : ""}`}>
              <div className="step-head">
                <span className="step-n">{i + 1}</span>
                <span className="when">{fmt(seg.start_ms)}</span>
                {isNewest && running && <span className="step-now">Latest</span>}
              </div>
              <div className="step-said">“{seg.text}”</div>
              {meaningState === "waiting" && <div className="step-wait" role="status"><i /><i /><i /><span>Explaining this…</span></div>}
              {meaningState === "covered" && <p className="step-note">Skipped while the speaker kept talking. The next step covers it.</p>}
              {meaningState === "error" && <p className="step-note">This part could not be explained.</p>}
              {meaningState === "text" && folded !== undefined && isFinished(m) && (
                <details className="step-same"><summary>Same point as step {folded}</summary><div className="simple-meaning"><AiText text={displayText(m!)} /></div></details>
              )}
              {meaningState === "text" && !(folded !== undefined && isFinished(m)) && (
                <div className="simple-meaning">
                  <AiText text={displayText(m!)} streaming={!isFinished(m)} />
                </div>
              )}
              {answer && answer.state !== "idle" && !(answer.state === "done" && maybeNoAnswer(answer.text)) && (answer.text.trim() || answer.state === "streaming") && (
                <div className={`simple-answer${m ? "" : " is-primary"}`}>
                  <div className="script-head">
                    <span className="note-label">{/^\s*asking:/i.test(answer.text) ? "Your turn" : (m ? "Your script — you could say" : "Answer — you could say")}</span>
                    {answer.text.trim() && <CopyButton text={spokenPart(answer.text)} />}
                  </div>
                  {answer.text.trim() ? <AiText text={displayText(answer)} streaming={!isFinished(answer)} /> : <div className="step-wait"><i /><i /><i /><span>Writing your answer…</span></div>}
                  {isFinished(answer) && answer.sources.length === 0 && (answer.web ?? []).length === 0 && !/SOURCES/i.test(displayText(answer)) && <SourceLine sources={answer.sources} web={answer.web} />}
                </div>
              )}
            </article>
          );
        })}
        {children}
      </div>
      {!follow && steps.length > 0 && <button className="simple-jump" onClick={() => { setFollow(true); goToNewest(); }}>Jump to latest ↓</button>}
    </div>
  );
}

/** Turns a provider error into what to do next. */
function friendlyError(e: string): string {
  if (/could not read key|credential store|add your answer engine/i.test(e)) return `${e} Open Settings → Answer engine and save your API key again.`;
  if (/401|403|api key|unauthor|permission/i.test(e)) return `${e} Check your API key in Settings → Answer engine.`;
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
