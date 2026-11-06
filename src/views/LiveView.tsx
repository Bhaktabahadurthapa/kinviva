import { useEffect, useRef, useState } from "react";
import { AiPanel } from "../components/AiPanel";
import { ActionBar, useActions } from "../components/ActionBar";
import { SimpleStream } from "../components/SimpleStream";
import { ScreenAssist } from "../components/ScreenAssist";
import { ManualAnswers } from "../components/ManualAnswers";
import { WatchStage } from "../components/WatchStage";
import { Splitter } from "../components/Splitter";
import { TranscriptView } from "../components/TranscriptView";
import { countMatches } from "../lib/search";
import { loadSplit, saveSplit } from "../lib/split";
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
  const [split, setSplitState] = useState(loadSplit);
  const setSplit = (v: number) => {
    setSplitState(v);
    saveSplit(v);
  };
  const [layout, setLayoutState] = useState<"standard" | "watch">(() => {
    try {
      return localStorage.getItem("ml.liveLayout") === "watch" ? "watch" : "standard";
    } catch {
      return "standard";
    }
  });
  const setLayout = (v: "standard" | "watch") => {
    setLayoutState(v);
    try { localStorage.setItem("ml.liveLayout", v); } catch { /* not essential */ }
  };
  const [wsplit, setWsplitState] = useState(() => loadSplit("ml.watchSplit", 52));
  const setWsplit = (v: number) => {
    setWsplitState(v);
    saveSplit(v, "ml.watchSplit");
  };
  const watchGrid = useRef<HTMLDivElement>(null);
  // The video is a layer above the window: it steps aside while the divider is dragged.
  const dragVideo = (dragging: boolean) => void api.videoVisible(!dragging).catch(() => {});
  const [tOpen, setTOpenState] = useState(() => {
    try {
      return localStorage.getItem("ml.watchTranscript") === "open";
    } catch {
      return false;
    }
  });
  const setTOpen = (v: boolean) => {
    setTOpenState(v);
    try { localStorage.setItem("ml.watchTranscript", v ? "open" : "closed"); } catch { /* not essential */ }
  };
  const act = useActions(onError);
  const lastLine = live.transcript.finals[live.transcript.finals.length - 1];
  const caption = lastLine ? { who: lastLine.source === "system" ? "Them" : "Me", text: lastLine.text } : null;
  const [query, setQuery] = useState("");
  const grid = useRef<HTMLDivElement>(null);
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
        {status.context_is_demo ? "DEMO DATA — " : ""}Showing saved meeting “{status.title}”. MeetingLens actions use this transcript.
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
      <div className="live-layout" role="group" aria-label="Screen layout">
        <button className={layout === "standard" ? "on" : ""} aria-pressed={layout === "standard"} onClick={() => setLayout("standard")}>Standard</button>
        <button className={layout === "watch" ? "on" : ""} aria-pressed={layout === "watch"} onClick={() => setLayout("watch")}>Watch a video</button>
        {layout === "watch" && (
          <span className="live-size" role="group" aria-label="Video and answers width">
            <i>Width</i>
            {([[36, "More answers"], [52, "Balanced"], [66, "More video"]] as const).map(([v, l]) => <button key={v} className={Math.abs(wsplit - v) < 4 ? "on" : ""} onClick={() => setWsplit(v)}>{l}</button>)}
            <em>Drag the divider to resize</em>
          </span>
        )}
      </div>
      {layout === "watch" ? (
        <div ref={watchGrid} className="live-watch" style={{ ["--wsplit" as string]: `minmax(0, ${wsplit}fr) 16px minmax(0, ${100 - wsplit}fr)` }}>
          <WatchStage caption={caption} onAction={(a) => void act(a)} />
          <Splitter value={wsplit} onChange={setWsplit} container={watchGrid} reset={52} onStart={() => dragVideo(true)} onEnd={() => dragVideo(false)} />
          <div className="live-watch-side">
        {autoMode === "off" ? (
          <div className="side">
            <AiPanel title="Plain-English meaning" voice="serif" slot={live.ai.meaning} placeholder="Press Explain to get the latest point in plain English. Recap and Ask answers also appear here." />
            <AiPanel title="Suggested reply" slot={live.ai.reply} editable placeholder="Press Suggest reply for a short draft you can edit. Nothing is sent to the meeting." />
          </div>
        ) : (
          // Reading view: what they said (top) becomes simple words (bottom), hands-free.
          <section className="panel simple-panel">
            <header>
              <h2>Live insights</h2>
              <span className="auto-tag">Auto-assist</span>
            </header>
            <ManualAnswers live={live} />
            <SimpleStream finals={live.transcript.finals} side={live.side} running={!!running} />
          </section>
        )}
        <button className="ws-tbar" onClick={() => setTOpen(!tOpen)} aria-expanded={tOpen}>
          <span className="ws-tbar-label">Transcript</span>
          <span className="ws-tbar-line">{caption ? `${caption.who}: ${caption.text}` : running ? "Listening…" : "Nothing yet"}</span>
          <span className="ws-tbar-act">{tOpen ? "Hide" : "Show all"}</span>
        </button>
        {tOpen && (
        <section className="panel transcript-panel">
          <header>
            <h2>{autoMode === "off" ? "Live transcript" : "Live transcript"}</h2>
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
          <div className="tsearch">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search this transcript" aria-label="Search this transcript" />
            {query.trim() && <span className="tsearch-count" role="status">{countMatches(live.transcript.finals, query)} found</span>}
          </div>
          <TranscriptView
            query={query}
            transcript={live.transcript}
            emptyHint={running ? "Listening… speech will appear here." : "Start a meeting to see the live transcript."}
          />
        </section>
        )}
          </div>
        </div>
      ) : (
      <div ref={grid} className={autoMode === "off" ? "live-grid" : "live-stack"} style={{ ["--split" as string]: `minmax(0, ${split}fr) 16px minmax(0, ${100 - split}fr)` }}>
        <section className="panel transcript-panel">
          <header>
            <h2>{autoMode === "off" ? "Live transcript" : "Live transcript"}</h2>
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
          <div className="tsearch">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search this transcript" aria-label="Search this transcript" />
            {query.trim() && <span className="tsearch-count" role="status">{countMatches(live.transcript.finals, query)} found</span>}
          </div>
          <TranscriptView
            query={query}
            transcript={live.transcript}
            emptyHint={running ? "Listening… speech will appear here." : "Start a meeting to see the live transcript."}
          />
        </section>
        <Splitter value={split} onChange={setSplit} container={grid} />
        {autoMode === "off" ? (
          <div className="side">
            <AiPanel title="Plain-English meaning" voice="serif" slot={live.ai.meaning} placeholder="Press Explain to get the latest point in plain English. Recap and Ask answers also appear here." />
            <AiPanel title="Suggested reply" slot={live.ai.reply} editable placeholder="Press Suggest reply for a short draft you can edit. Nothing is sent to the meeting." />
          </div>
        ) : (
          // Reading view: what they said (top) becomes simple words (bottom), hands-free.
          <section className="panel simple-panel">
            <header>
              <h2>Live insights</h2>
              <span className="auto-tag">Auto-assist</span>
            </header>
            <ManualAnswers live={live} />
            <SimpleStream finals={live.transcript.finals} side={live.side} running={!!running} />
          </section>
        )}
      </div>
      )}
      <ScreenAssist />
      <ActionBar live={live} onError={onError} />
    </div>
  );
}
