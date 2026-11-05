import { ManualAnswers } from "./components/ManualAnswers";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { SimpleStream } from "./components/SimpleStream";
import { ActionBar } from "./components/ActionBar";
import { AiPanel } from "./components/AiPanel";
import { TranscriptView } from "./components/TranscriptView";
import { api, errorText, inTauri } from "./lib/api";
import { ScreenAssist } from "./components/ScreenAssist";
import { useLive } from "./lib/useLive";
import { renderMarked, renderTerm } from "./lib/highlight";
import type { InterviewEvent, InterviewParsed } from "./lib/types";

const ALPHA_KEY = "ml.overlayAlpha2";

function loadAlpha(): number {
  try {
    const v = Number(localStorage.getItem(ALPHA_KEY));
    if (localStorage.getItem(ALPHA_KEY) !== null && v >= 0 && v <= 100) return v;
  } catch {
    /* storage unavailable */
  }
  return 0; // clear: only the words show over what is behind
}

/** The latest interview answer, shown here so you can read it without the main window. */
function InterviewAnswer() {
  const [ev, setEv] = useState<{ state: "streaming" | "done" | "error"; result: InterviewParsed | null; text: string | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!inTauri) return;
    const sub = listen<InterviewEvent>("interview-event", (e) => {
      const p = e.payload;
      if (p.mode !== "explain") return; // questions and feedback are for the Interview screen
      if (p.state === "cancelled") return;
      setEv({ state: p.state, result: p.result, text: p.fallback_text, error: p.error });
    });
    return () => void sub.then((un) => un());
  }, []);
  if (!ev) return null;
  if (ev.state === "streaming") return <div className="ov-iv"><p className="ov-iv-title">Interview answer</p><p className="iv-wait">Writing the answer…</p></div>;
  if (ev.state === "error") return <div className="ov-iv"><p className="ov-iv-title">Interview answer</p><p className="iv-wait">{ev.error ?? "The answer could not be written."}</p></div>;
  const r = ev.result;
  if (r?.kind !== "answer") return ev.text ? <div className="ov-iv"><p className="ov-iv-title">Interview answer</p><p>{ev.text}</p></div> : null;
  return (
    <div className="ov-iv">
      <p className="ov-iv-title">Say it</p>
      <p className="ov-iv-say">{renderMarked(r.say_it)}</p>
      <p className="ov-iv-title">Understand it</p>
      <p>{renderMarked(r.understand_it)}</p>
      {(r.hard_words?.length ?? 0) > 0 && (
        <>
          <p className="ov-iv-title">Hard words</p>
          <ul>{r.hard_words!.map((t, i) => <li key={i}>{renderTerm(t)}</li>)}</ul>
        </>
      )}
      {r.follow_up && <p className="ov-iv-follow">Likely follow-up: {r.follow_up}</p>}
    </div>
  );
}

/**
 * Compact always-on-top companion: the newest answers in large, readable text
 * over a see-through background you can adjust. It opens by itself when the
 * main window is minimized. Drag by the header; resize from edges.
 */
export default function Overlay() {
  const { state: live } = useLive();
  const [alpha, setAlpha] = useState(loadAlpha);
  const [auto, setAuto] = useState<string>("explain_reply");
  const [hidden, setHidden] = useState<boolean | null>(null);
  useEffect(() => {
    if (!inTauri) return;
    api.getSettings().then((s) => (setAuto(s.auto_assist), setHidden(s.overlay_content_protection))).catch(() => {});
    const sub = listen<{ auto_assist: string; overlay_content_protection: boolean }>("settings-changed", (e) => (setAuto(e.payload.auto_assist), setHidden(e.payload.overlay_content_protection)));
    return () => void sub.then((un) => un());
  }, []);
  const changeAlpha = (v: number) => {
    setAlpha(v);
    try {
      localStorage.setItem(ALPHA_KEY, String(v));
    } catch {
      /* not essential */
    }
  };
  const toggleHidden = async () => {
    try {
      const cur = await api.getSettings();
      await api.saveSettings({ ...cur, overlay_content_protection: !cur.overlay_content_protection });
    } catch (e) {
      setErr(errorText(e));
    }
  };
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"assist" | "transcript">("assist");
  const st = live.status;
  const running = st?.state === "running";

  return (
    <div className="overlay" style={{ ["--ov-a" as string]: alpha / 100 }}>
      <header className="ov-head" data-tauri-drag-region>
        <span className={`rec ${running ? "" : "rec-off"}`} data-tauri-drag-region />
        <span className={`ov-title ${running ? "is-live" : ""}`} data-tauri-drag-region>
          {running ? "On air" : "Standby"}
          {running && st?.audio_to_cloud ? " · audio → cloud" : ""}
        </span>
        {hidden !== null && (
          <button className={`ov-shield ${hidden ? "on" : ""}`} onClick={() => void toggleHidden()} aria-pressed={hidden} title={hidden ? "Hidden from screen sharing and recording. Works with most tools, so test it before an important call. Click to show." : "Visible to screen sharing. Click to hide this window from sharing."}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z" />{hidden && <path d="M9 12l2 2 4-4" />}</svg>
            {hidden ? "Hidden" : "Visible"}
          </button>
        )}
        <input
          className="ov-alpha"
          type="range"
          min={0}
          max={100}
          step={5}
          value={alpha}
          aria-label="Overlay transparency"
          title="Transparency: far left is fully clear (only the words show), right is solid"
          onChange={(e) => changeAlpha(Number(e.target.value))}
        />
        <div className="ov-tabs">
          <button className={view === "assist" ? "active" : ""} onClick={() => setView("assist")}>
            Assist
          </button>
          <button className={view === "transcript" ? "active" : ""} onClick={() => setView("transcript")}>
            Transcript
          </button>
          <button title="Open main window" onClick={() => api.showMain()}>
            ⤢
          </button>
          <button title="Hide overlay" onClick={() => getCurrentWindow().hide()}>
            ✕
          </button>
        </div>
      </header>
      {err && (
        <div className="banner banner-bad" onClick={() => setErr(null)}>
          {err}
        </div>
      )}
      <div className="ov-body">
        <ScreenAssist compact />
        {view === "transcript" ? (
          <TranscriptView transcript={live.transcript} compact emptyHint={running ? "Listening…" : "No meeting running."} />
        ) : auto !== "off" ? (
          <>
            <InterviewAnswer />
            <ManualAnswers live={live} />
            <SimpleStream finals={live.transcript.finals} side={live.side} running={!!running} />
          </>
        ) : (
          <>
            <div className="ov-latest">
              <TranscriptView
                transcript={{ finals: live.transcript.finals.slice(-2), partials: live.transcript.partials }}
                compact
                emptyHint={running ? "Listening…" : "No meeting running."}
              />
            </div>
            <AiPanel title="Plain-English meaning" voice="serif" slot={live.ai.meaning} placeholder="Explain shows the latest point in plain English." />
            <AiPanel title="Suggested reply" slot={live.ai.reply} editable placeholder="Suggest reply drafts a short answer to review." />
          </>
        )}
      </div>
      <ActionBar live={live} onError={(m) => setErr(errorText(m))} compact />
    </div>
  );
}
