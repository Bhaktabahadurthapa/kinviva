import { useEffect, useRef, useState } from "react";
import { saveToNotes } from "../lib/notes";
import { AiText } from "../components/AiText";
import { api, errorText } from "../lib/api";
import type { Tab } from "../lib/nav";
import { greeting, minutes, percent, type DashboardStats } from "../lib/platform";
import type { Settings } from "../lib/types";

const MODES = ["Ask", "Explain", "Summarize", "Plan", "Code"] as const;
const when = (ms: number) => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const TYPE: Record<string, string> = { class: "Class", work: "Work", general: "General" };

/** Home screen: numbers come from the local database only. */
export function DashboardView({
  settings: _settings,
  running,
  refreshKey,
  onNavigate,
  onOpenSession,
  onError,
  onSaved,
}: {
  settings: Settings | null;
  running: boolean;
  refreshKey: number;
  onNavigate: (t: Tab) => void;
  onOpenSession: (id: string) => void;
  onError: (m: string) => void;
  onSaved: () => void;
}) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [mode, setMode] = useState<(typeof MODES)[number]>("Ask");
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rid = useRef<string | null>(null);

  useEffect(() => {
    api.dashboardStats().then(setStats).catch((e) => onError(errorText(e)));
  }, [refreshKey, onError]);

  const ask = async () => {
    if (!q.trim() || busy) return;
    const id = crypto.randomUUID();
    rid.current = id;
    setBusy(true);
    setAnswer(null);
    try {
      const out = await api.studioGenerate(id, "assistant", `[${mode}] ${q.trim()}`);
      if (rid.current === id) setAnswer(out);
    } catch (e) {
      if (rid.current === id) onError(errorText(e));
    } finally {
      if (rid.current === id) setBusy(false);
    }
  };

  const hour = new Date().getHours();
  const metrics: [string, number | string, string, Tab | null][] = stats
    ? [
        ["Sessions", stats.sessions, "Meetings, classes and talks you recorded", "sessions"],
        ["Interview answers", stats.interviews, "Saved practice and live answers", "interview"],
        ["Diagrams", stats.diagrams, "Saved architecture diagrams", "architecture"],
        ["Documents", stats.documents, "Files MeetingLens can use", "documents"],
      ]
    : [];

  return (
    <div className="dash">
      <section className="dash-hello">
        <div>
          <h1>{greeting(hour)}</h1>
          <p>Your assistant for important conversations: it listens, explains in plain words, and keeps what matters on this computer.</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => onNavigate("meeting")}>{running ? "Open the running session" : "New session"}</button>
      </section>

      <section className="dash-metrics" aria-label="Your activity">
        {metrics.map(([label, value, hint, tab]) => (
          <button key={label} className="metric" onClick={() => tab && onNavigate(tab)} title={hint}>
            <span className="metric-value">{value}</span>
            <span className="metric-label">{label}</span>
          </button>
        ))}
        {stats && stats.learning_total > 0 && (
          <div className="metric" title="Lessons and drills you marked done">
            <span className="metric-value">{percent(stats.learning_done, stats.learning_total)}%</span>
            <span className="metric-label">Learning progress</span>
          </div>
        )}
      </section>

      <div className="dash-grid">
        <section className="dash-card">
          <header><h2>Recent sessions</h2><button className="btn btn-ghost btn-sm" onClick={() => onNavigate("sessions")}>All sessions</button></header>
          {stats && stats.recent.length === 0 && <p className="hint">No sessions yet. Press New session to start your first one.</p>}
          <ul className="dash-list">
            {stats?.recent.map((s) => (
              <li key={s.id}>
                <div className="dash-list-main">
                  <strong>{s.title}</strong>
                  <span>{TYPE[s.session_type] ?? "Session"} · {when(s.started_at)} · {minutes(s.started_at, s.ended_at) ? `${minutes(s.started_at, s.ended_at)} min` : "in progress"}</span>
                  <span className="dash-tags">
                    <em className={s.segments ? "on" : ""}>{s.segments ? "Transcript" : "No transcript"}</em>
                    {s.notes > 0 && <em className="on">{s.notes} note{s.notes > 1 ? "s" : ""}</em>}
                    {s.diagrams > 0 && <em className="on">{s.diagrams} diagram{s.diagrams > 1 ? "s" : ""}</em>}
                  </span>
                </div>
                <button className="btn btn-sm" onClick={() => onOpenSession(s.id)}>Open</button>
              </li>
            ))}
          </ul>
        </section>

        <section className="dash-card">
          <header><h2>Quick create</h2></header>
          <div className="dash-quick">
            <button className="btn" onClick={() => onNavigate("meeting")}>Record a meeting</button>
            <button className="btn" onClick={() => onNavigate("interview")}>Practice an interview</button>
            <button className="btn" onClick={() => onNavigate("architecture")}>Generate a diagram</button>
            <button className="btn" onClick={() => onNavigate("documents")}>Import a document</button>
          </div>
        </section>

        <section className="dash-card dash-assistant">
          <header><h2>AI assistant</h2></header>
          <div className="seg" role="group" aria-label="Assistant mode">
            {MODES.map((m) => (
              <button key={m} className={mode === m ? "active" : ""} aria-pressed={mode === m} onClick={() => setMode(m)}>{m}</button>
            ))}
          </div>
          <form className="dash-ask" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={mode === "Code" ? "Describe the code you need…" : "What would you like to know?"} aria-label="Assistant request" maxLength={2000} />
            <button className="btn btn-primary" type="submit" disabled={!q.trim() || busy}>{busy ? "Thinking…" : mode}</button>
          </form>
          <p className="hint">Uses your Documents when they help and names the file. Nothing from your sessions is sent unless you open it.</p>
          {answer && <div className="dash-answer"><AiText text={answer} /><button className="btn btn-ghost btn-sm" onClick={() => void saveToNotes(answer, { title: q.trim().slice(0, 80) }).then(() => onSaved())}>Save to notes</button></div>}
        </section>
      </div>
    </div>
  );
}
