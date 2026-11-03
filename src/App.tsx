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
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10.5" fill="var(--ink-2)" />
      <circle cx="12" cy="12" r="7" fill="none" stroke="var(--accent)" strokeWidth="2" />
      <circle cx="12" cy="12" r="3.4" fill="var(--amber)" />
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
  return <span className="elapsed">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`}</span>;
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
          <Logo /> <span>MeetingLens</span>
        </div>
        {(
          [
            ["live", "Live"],
            ["history", "History"],
            ["documents", "Documents"],
            ["settings", settings?.onboarded === false ? "Setup" : "Settings"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
        <div className="rail-foot">
          <button onClick={() => api.toggleOverlay().catch((e) => setError(errorText(e)))}>Overlay</button>
        </div>
      </nav>
      <main>
        <header className="topbar">
          <div className="meeting-ctl">
            {running ? (
              <>
                <span className="rec" aria-label="Capturing" />
                <strong className="mtitle">{status?.title}</strong>
                {status?.started_at && <Elapsed since={status.started_at} />}
              </>
            ) : (
              <input
                className="title-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Meeting title (optional)"
                disabled={busy}
              />
            )}
            <button className={`btn ${running ? "btn-danger" : "btn-primary"}`} onClick={toggleMeeting} disabled={busy}>
              {status?.state === "starting" ? "Starting…" : status?.state === "stopping" ? "Stopping…" : running ? "Stop" : "Start meeting"}
            </button>
          </div>
          {status && (
            <div className="pills">
              <SourcePill name="System" source="system" st={status.system} level={live.levels.system} idle={status.state === "idle"} idleEnabled={settings?.capture_system} />
              <SourcePill name="Mic" source="mic" st={status.mic} level={live.levels.mic} idle={status.state === "idle"} idleEnabled={settings?.capture_mic} />
              <PrivacyPills status={status} llmHost={llmHost} llmLocal={llmLocal} />
            </div>
          )}
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
