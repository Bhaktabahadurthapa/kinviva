import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState } from "react";
import { ActionBar } from "./components/ActionBar";
import { AiPanel } from "./components/AiPanel";
import { TranscriptView } from "./components/TranscriptView";
import { api, errorText } from "./lib/api";
import { useLive } from "./lib/useLive";

/** Compact always-on-top companion. Drag by the header; resize from edges. */
export default function Overlay() {
  const { state: live } = useLive();
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"assist" | "transcript">("assist");
  const st = live.status;
  const running = st?.state === "running";

  return (
    <div className="overlay">
      <header className="ov-head" data-tauri-drag-region>
        <span className={`rec ${running ? "" : "rec-off"}`} data-tauri-drag-region />
        <span className={`ov-title ${running ? "is-live" : ""}`} data-tauri-drag-region>
          {running ? "On air" : "Standby"}
          {running && st?.audio_to_cloud ? " · audio → cloud" : ""}
        </span>
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
        {view === "transcript" ? (
          <TranscriptView transcript={live.transcript} compact emptyHint={running ? "Listening…" : "No meeting running."} />
        ) : (
          <>
            <div className="ov-latest">
              <TranscriptView
                transcript={{ finals: live.transcript.finals.slice(-2), partials: live.transcript.partials }}
                compact
                emptyHint={running ? "Listening…" : "No meeting running."}
              />
            </div>
            <AiPanel title="Simple meaning" voice="serif" slot={live.ai.meaning} placeholder="Explain shows the latest point in plain English." />
            <AiPanel title="Suggested reply" slot={live.ai.reply} editable placeholder="Suggest reply drafts a short answer to review." />
          </>
        )}
      </div>
      <ActionBar live={live} onError={(m) => setErr(errorText(m))} compact />
    </div>
  );
}
