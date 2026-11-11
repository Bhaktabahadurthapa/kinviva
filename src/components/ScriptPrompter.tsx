import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Transcript } from "../lib/types";
import { clampIndex, heardFlags, isSaid, parseScriptState, SCRIPT_KEY, splitScript, wordsOf, type ScriptState } from "../lib/script";

function load(): ScriptState {
  try {
    return parseScriptState(localStorage.getItem(SCRIPT_KEY));
  } catch {
    return parseScriptState(null);
  }
}

/**
 * Your own script, shown a line at a time. Nothing is written by an AI: the lines are exactly what you saved.
 * With "Follow my voice" on, it moves to the next line after it hears you say the current one.
 */
export function ScriptPrompter({ transcript, running }: { transcript: Transcript; running: boolean }) {
  const [st, setSt] = useState<ScriptState>(load);
  const [editing, setEditing] = useState(() => !load().text.trim());
  const [draft, setDraft] = useState(() => load().text);
  const rootRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => splitScript(st.text), [st.text]);
  const index = clampIndex(st.index, lines.length);
  const line = lines[index] ?? "";

  const save = useCallback((next: ScriptState) => {
    setSt(next);
    try {
      localStorage.setItem(SCRIPT_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: the script still works until the window closes */
    }
  }, []);

  // Keep the main window and the overlay in step: the script is stored once and shared.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SCRIPT_KEY) setSt(load());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // What you have said since this line became current (your microphone only).
  const baseline = useRef(0);
  const lastLine = useRef(-1);
  const mine = transcript.finals.filter((s) => s.source === "mic");
  const newestMine = mine.length ? mine[mine.length - 1].id : 0;
  useEffect(() => {
    if (lastLine.current !== index) {
      lastLine.current = index;
      baseline.current = newestMine;
    }
  }, [index, newestMine]);
  const spoken = (mine.filter((s) => s.id > baseline.current).map((s) => s.text).join(" ") + " " + (transcript.partials.mic ?? "")).trim();

  const go = useCallback(
    (to: number) => {
      const next = clampIndex(to, lines.length);
      if (next !== index) save({ ...st, index: next });
    },
    [index, lines.length, save, st],
  );

  // Follow my voice: move on when most of the line was heard.
  useEffect(() => {
    if (!st.follow || !running || !line || editing) return;
    if (index < lines.length - 1 && isSaid(line, spoken)) go(index + 1);
  }, [spoken, st.follow, running, line, index, lines.length, editing, go]);

  // Keyboard: arrows, space and enter move through the script (not while typing in the editor).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || (e.target as Element | null)?.closest?.("textarea,input")) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " " || e.key === "Enter") (e.preventDefault(), go(index + 1));
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") (e.preventDefault(), go(index - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, go, index]);

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 500_000) return void alert("That file is too big for a script (500 KB limit).");
    const r = new FileReader();
    r.onload = () => setDraft(String(r.result ?? ""));
    r.readAsText(f);
  };

  if (editing) {
    return (
      <div className="sp sp-edit" ref={rootRef}>
        <p className="sp-lead">Your script. One line per paragraph. It is shown exactly as written, and nothing is generated.</p>
        <textarea
          className="sp-text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={"Paste or type what you want to say.\nPut each thing you will say on its own line.\n\nHello everyone, thanks for joining.\nToday I will walk you through our plan."}
          aria-label="Your script"
          spellCheck
        />
        <div className="sp-row">
          <label className="btn btn-sm">
            Open a text file
            <input type="file" accept=".txt,.md,text/plain,text/markdown" hidden onChange={(e) => (onFile(e.target.files?.[0] ?? undefined), (e.target.value = ""))} />
          </label>
          <span className="hint">{splitScript(draft).length} line{splitScript(draft).length === 1 ? "" : "s"}</span>
          <span className="sp-spacer" />
          {lines.length > 0 && (
            <button className="btn btn-sm" onClick={() => (setDraft(st.text), setEditing(false))}>
              Cancel
            </button>
          )}
          <button
            className="btn btn-primary btn-sm"
            disabled={!draft.trim()}
            onClick={() => (save({ ...st, text: draft, index: draft === st.text ? st.index : 0 }), setEditing(false))}
          >
            Save script
          </button>
        </div>
      </div>
    );
  }

  const flags = heardFlags(line, spoken);
  const tokens = line.split(/(\s+)/);
  let wi = -1;
  const upcoming = lines.slice(index + 1, index + 3);

  return (
    <div className="sp" ref={rootRef} tabIndex={-1}>
      <div className="sp-bar">
        <span className="sp-count">
          Line {index + 1} of {lines.length}
        </span>
        <label className="check sp-follow" title="Moves to the next line after it hears you say the current one. Needs a running session so it can hear your microphone.">
          <input type="checkbox" checked={st.follow} onChange={(e) => save({ ...st, follow: e.target.checked })} /> Follow my voice
        </label>
        <span className="sp-spacer" />
        <button className="btn btn-sm" onClick={() => (setDraft(st.text), setEditing(true))}>
          Edit
        </button>
      </div>
      {st.follow && !running && <p className="hint sp-hint">Press Start so Kinviva can hear you. Until then, use Next, or the arrow keys.</p>}
      {index > 0 && (
        <button className="sp-line sp-prev" onClick={() => go(index - 1)} title="Back to this line">
          {lines[index - 1]}
        </button>
      )}
      <p className="sp-now" aria-live="polite">
        {tokens.map((t, i) => {
          if (/^\s+$/.test(t) || !t) return t;
          const n = wordsOf(t).length;
          const heard = n > 0 && flags[wi + 1] === true;
          wi += n;
          return (
            <span key={i} className={heard ? "sp-heard" : undefined}>
              {t}
            </span>
          );
        })}
      </p>
      {upcoming.map((l, i) => (
        <button key={index + 1 + i} className={`sp-line ${i === 0 ? "sp-next" : "sp-later"}`} onClick={() => go(index + 1 + i)} title="Jump to this line">
          {l}
        </button>
      ))}
      {index === lines.length - 1 && <p className="hint sp-end">That is the last line.</p>}
      <div className="sp-row sp-nav">
        <button className="btn" onClick={() => go(index - 1)} disabled={index === 0}>
          ◀ Back
        </button>
        <button className="btn btn-primary" onClick={() => go(index + 1)} disabled={index >= lines.length - 1}>
          Next ▶
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => go(0)} disabled={index === 0}>
          Start over
        </button>
      </div>
    </div>
  );
}
