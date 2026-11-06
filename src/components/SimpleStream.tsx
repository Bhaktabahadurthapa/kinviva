import { useState } from "react";
import { FeedSearch } from "../lib/answerLog";
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
 * The reading pane. The newest step sits at the top in full ("Now") and stays put while it is read; when the
 * next thing is said it moves into the "Earlier" list below as a one-line step you can open. Every step is kept,
 * in order, numbered, so nothing is skipped and nothing jumps while you read.
 */
export function SimpleStream({ finals, side, running, children }: { finals: Segment[]; side: Record<number, SideNote>; running: boolean; extraKey?: string; children?: React.ReactNode }) {
  const hasAnswer = (n?: SideNote) => isDone(n?.answer) && !maybeNoAnswer(n!.answer!.text);
  const active = (n?: SideNote) => {
    if (!n) return false;
    const m = n.meaning;
    if (m && m.state !== "idle") return true;
    return !!n.answer && n.answer.state !== "idle" && !(n.answer.state === "done" && maybeNoAnswer(n.answer.text)) && !(n.answer.state === "cancelled" && !n.answer.text);
  };
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const steps = finals.filter((sg) => sg.source === "system" && active(side[sg.id]));
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

  const body = (seg: Segment, i: number, newest: boolean) => {
    const note = side[seg.id]!;
    const answer = note.answer;
    const m = note.meaning;
    const folded = sameAs.get(seg.id);
    const meaningState = !m || m.state === "idle" ? null : m.text.trim() ? "text" : m.state === "error" ? "error" : m.state === "cancelled" ? "covered" : "waiting";
    return (
      <>
        {meaningState === "waiting" && <div className="step-wait" role="status"><i /><i /><i /><span>Explaining this…</span></div>}
        {meaningState === "covered" && <p className="step-note">Skipped while the speaker kept talking. The next step covers it.</p>}
        {meaningState === "error" && <p className="step-note">This part could not be explained.</p>}
        {meaningState === "text" && folded !== undefined && isFinished(m) && !newest && (
          <p className="step-note">Same point as step {folded}.</p>
        )}
        {meaningState === "text" && !(folded !== undefined && isFinished(m) && !newest) && (
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
        <span hidden>{i}</span>
      </>
    );
  };

  const textOf = (id: number) => `${byIdText(id)} ${side[id]?.meaning?.text ?? ""} ${side[id]?.answer?.text ?? ""}`.toLowerCase();
  function byIdText(id: number) { return finals.find((f) => f.id === id)?.text ?? ""; }
  // While searching, every matching step is listed (newest first), whatever its age.
  const searching = q.length > 0;
  const newestSeg = !searching && steps.length ? steps[steps.length - 1] : null;
  const earlier = (searching ? steps : steps.slice(0, -1)).map((sg) => ({ sg, n: steps.indexOf(sg) + 1 })).filter(({ sg }) => !searching || textOf(sg.id).includes(q)).reverse();

  return (
    <div className="simple-wrap">
      <div className="feed-search">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search everything said and explained so far" aria-label="Search results" />
        {searching && <span className="hint" role="status">{earlier.length} step{earlier.length === 1 ? "" : "s"} found</span>}
      </div>
      <FeedSearch.Provider value={query}>
      <div className="simple-stream" aria-live="polite">
        {failure && (
          <div className="banner" role="alert">
            <b>MeetingLens could not generate an answer.</b> {failure}
          </div>
        )}
        {steps.length === 0 && running && !failure && <p className="empty">When they finish a thought, it appears here as step 1 with its meaning in simple words.</p>}
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
        {newestSeg && (
          <article className="step is-newest" aria-label={`Step ${steps.length}, now`}>
            <div className="step-head">
              <span className="step-n">{steps.length}</span>
              <span className="when">{fmt(newestSeg.start_ms)}</span>
              <span className="step-now">Now</span>
            </div>
            <div className="step-said">“{newestSeg.text}”</div>
            {body(newestSeg, steps.length - 1, true)}
          </article>
        )}
        {children}
        {earlier.length > 0 && (
          <section className="earlier" aria-label={searching ? "Matching steps" : "Earlier steps"}>
            <h3>{searching ? "Matching steps" : "Earlier"} <span>{earlier.length}</span></h3>
            {earlier.map(({ sg, n }) => (
              <details key={sg.id} className="step step-earlier" open={searching}>
                <summary>
                  <span className="step-n">{n}</span>
                  <span className="when">{fmt(sg.start_ms)}</span>
                  <span className="step-line">“{sg.text}”</span>
                </summary>
                {body(sg, n - 1, false)}
              </details>
            ))}
          </section>
        )}
      </div>
      </FeedSearch.Provider>
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
