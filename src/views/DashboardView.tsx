import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { AiText } from "../components/AiText";
import { api, errorText } from "../lib/api";
import { sendToBoard } from "../lib/boardInbox";
import { saveToNotes } from "../lib/notes";
import type { Tab } from "../lib/nav";
import { greeting, minutes, percent, type DashboardStats, type DiscoverItem, type LearningItem, type Trend } from "../lib/platform";
import type { Settings } from "../lib/types";

const MODES = ["Ask", "Explain", "Summarize", "Visualize", "Plan", "Code"] as const;
const when = (ms: number) => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const ago = (ms: number | null) => {
  if (!ms) return "";
  const h = Math.floor((Date.now() - ms) / 3_600_000);
  return h < 1 ? "just now" : h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};
const TYPE: Record<string, { label: string; tab: Tab; icon: string; tone: string }> = {
  class: { label: "Classroom", tab: "classroom", icon: "M3 8l9-5 9 5-9 5zM7 10.5V16c0 1 2.2 3 5 3s5-2 5-3v-5.5", tone: "green" },
  work: { label: "Meeting", tab: "meeting", icon: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3", tone: "blue" },
  general: { label: "Meeting", tab: "meeting", icon: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3", tone: "blue" },
};

function Icon({ d, size = 20 }: { d: string; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
}

interface Task { id: string; text: string; done: boolean }
function useTasks(): [Task[], (t: Task[]) => void] {
  const today = new Date().toDateString();
  const [tasks, setTasks] = useState<Task[]>(() => {
    try {
      const day = localStorage.getItem("ml.focus.day");
      const all = JSON.parse(localStorage.getItem("ml.focus") ?? "[]") as Task[];
      // A new day keeps what is still to do and clears what was finished.
      return day === today ? all : all.filter((t) => !t.done);
    } catch {
      return [];
    }
  });
  const set = (t: Task[]) => {
    setTasks(t);
    try {
      localStorage.setItem("ml.focus", JSON.stringify(t));
      localStorage.setItem("ml.focus.day", today);
    } catch {
      /* not essential */
    }
  };
  return [tasks, set];
}

/** Home screen. Every number comes from this computer's records; nothing is estimated. */
export function DashboardView({ settings, running, refreshKey, onNavigate, onOpenSession, onError, onSaved }: {
  settings: Settings | null; running: boolean; refreshKey: number; onNavigate: (t: Tab) => void; onOpenSession: (id: string) => void; onError: (m: string) => void; onSaved: () => void;
}) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [learning, setLearning] = useState<LearningItem[]>([]);
  const [disc, setDisc] = useState<DiscoverItem[]>([]);
  const [trends, setTrends] = useState<Trend[]>([]);
  const [dTab, setDTab] = useState<"for_you" | "news" | "repos" | "learn">("for_you");
  const [mode, setMode] = useState<(typeof MODES)[number]>("Ask");
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [tasks, setTasks] = useTasks();
  const [task, setTask] = useState("");
  const rid = useRef<string | null>(null);

  useEffect(() => {
    api.dashboardStats().then(setStats).catch((e) => onError(errorText(e)));
    api.learningList().then(setLearning).catch(() => {});
    if (settings?.discover_enabled) {
      api.discoverList(undefined, false).then(([l]) => setDisc(l)).catch(() => {});
      api.discoverTrends().then(setTrends).catch(() => {});
    }
  }, [refreshKey, onError, settings?.discover_enabled]);

  useEffect(() => {
    if (!settings?.discover_enabled) return;
    const un = listen("discover-updated", () => {
      api.discoverList(undefined, false).then(([l]) => setDisc(l)).catch(() => {});
      api.discoverTrends().then(setTrends).catch(() => {});
    });
    return () => void un.then((f) => f()).catch(() => {});
  }, [settings?.discover_enabled]);

  const ask = async () => {
    if (!q.trim() || busy) return;
    if (mode === "Visualize") {
      sendToBoard(q.trim());
      return onNavigate("whiteboard");
    }
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

  const name = settings?.profile_name?.trim();
  const steps = learning.filter((i) => i.kind === "lesson" || i.kind === "drill");
  const goals = learning.filter((i) => i.kind === "goal").slice(0, 2).map((g) => {
    const s = steps.filter((x) => x.parent_id === g.id);
    return { g, p: percent(s.filter((x) => x.status === "done").length, s.length), next: s.find((x) => x.status === "doing") ?? s.find((x) => x.status === "todo") };
  });
  const done = tasks.filter((t) => t.done).length;
  const shown = disc.filter((d) => (dTab === "news" ? d.kind === "news" : dTab === "repos" ? d.kind === "repo" : true)).slice(0, 4);
  const enabled = !!settings?.discover_enabled;

  return (
    <div className="dash2">
      <section className="d-hello">
        <div className="d-hero">
          <p className="d-greet">{greeting(new Date().getHours())}{name ? `, ${name}` : ""}</p>
          <h1>Understand more.<br /><span className="d-grad">Keep it private.</span></h1>
          <p className="d-sub">Your meeting assistant for interviews, meetings, classes and technical discussions, all on your computer.</p>
          <div className="d-new">
            <button className="btn btn-primary btn-lg d-new-main" onClick={() => onNavigate("meeting")}>{running ? "Open running session" : "+ New session"}</button>
            <button className="btn btn-primary btn-lg d-new-more" aria-label="Choose a session type" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>▾</button>
            {menu && (
              <div className="d-menu" role="menu" onMouseLeave={() => setMenu(false)}>
                {([["meeting", "Meeting"], ["interview", "Interview practice"], ["classroom", "Classroom lecture"], ["presentation", "Presentation"], ["technical", "Technical discussion"]] as [Tab, string][]).map(([t, l]) => <button key={t} role="menuitem" onClick={() => { setMenu(false); onNavigate(t); }}>{l}</button>)}
              </div>
            )}
          </div>
        </div>
        <div className="d-private">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><rect x="9" y="10.5" width="6" height="5" rx="1" /><path d="M10 10.5V9a2 2 0 0 1 4 0v1.5" /></svg>
          <div><strong>Your conversations stay private</strong><span>No accounts and no tracking. Recordings and notes are stored on this computer.</span></div>
        </div>
      </section>

      <section className="d-modes" aria-label="What would you like to do?">
        {([
          ["Meetings", "Transcribe and get summaries", "meeting", "M5 5h14v14H5zM5 9h14M9 3v4M15 3v4", "purple"],
          ["Interviews", "Practise and get answer help", "interview", "M12 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM5 20a7 7 0 0 1 14 0", "blue"],
          ["Technical Copilot", "Solve problems, learn faster", "technical", "M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16", "purple"],
          ["Classroom", "Get explanations in plain English", "classroom", "M3 8l9-5 9 5-9 5zM7 10.5V16c0 1 2.2 3 5 3s5-2 5-3v-5.5", "blue"],
          ["Presentations", "Prepare and refine your talks", "presentation", "M3 5h18v12H3zM8 21h8M12 17v4M10 9l5 2.5-5 2.5z", "purple"],
        ] as [string, string, Tab, string, string][]).map(([l, d, t, ic, tone]) => (
          <button key={l} className="d-mode" onClick={() => onNavigate(t)}>
            <span className={`d-ico d-ico-sm tone-${tone}`}><Icon d={ic} size={22} /></span>
            <strong>{l}</strong>
            <span className="d-mode-desc">{d}</span>
            <span className="d-mode-go" aria-hidden>→</span>
          </button>
        ))}
      </section>

      {stats && (
        <section className="d-metrics d-strip" aria-label="Your activity">
          <button onClick={() => onNavigate("sessions")}><b>{stats.sessions}</b> sessions <i>{stats.sessions_week > 0 ? `+${stats.sessions_week} this week` : ""}</i></button>
          <button onClick={() => onNavigate("notes")}><b>{stats.notes}</b> notes</button>
          <button onClick={() => onNavigate("technical")}><b>{stats.diagrams}</b> diagrams</button>
          <button onClick={() => onNavigate("whiteboard")}><b>{stats.whiteboards}</b> boards</button>
          <button onClick={() => onNavigate("learning")}><b>{stats.learning_done}</b>{stats.learning_total ? ` of ${stats.learning_total}` : ""} learning steps</button>
        </section>
      )}

      <section className="d-card d-recent">
        <header><h2>Recent sessions</h2><button className="d-link" onClick={() => onNavigate("sessions")}>View all →</button></header>
        {stats && stats.recent.length === 0 && <p className="hint">No sessions yet. Press New session to start your first one.</p>}
        <ul className="d-rows">
          {stats?.recent.map((s) => {
            const t = TYPE[s.session_type] ?? TYPE.general;
            const m = minutes(s.started_at, s.ended_at);
            return (
              <li key={s.id}>
                <span className={`d-ico d-ico-sm tone-${t.tone}`}><Icon d={t.icon} size={18} /></span>
                <div className="d-row-main"><strong>{s.title}</strong><span>{t.label}{s.segments ? ` · ${s.segments} lines` : " · no transcript"}{s.notes ? ` · ${s.notes} note${s.notes > 1 ? "s" : ""}` : ""}{s.diagrams ? ` · ${s.diagrams} diagram${s.diagrams > 1 ? "s" : ""}` : ""}</span></div>
                <div className="d-row-meta"><span>{when(s.started_at)}</span><b>{m ? `${m} min` : "in progress"}</b></div>
                <button className="btn btn-sm" onClick={() => onOpenSession(s.id)}>Open</button>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="d-mid">
        <section className="d-card">
          <header><h2>Continue learning</h2><button className="d-link" onClick={() => onNavigate("learning")}>View plan →</button></header>
          {goals.length === 0 ? <p className="hint">No learning goals yet. Set one in My Learning and MeetingLens will suggest the steps.</p> : goals.map(({ g, p, next }) => (
            <div key={g.id} className="d-goal">
              <span className="d-ico tone-purple"><Icon d="M3 18V6a2 2 0 0 1 2-2h14v14H5a2 2 0 0 0-2 2zM8 8h7M8 12h5" /></span>
              <div className="d-goal-main"><strong>{g.title}</strong>{next && <span>Next: {next.title}</span>}<div className="d-bar"><i style={{ width: `${p ?? 0}%` }} /></div></div>
              <b>{p === null ? "–" : `${p}%`}</b>
            </div>
          ))}
        </section>
        <section className="d-card">
          <header><h2>Quick create</h2></header>
          <div className="d-quick">
            {([["Record meeting", "meeting", "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3"], ["New board", "whiteboard", "M3 5h18v12H3zM8 21h8M12 17v4"], ["Generate diagram", "architecture", "M4 4h6v5H4zM14 4h6v5h-6zM9 15h6v5H9zM7 9v3h10V9M12 12v3"], ["Practice interview", "interview", "M4 5h16v10H9l-5 4zM8 9h8M8 12h5"], ["Import document", "documents", "M12 16V4M7 9l5-5 5 5M5 20h14"]] as [string, Tab, string][]).map(([l, t, d]) => (
              <button key={l} className="d-quick-btn" onClick={() => onNavigate(t)}><span className="d-ico d-ico-sm tone-purple"><Icon d={d} size={18} /></span>{l}</button>
            ))}
          </div>
        </section>
      </div>

      <aside className="d-right">
        <section className="d-card d-assistant">
          <header><h2 className="d-h2-ico"><Icon d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" size={18} /> Assistant</h2></header>
          <div className="d-tabs" role="tablist" aria-label="Assistant mode">{MODES.map((m) => <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>{m}</button>)}</div>
          <form className="d-ask" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
            <textarea value={q} onChange={(e) => setQ(e.target.value)} rows={3} placeholder={mode === "Code" ? "Describe the code you need…" : "Ask about your documents, or anything technical…"} aria-label="Assistant request" maxLength={2000} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(); } }} />
            <button className="btn btn-primary" type="submit" disabled={!q.trim() || busy}>{busy ? "Thinking…" : mode === "Visualize" ? "Draw it" : "Send"}</button>
          </form>
          <p className="hint">Uses your Documents and names the file. Your sessions are used only when you open them.</p>
          {answer && <div className="dash-answer"><AiText text={answer} /><button className="btn btn-ghost btn-sm" onClick={() => void saveToNotes(answer, { title: q.trim().slice(0, 80) }).then(() => onSaved())}>Save to notes</button></div>}
        </section>

        <section className="d-card">
          <header><h2>Today's focus</h2></header>
          <ul className="d-tasks">
            {tasks.map((t) => (
              <li key={t.id}>
                <label className="check"><input type="checkbox" checked={t.done} onChange={() => setTasks(tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))} /><span className={t.done ? "done" : ""}>{t.text}</span></label>
                <button className="btn btn-ghost btn-sm" aria-label={`Remove ${t.text}`} onClick={() => setTasks(tasks.filter((x) => x.id !== t.id))}>✕</button>
              </li>
            ))}
          </ul>
          <form className="d-addtask" onSubmit={(e) => { e.preventDefault(); if (task.trim()) { setTasks([...tasks, { id: crypto.randomUUID(), text: task.trim(), done: false }]); setTask(""); } }}>
            <input value={task} onChange={(e) => setTask(e.target.value)} placeholder="Add a task for today" aria-label="Add a task" maxLength={120} />
            <button className="btn btn-sm" type="submit" disabled={!task.trim()}>Add</button>
          </form>
          {tasks.length > 0 && <div className="d-progress"><div className="d-bar"><i style={{ width: `${percent(done, tasks.length) ?? 0}%` }} /></div><span>{done} of {tasks.length} completed</span></div>}
        </section>
        <section className="d-card d-promo">
          <svg className="d-wave" viewBox="0 0 300 80" aria-hidden><defs><linearGradient id="dw" x1="0" x2="1"><stop offset="0" stopColor="#3b82f6" /><stop offset="1" stopColor="#8b5cf6" /></linearGradient></defs><path d="M0 60C50 10 90 70 150 40S250 0 300 30V80H0z" fill="url(#dw)" opacity=".18" /><path d="M0 60C50 10 90 70 150 40S250 0 300 30" fill="none" stroke="url(#dw)" strokeWidth="3" /></svg>
          <h2>Turn your conversations into <span className="d-grad">clarity</span></h2>
          <p>Clearer notes. Better decisions.</p>
          <button className="btn btn-primary" onClick={() => onNavigate("meeting")}>Start now →</button>
        </section>
      </aside>

      <section className="d-card d-discover">
        <header>
          <h2 className="d-h2-ico"><Icon d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z" size={18} /> Discover{settings?.interests?.length ? ` — ${settings.interests.slice(0, 3).join(", ")}${settings.interests.length >= 3 ? " & more" : ""}` : ""}</h2>
          <button className="d-link" onClick={() => onNavigate("discover")}>{settings?.interests?.length ? "Manage interests →" : "Choose interests →"}</button>
        </header>
        {!enabled ? (
          <div className="d-off"><p>Get real articles and open-source projects for the topics you follow, from official engineering blogs. It is off until you turn it on, and nothing is invented.</p><button className="btn btn-primary" onClick={() => onNavigate("discover")}>Set up Discover</button></div>
        ) : (
          <div className="d-disc-body">
            <div className="d-disc-main">
              <div className="d-tabs" role="tablist" aria-label="Discover sections">{([["for_you", "For you"], ["news", "Latest news"], ["repos", "GitHub projects"], ["learn", "Learning paths"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={dTab === k} className={dTab === k ? "active" : ""} onClick={() => setDTab(k)}>{l}</button>)}</div>
              {dTab === "learn" ? <p className="hint">Official learning paths and certification pages are listed in Discover.</p> : shown.length === 0 ? <p className="hint">Nothing yet. Open Discover and press Refresh.</p> : (
                <div className="d-cards">
                  {shown.map((d) => (
                    <article key={d.id} className={`d-article ${d.image ? "" : "d-text-only"}`}>
                      {d.image && (
                        <button className="d-thumb" onClick={() => api.openExternal(d.url).catch((e) => onError(errorText(e)))} aria-label={`Open ${d.title}`}>
                          <img src={d.image} alt="" loading="lazy" className={d.kind === "repo" ? "d-avatar" : ""} />
                          {d.topic && <span className="d-tag">{d.topic}</span>}
                        </button>
                      )}
                      {!d.image && d.topic && <span className="d-tag-inline">{d.topic}</span>}
                      <button className="d-title" onClick={() => api.openExternal(d.url).catch((e) => onError(errorText(e)))}>{d.title}</button>
                      {d.summary && <p className="d-summary">{d.summary}</p>}
                      <span className="d-src">{d.source} · {ago(d.published_at)}{d.stars != null ? ` · ★ ${d.stars.toLocaleString()}` : ""}</span>
                    </article>
                  ))}
                </div>
              )}
            </div>
            <div className="d-trend">
              <h3>Trending topics <span>last 30 days</span></h3>
              {trends.length === 0 ? <p className="hint">Appears after Discover has fetched articles.</p> : (
                <ol>{trends.slice(0, 5).map((t) => <li key={t.topic}><span>{t.topic}</span><b>{t.recent} post{t.recent === 1 ? "" : "s"}</b>{t.previous > 0 && <em className={t.recent >= t.previous ? "up" : "down"}>{t.recent >= t.previous ? "↑" : "↓"} {Math.abs(Math.round(((t.recent - t.previous) / t.previous) * 100))}%</em>}</li>)}</ol>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
