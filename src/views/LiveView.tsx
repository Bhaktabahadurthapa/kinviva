import { useEffect, useRef, useState } from "react";
import { AiPanel } from "../components/AiPanel";
import { ActionBar } from "../components/ActionBar";
import { SimpleStream } from "../components/SimpleStream";
import { TranscriptView } from "../components/TranscriptView";
import { api, errorText } from "../lib/api";
import type { LiveEvent, LiveState } from "../lib/liveReducer";
import type { AutoMode, DeviceInfo } from "../lib/types";

const AUTO_OPTIONS: [AutoMode, string, string][] = [
  ["off", "Off", "Answer only when you press a button"],
  ["explain", "Explain only", "Explain each thing they say, automatically"],
  ["explain_reply", "Explain + answer", "Explain everything, and draft an answer to every question, automatically"],
];

export function LiveView({
  live,
  dispatch,
  onError,
  autoMode,
  onAutoChange,
}: {
  live: LiveState;
  dispatch: (e: LiveEvent) => void;
  onError: (m: string) => void;
  autoMode: AutoMode;
  onAutoChange: (m: AutoMode) => void;
}) {
  const status = live.status;
  const running = status?.state === "running";
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState(live.notes);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const timer = useRef<number>();

  useEffect(() => setNotes(live.notes), [live.notes]);
  useEffect(() => {
    if (running && status?.mic.enabled) api.listInputDevices().then(setDevices).catch(() => {});
  }, [running, status?.mic.enabled]);

  const saveNotes = (v: string) => {
    setNotes(v);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => api.setLiveNotes(v).catch((e) => onError(errorText(e))), 400);
  };

  const contextBanner =
    !running && status?.context_meeting_id ? (
      <div className={`banner ${status.context_is_demo ? "banner-demo" : "banner-info"}`}>
        {status.context_is_demo ? "DEMO DATA — " : ""}Showing saved meeting “{status.title}”. AI actions use this transcript.
      </div>
    ) : null;

  return (
    <div className="live">
      {contextBanner}
      {live.question && (
        <div className="banner banner-q">
          <span>
            <strong>Question detected:</strong> “{live.question.text}”
          </span>
          <span>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                dispatch({ type: "dismissQuestion" });
                api.aiRun("suggest").catch((e) => onError(errorText(e)));
              }}
            >
              Suggest reply
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => dispatch({ type: "dismissQuestion" })}>
              Dismiss
            </button>
          </span>
        </div>
      )}
      <div className={autoMode === "off" ? "live-grid" : "live-stack"}>
        <section className="panel transcript-panel">
          <header>
            <h2>{autoMode === "off" ? "Live transcript" : "Captured audio"}</h2>
            <div className="panel-tools">
              <div className="seg" role="group" aria-label="Automatic help">
                <span className="seg-label">Auto</span>
                {AUTO_OPTIONS.map(([m, label, title]) => (
                  <button key={m} className={autoMode === m ? "active" : ""} title={title} aria-pressed={autoMode === m} onClick={() => onAutoChange(m)}>
                    {label}
                  </button>
                ))}
              </div>
              {running && status?.mic.enabled && devices.length > 0 && (
                <select
                  className="select-sm"
                  aria-label="Microphone"
                  value={devices.find((d) => d.name === status.mic.device)?.name ?? ""}
                  onChange={(e) => api.switchMic(e.target.value || null).catch((err) => onError(errorText(err)))}
                >
                  <option value="">Default microphone</option>
                  {devices.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => setNotesOpen((o) => !o)}>
                {notesOpen ? "Hide notes" : "My notes"}
              </button>
            </div>
          </header>
          {notesOpen && (
            <textarea
              className="notes"
              value={notes}
              onChange={(e) => saveNotes(e.target.value)}
              placeholder="Private notes for this meeting. Suggested replies may use them as facts about you."
            />
          )}
          <TranscriptView
            transcript={live.transcript}
            emptyHint={running ? "Listening… speech will appear here." : "Start a meeting to see the live transcript."}
          />
        </section>
        {autoMode === "off" ? (
          <div className="side">
            <AiPanel title="Simple meaning" voice="serif" slot={live.ai.meaning} placeholder="Press Explain to get the latest point in plain English. Recap and Ask answers also appear here." />
            <AiPanel title="Suggested reply" slot={live.ai.reply} editable placeholder="Press Suggest reply for a short draft you can edit. Nothing is sent to the meeting." />
          </div>
        ) : (
          // Reading view: what they said (top) becomes simple words (bottom), hands-free.
          <section className="panel simple-panel">
            <header>
              <h2>In simple words</h2>
              <span className="auto-tag">automatic</span>
            </header>
            <SimpleStream finals={live.transcript.finals} side={live.side} running={!!running} />
          </section>
        )}
      </div>
      <ActionBar live={live} onError={onError} />
    </div>
  );
}
