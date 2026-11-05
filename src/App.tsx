import { listen } from "@tauri-apps/api/event";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { PrivacyPills, SourceErrors, SourcePill } from "./components/StatusBar";
import { api, errorText, inTauri } from "./lib/api";
import { useLive } from "./lib/useLive";
import type { Settings } from "./lib/types";
import { InterviewView } from "./views/InterviewView";
import { MeetingView, type MeetingTab } from "./views/MeetingView";
import { SettingsView } from "./views/SettingsView";
import { SavedDialog } from "./components/SavedDialog";
import { chooseSavePath, safeName, type NotesFormat } from "./lib/download";
import { defaultSession, loadSession, saveSession, sessionProblem, type SessionChoice } from "./lib/session";
import type { Course } from "./lib/types";

/** The two primary areas. Settings is a utility button, not a primary item. */
const ArchitecturePanel = lazy(() => import("./components/architecture/ArchitecturePanel").then((m) => ({ default: m.ArchitecturePanel })));

type Tab = "meeting" | "interview" | "architecture" | "sessions" | "knowledge" | "settings";

function Logo() {
  // The app icon mark: a lens with a voice waveform inside.
  return (
    <svg width="28" height="28" viewBox="100 100 824 824" aria-hidden>
      <defs>
        <linearGradient id="lg-tile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#22386a" />
          <stop offset="1" stopColor="#0c1730" />
        </linearGradient>
        <linearGradient id="lg-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#9db9ff" />
        </linearGradient>
        <linearGradient id="lg-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9db9ff" />
          <stop offset="1" stopColor="#4d7cff" />
        </linearGradient>
      </defs>
      <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#lg-tile)" />
      <circle cx="512" cy="500" r="206" fill="#0a1226" fillOpacity="0.55" />
      <circle cx="512" cy="500" r="206" fill="none" stroke="url(#lg-ring)" strokeWidth="40" />
      <path d="M668 656 L748 736" stroke="url(#lg-ring)" strokeWidth="44" strokeLinecap="round" />
      <g fill="url(#lg-bar)">
        <rect x="396" y="466" width="32" height="68" rx="16" />
        <rect x="448" y="418" width="32" height="164" rx="16" />
        <rect x="496" y="372" width="32" height="256" rx="16" />
        <rect x="544" y="418" width="32" height="164" rx="16" />
        <rect x="596" y="466" width="32" height="68" rx="16" />
      </g>
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

/** The running meeting's name: edit it any time; saved when you leave the field. */
function LiveTitle({ id, initial, onError }: { id: string | null; initial: string; onError: (m: string) => void }) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const commit = async () => {
    const next = value.trim();
    if (!id || next === saved) return;
    if (!next) return setValue(saved);
    try {
      await api.renameMeeting(id, next);
      setSaved(next);
    } catch (e) {
      onError(errorText(e));
      setValue(saved);
    }
  };
  return (
    <input
      className="title-input"
      aria-label="Meeting name"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}

export default function App() {
  const { state: live, dispatch } = useLive();
  const [tab, setTab] = useState<Tab>("meeting");
  const [archSeen, setArchSeen] = useState(false);
  useEffect(() => {
    if (tab === "architecture") setArchSeen(true);
  }, [tab]);
  const meetingTab: MeetingTab = tab === "sessions" ? "history" : tab === "knowledge" ? "resources" : "live";
  const [session, setSessionState] = useState<SessionChoice>(loadSession);
  const [courses, setCourses] = useState<Course[]>([]);
  const setSession = (s: SessionChoice) => {
    setSessionState(s);
    saveSession(s);
  };
  const loadCourses = () => api.listCourses().then(setCourses).catch((e) => setError(errorText(e)));
  useEffect(() => {
    if (inTauri) void loadCourses();
  }, []);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("");
  useEffect(() => {
    api.appInfo().then((i) => setVersion(i.version)).catch(() => {});
  }, []);
  const [historyKey, setHistoryKey] = useState(0);
  const [saved, setSaved] = useState<{ id: string; title: string } | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  /** When this practice session began; "Download this session" in Interview covers entries since then. */
  const [interviewSince, setInterviewSince] = useState<number>(() => Date.now());
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
      listen<string>("meeting-saved", (e) => {
        setHistoryKey((k) => k + 1);
        // Offer the notes right away, but only for meetings that captured something.
        api.getMeeting(e.payload).then((d) => {
          if (d.segments.length > 0) {
            setSaved({ id: d.meeting.id, title: d.meeting.title });
            setSavedMsg(null);
          }
        }).catch(() => {});
      }),
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
        const inInterview = tab === "interview";
        const chosen = inInterview ? defaultSession : session;
        const problem = sessionProblem(chosen, courses.map((c) => c.id));
        if (problem) {
          setTab("meeting");
          setError(problem);
          return;
        }
        await api.startMeeting(title, chosen);
        setTitle("");
        // Starting from Interview stays in Interview; other screens go to Meeting.
        if (tab !== "interview") setTab("meeting");
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
            ["meeting", "Meeting"],
            ["interview", "Interview"],
            ["architecture", "Architecture"],
            ["sessions", "Sessions"],
            ["knowledge", "Knowledge"],
          ] as [Tab, string][]
        ).map(([t, label], i) => (
          // The index is drawn by CSS so the button's text stays just its label.
          <button key={t} className={`rail-btn ${tab === t ? "active" : ""}`} data-idx={String(i + 1).padStart(2, "0")} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
        <div className="rail-foot">
          <button className={`rail-btn rail-util ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>
            {settings?.onboarded === false ? "Setup" : "Settings"}
          </button>
          <button className="rail-btn rail-util" onClick={() => api.toggleOverlay().catch((e) => setError(errorText(e)))}>
            Overlay
          </button>
          <span className="rail-tag">local-first{version && ` · v${version}`}</span>
        </div>
      </nav>
      <main>
        <header className="console">
          <div className="onair">
            <span className={`lamp ${running ? "is-live" : ""}`}>
              {running && !status?.paused ? <span className="rec" aria-label="Capturing" /> : <span className="rec-off" />}
              {running ? (status?.paused ? "Paused" : "On air") : busy ? status?.state : "Standby"}
            </span>
            {running && status?.started_at ? <Elapsed since={status.started_at} /> : <span className="timecode idle">00:00:00</span>}
          </div>
          <div className="console-mid">
            {running ? (
              <LiveTitle key={status?.meeting_id ?? "x"} id={status?.meeting_id ?? null} initial={status?.title ?? ""} onError={setError} />
            ) : (
              <input
                className="title-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={tab === "interview" ? "Name this interview…" : "Name this meeting…"}
                disabled={busy}
              />
            )}
            {status && (
              <div className="strips">
                <SourcePill name="Them" source="system" st={status.system} level={live.levels.system} idle={status.state === "idle"} idleEnabled={settings?.capture_system} />
                <SourcePill name="Me" source="mic" st={status.mic} level={live.levels.mic} idle={status.state === "idle"} idleEnabled={settings?.capture_mic} />
                <PrivacyPills status={status} />
              </div>
            )}
          </div>
          <div className="console-actions">
          {running && (
            <button
              className="btn btn-lg"
              aria-pressed={!!status?.paused}
              title={status?.paused ? "Resume transcription" : "Stop transcribing for now; capture stays open"}
              onClick={() => api.setPaused(!status?.paused).catch((e) => setError(errorText(e)))}
            >
              {status?.paused ? "Resume" : "Pause"}
            </button>
          )}
          <button className={`btn btn-lg ${running ? "btn-danger" : "btn-primary"}`} onClick={toggleMeeting} disabled={busy}>
            {status?.state === "starting" ? "Starting…" : status?.state === "stopping" ? "Stopping…" : running ? "Stop" : tab === "interview" ? "Start interview" : "Start meeting"}
          </button>
          </div>
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
        {saved && (
          <SavedDialog
            title={saved.title}
            message={savedMsg}
            onClose={() => setSaved(null)}
            onOpenSessions={() => {
              setSaved(null);
              setTab("sessions");
            }}
            onPick={async (f: NotesFormat) => {
              const path = await chooseSavePath(safeName(saved.title, "meeting"), f);
              if (!path) return;
              try {
                await api.exportMeeting(saved.id, f, path);
                setSavedMsg(`Saved to ${path}`);
              } catch (e) {
                setError(errorText(e));
              }
            }}
          />
        )}
        <div className="content">
          {(tab === "meeting" || tab === "sessions" || tab === "knowledge") && (
            <MeetingView
              tab={meetingTab}
              onTab={(t) => setTab(t === "history" ? "sessions" : t === "resources" ? "knowledge" : "meeting")}
              live={live}
              dispatch={dispatch}
              onError={setError}
              autoMode={settings?.auto_assist ?? "off"}
              onAutoChange={(m) => {
                if (!settings) return;
                const next = { ...settings, auto_assist: m };
                setSettings(next);
                api.saveSettings(next).catch((e) => setError(errorText(e)));
              }}
              session={session}
              onSession={setSession}
              courses={courses}
              onCoursesChanged={loadCourses}
              running={!!running}
              historyKey={historyKey}
            />
          )}
          {tab === "interview" && <InterviewView live={live} onError={setError} since={interviewSince} onNewSession={() => setInterviewSince(Date.now())} />}
          {archSeen && (
            <div hidden={tab !== "architecture"} className="arch-host">
              <Suspense fallback={<p className="hint arch-loading">Loading the diagram tools…</p>}>
                <ArchitecturePanel live={live} onError={setError} />
              </Suspense>
            </div>
          )}
          {tab === "settings" && <SettingsView onError={setError} onSaved={setSettings} />}
        </div>
      </main>
    </div>
  );
}
