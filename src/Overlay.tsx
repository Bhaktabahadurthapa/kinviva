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

/**
 * Compact always-on-top companion: the newest answers in large, readable text
 * over a see-through background you can adjust. It opens by itself when the
 * main window is minimized. Drag by the header; resize from edges.
 */
export default function Overlay() {
  const { state: live } = useLive();
  const [alpha, setAlpha] = useState(loadAlpha);
  const [auto, setAuto] = useState<string>("explain_reply");
  useEffect(() => {
    if (!inTauri) return;
    api.getSettings().then((s) => setAuto(s.auto_assist)).catch(() => {});
    const sub = listen<{ auto_assist: string }>("settings-changed", (e) => setAuto(e.payload.auto_assist));
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
