import { listen } from "@tauri-apps/api/event";
import { NAV, SESSION_TABS, type Tab } from "./lib/nav";
import { ClassroomView } from "./views/ClassroomView";
import { PresentationView } from "./views/PresentationView";
import { NotesView } from "./views/NotesView";
import { KnowledgeView } from "./views/KnowledgeView";
import { DashboardView } from "./views/DashboardView";
import { TopBar, HIT_TAB } from "./components/TopBar";
import { lazy, Suspense } from "react";
import { TechnicalView, type TechSub } from "./views/TechnicalView";
import { useEffect, useRef, useState } from "react";
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

const WhiteboardView = lazy(() => {
  (window as unknown as Record<string, string>).EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";
  return import("./views/WhiteboardView");
});

const DiscoverView = lazy(() => import("./views/DiscoverView"));
const LearningView = lazy(() => import("./views/LearningView"));
const VisualsView = lazy(() => import("./views/VisualsView"));

export default function App() {
  const { state: live, dispatch } = useLive();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("ml.rail") === "collapsed";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("ml.rail", collapsed ? "collapsed" : "open");
    } catch {
      /* not essential */
    }
  }, [collapsed]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const [techSeen, setTechSeen] = useState(false);
  const [wbSeen, setWbSeen] = useState(false);
  const [boardOpen, setBoardOpen] = useState<string | null>(null);
  useEffect(() => {
    if (tab === "whiteboard") setWbSeen(true);
  }, [tab]);
  const [techSub, setTechSub] = useState<TechSub>("explain");
  useEffect(() => {
    if (tab === "technical") setTechSeen(true);
  }, [tab]);
  const [searchSeed, setSearchSeed] = useState("");
  const go = (t: Tab) => {
    if (t === "architecture") {
      setTechSub("architecture");
      setTab("technical");
    } else setTab(t);
  };
  const openHit = (h: { kind: string; title: string }) => {
    setSearchSeed(h.kind === "session" || h.kind === "transcript" ? h.title : "");
    go(HIT_TAB[h.kind] ?? "dashboard");
  };
  const meetingTab: MeetingTab = tab === "sessions" ? "history" : tab === "documents" ? "resources" : "live";
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
        if (!SESSION_TABS.has(tab)) setTab("meeting");
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
    <div className={`app ${collapsed ? "rail-collapsed" : ""}`}>
      <TopBar
        settings={settings}
        logo={<Logo />}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        onSettings={() => setTab("settings")}
        onOpenHit={openHit}
      />
      <nav className="rail" aria-label="Main menu">
        {(["Main", "Workspace"] as const).map((group) => (
          <div key={group} className="rail-group">
            <span className="rail-heading">{group}</span>
            {NAV.filter((n) => n.group === group && n.ready).map((n) => (
              <button key={n.id} title={n.label} className={`rail-btn ${tab === n.id ? "active" : ""}`} aria-current={tab === n.id ? "page" : undefined} onClick={() => setTab(n.id)}>
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={n.icon} /></svg>
                <span className="rail-label">{n.label}</span>
              </button>
            ))}
          </div>
        ))}
        <div className="rail-interests">
          <span className="rail-heading">My interests</span>
          <div className="rail-chips">
            {(settings?.interests ?? []).slice(0, 5).map((t) => <button key={t} className="rail-chip" onClick={() => setTab("discover")}>{t}</button>)}
            <button className="rail-chip rail-chip-add" onClick={() => setTab("discover")}>+ {settings?.interests?.length ? "Add" : "Add interest"}</button>
          </div>
        </div>
        <div className="rail-foot">
          <button title="Settings" className={`rail-btn rail-util ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" /></svg>
            <span className="rail-label">{settings?.onboarded === false ? "Setup" : "Settings"}</span>
          </button>
          <button title="Overlay (see-through answers window)" className="rail-btn rail-util" onClick={() => api.toggleOverlay().catch((e) => setError(errorText(e)))}>
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="5" width="14" height="11" rx="2" /><rect x="8" y="9" width="13" height="10" rx="2" /></svg>
            <span className="rail-label">Overlay</span>
          </button>
          <span className="rail-tag rail-label">local-first{version && ` · v${version}`}</span>
        </div>
      </nav>
      <main>
        {(SESSION_TABS.has(tab) || running || busy) && (
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
        )}
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
          {(tab === "meeting" || tab === "sessions" || tab === "documents") && (
            <MeetingView
              tab={meetingTab}
              onTab={(t) => setTab(t === "history" ? "sessions" : t === "resources" ? "documents" : "meeting")}
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
              searchSeed={searchSeed}
            />
          )}
          {tab === "dashboard" && (
            <DashboardView
              settings={settings}
              running={!!running}
              refreshKey={historyKey}
              onNavigate={go}
              onOpenSession={(id) => { void api.getMeeting(id).then((d) => setSearchSeed(d.meeting.title)).catch(() => {}); setTab("sessions"); }}
              onError={setError}
              onSaved={() => setHistoryKey((k) => k + 1)}
            />
          )}
          {tab === "classroom" && <ClassroomView live={live} running={!!running} onError={setError} onChanged={() => setHistoryKey((k) => k + 1)} onBoard={() => setTab("whiteboard")} />}
          {tab === "presentation" && <PresentationView live={live} running={!!running} onError={setError} onChanged={() => setHistoryKey((k) => k + 1)} onBoard={() => setTab("whiteboard")} />}
          {tab === "notes" && <NotesView onError={setError} refreshKey={historyKey} onChanged={() => setHistoryKey((k) => k + 1)} />}
          {tab === "knowledge" && <KnowledgeView onError={setError} onOpenHit={openHit} />}
          {tab === "interview" && <InterviewView live={live} onError={setError} since={interviewSince} onNewSession={() => setInterviewSince(Date.now())} />}
          {tab === "discover" && (
            <Suspense fallback={<p className="hint arch-loading">Loading…</p>}>
              <DiscoverView settings={settings} onSettings={setSettings} onError={setError} onChanged={() => setHistoryKey((k) => k + 1)} onBoard={() => setTab("whiteboard")} />
            </Suspense>
          )}
          {tab === "learning" && (
            <Suspense fallback={<p className="hint arch-loading">Loading…</p>}>
              <LearningView onError={setError} onChanged={() => setHistoryKey((k) => k + 1)} onNavigate={go} />
            </Suspense>
          )}
          {tab === "visuals" && (
            <Suspense fallback={<p className="hint arch-loading">Loading…</p>}>
              <VisualsView onError={setError} onChanged={() => setHistoryKey((k) => k + 1)} onOpenBoard={(id) => { setBoardOpen(id); setTab("whiteboard"); }} onOpenDiagram={() => go("architecture")} />
            </Suspense>
          )}
          {wbSeen && (
            <div hidden={tab !== "whiteboard"} className="wb-host">
              <Suspense fallback={<p className="hint arch-loading">Loading the whiteboard…</p>}>
                <WhiteboardView onError={setError} onChanged={() => setHistoryKey((k) => k + 1)} initialBoard={boardOpen} />
              </Suspense>
            </div>
          )}
          {techSeen && (
            <div hidden={tab !== "technical"} className="tc-host">
              <TechnicalView live={live} onError={setError} sub={techSub} onSub={setTechSub} onChanged={() => setHistoryKey((k) => k + 1)} />
            </div>
          )}
          {tab === "settings" && <SettingsView onError={setError} onSaved={setSettings} />}
        </div>
      </main>
    </div>
  );
}
