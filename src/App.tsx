import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { PrivacyPills, SourceErrors, SourcePill } from "./components/StatusBar";
import { api, errorText, inTauri } from "./lib/api";
import { useLive } from "./lib/useLive";
import type { Settings } from "./lib/types";
import { DocumentsView } from "./views/DocumentsView";
import { HistoryView } from "./views/HistoryView";
import { LiveView } from "./views/LiveView";
import { SettingsView } from "./views/SettingsView";

type Tab = "live" | "history" | "documents" | "settings";

function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--c-line-strong)" strokeWidth="1.2" />
      <circle cx="12" cy="12" r="6.8" fill="none" stroke="var(--c-text)" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3" fill="var(--c-signal)" />
    </svg>
  );
}

function Elapsed({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.floor((Date.now() - since) / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return <span className="timecode">{`${hh}:${mm}:${ss}`}</span>;
}

export default function App() {
  const { state: live, dispatch } = useLive();
  const [tab, setTab] = useState<Tab>("live");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [historyKey, setHistoryKey] = useState(0);
  const status = live.status;
  const running = status?.state === "running";
  const busy = status?.state === "starting" || status?.state === "stopping";
  const toggleRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!inTauri) return;
    api.getSettings().then((s) => {
      setSettings(s);
      if (!s.onboarded) setTab("settings");
    });
    const subs = [
      listen<string>("app-error", (e) => setError(e.payload)),
      listen("meeting-saved", () => setHistoryKey((k) => k + 1)),
      listen<Settings>("settings-changed", (e) => setSettings(e.payload)),
      listen<string>("shortcut", (e) => {
        if (e.payload === "toggle_meeting") toggleRef.current();
        if (e.payload === "suggest_reply") api.aiRun("suggest").catch((err) => setError(errorText(err)));
        if (e.payload === "explain") api.aiRun("explain").catch((err) => setError(errorText(err)));
      }),
    ];
    return () => subs.forEach((p) => p.then((u) => u()));
  }, []);

  const toggleMeeting = async () => {
    setError(null);
    try {
      if (running) await api.stopMeeting();
      else if (!busy) {
        await api.startMeeting(title);
        setTitle("");
        setTab("live");
      }
    } catch (e) {
      setError(errorText(e));
    }
  };
  toggleRef.current = toggleMeeting;

  if (!inTauri) {
    return (
      <div className="browser-note">
        <Logo /> MeetingLens is a desktop app. Run it with <code>npm run tauri dev</code>; a browser tab cannot capture audio or reach the backend.
      </div>
    );
  }

  const llmHost = (() => {
    try {
      return new URL(settings?.llm_base_url ?? "").host;
    } catch {
      return "not set";
    }
  })();
  const llmLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(llmHost);

  return (
    <div className="app">
      <nav className="rail">
        <div className="brand">
          <Logo />
          <span>
            Meeting<em>Lens</em>
          </span>
        </div>
        {(
          [
            ["live", "Live"],
            ["history", "History"],
            ["documents", "Documents"],
            ["settings", settings?.onboarded === false ? "Setup" : "Settings"],
          ] as [Tab, string][]
        ).map(([t, label], i) => (
          // The index is drawn by CSS so the button's text stays just its label.
          <button key={t} className={`rail-btn ${tab === t ? "active" : ""}`} data-idx={String(i + 1).padStart(2, "0")} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
        <div className="rail-foot">
          <button className="rail-btn" onClick={() => api.toggleOverlay().catch((e) => setError(errorText(e)))}>
            Overlay
          </button>
          <span className="rail-tag">local-first · v0.1</span>
        </div>
      </nav>
      <main>
        <header className="console">
          <div className="onair">
            <span className={`lamp ${running ? "is-live" : ""}`}>
              {running ? <span className="rec" aria-label="Capturing" /> : <span className="rec-off" />}
              {running ? "On air" : busy ? status?.state : "Standby"}
            </span>
            {running && status?.started_at ? <Elapsed since={status.started_at} /> : <span className="timecode idle">00:00:00</span>}
          </div>
          <div className="console-mid">
            {running ? (
              <strong className="mtitle">{status?.title}</strong>
            ) : (
              <input
                className="title-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Name this meeting…"
                disabled={busy}
              />
            )}
            {status && (
              <div className="strips">
                <SourcePill name="Them" source="system" st={status.system} level={live.levels.system} idle={status.state === "idle"} idleEnabled={settings?.capture_system} />
                <SourcePill name="Me" source="mic" st={status.mic} level={live.levels.mic} idle={status.state === "idle"} idleEnabled={settings?.capture_mic} />
                <PrivacyPills status={status} llmHost={llmHost} llmLocal={llmLocal} />
              </div>
            )}
          </div>
          <button className={`btn btn-lg ${running ? "btn-danger" : "btn-primary"}`} onClick={toggleMeeting} disabled={busy}>
            {status?.state === "starting" ? "Starting…" : status?.state === "stopping" ? "Stopping…" : running ? "Stop" : "Start meeting"}
          </button>
        </header>
        {error && (
          <div className="banner banner-bad toast" role="alert">
            <span>{error}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}
        {status && <SourceErrors status={status} />}
        <div className="content">
          {tab === "live" && <LiveView live={live} dispatch={dispatch} onError={setError} />}
          {tab === "history" && <HistoryView onError={setError} onOpenLive={() => setTab("live")} refreshKey={historyKey} />}
          {tab === "documents" && <DocumentsView onError={setError} />}
          {tab === "settings" && <SettingsView onError={setError} onSaved={setSettings} />}
        </div>
      </main>
    </div>
  );
}
