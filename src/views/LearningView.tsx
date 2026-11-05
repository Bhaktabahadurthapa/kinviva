import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "../lib/api";
import { latestGuard } from "../lib/latest";
import { gaps, newId, percent, type LearningItem, type TopicScore } from "../lib/platform";
import type { Tab } from "../lib/nav";

const guard = latestGuard();
const STATUS: [LearningItem["status"], string][] = [["todo", "To do"], ["doing", "In progress"], ["done", "Done"]];

/** Goals, steps and progress. Progress is the share of steps you marked done; nothing is invented. */
export default function LearningView({ onError, onChanged, onNavigate }: { onError: (m: string) => void; onChanged: () => void; onNavigate: (t: Tab) => void }) {
  const [items, setItems] = useState<LearningItem[]>([]);
  const [topics, setTopics] = useState<TopicScore[]>([]);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.learningList().then(setItems).catch((e) => onError(errorText(e)));
    api.quizTopics().then(setTopics).catch(() => {});
  }, [onError]);
  useEffect(() => load(), [load]);

  const save = async (it: LearningItem) => {
    try {
      const s = await api.learningSave(it);
      setItems((l) => (l.some((x) => x.id === s.id) ? l.map((x) => (x.id === s.id ? s : x)) : [...l, s]));
      onChanged();
      return s;
    } catch (e) {
      onError(errorText(e));
    }
  };
  const remove = (id: string) => api.learningDelete(id).then(() => (load(), onChanged())).catch((e) => onError(errorText(e)));

  const createGoal = async (generate: boolean) => {
    const title = goal.trim();
    if (title.length < 3) return;
    const mine = guard.next();
    setBusy(true);
    try {
      const g = await save({ id: newId(), kind: "goal", title, status: "todo" });
      if (generate && g) {
        const plan = JSON.parse(await api.studioGenerate(crypto.randomUUID(), "learning_plan", title)) as { steps: { title: string; detail: string; kind: "lesson" | "drill" }[] };
        if (guard.isCurrent(mine)) for (const s of plan.steps) await save({ id: newId(), kind: s.kind, title: s.title, detail: s.detail, status: "todo", parent_id: g.id, source: "MeetingLens plan" });
      }
      setGoal("");
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const goals = items.filter((i) => i.kind === "goal");
  const steps = (id: string) => items.filter((i) => i.parent_id === id);
  const all = items.filter((i) => i.kind === "lesson" || i.kind === "drill");
  const done = all.filter((i) => i.status === "done").length;
  const pct = percent(done, all.length);
  const next = all.find((i) => i.status === "doing") ?? all.find((i) => i.status === "todo");
  const weak = gaps(topics);
  const resources = items.filter((i) => i.kind === "resource");
  const addGap = async (t: TopicScore) => {
    const g = goals.find((x) => x.title === "Review weak topics") ?? (await save({ id: newId(), kind: "goal", title: "Review weak topics", status: "todo" }));
    if (g) await save({ id: newId(), kind: "drill", title: `Review ${t.topic}`, detail: `Quiz accuracy was ${Math.round((t.correct / t.total) * 100)}% over ${t.total} answers.`, status: "todo", parent_id: g.id, source: "Quiz results" });
  };

  return (
    <div className="learn">
      <header><h1>My Learning</h1><p className="hint">Set a goal, follow the steps, and mark them done. Progress and scores come only from what you do here.</p></header>
      <section className="dash-metrics">
        <div className="metric"><span className="metric-value">{pct === null ? "–" : `${pct}%`}</span><span className="metric-label">{all.length ? `${done} of ${all.length} steps done` : "No steps yet"}</span></div>
        <div className="metric"><span className="metric-value">{topics.reduce((a, t) => a + t.attempts, 0)}</span><span className="metric-label">Quizzes taken</span></div>
        <div className="metric"><span className="metric-value">{topics.reduce((a, t) => a + t.total, 0) ? `${Math.round((topics.reduce((a, t) => a + t.correct, 0) / topics.reduce((a, t) => a + t.total, 0)) * 100)}%` : "–"}</span><span className="metric-label">Quiz accuracy</span></div>
      </section>
      {next && <p className="banner banner-info">Next up: <strong>{next.title}</strong>{next.detail ? ` — ${next.detail}` : ""}</p>}

      <section className="dash-card">
        <h2>New goal</h2>
        <div className="disc-row">
          <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="For example: Pass the CKA exam, or Learn Terraform basics" aria-label="Learning goal" maxLength={160} />
          <button className="btn btn-primary" onClick={() => void createGoal(true)} disabled={busy || goal.trim().length < 3}>{busy ? "Planning…" : "Make a plan"}</button>
          <button className="btn" onClick={() => void createGoal(false)} disabled={busy || goal.trim().length < 3}>Add goal only</button>
        </div>
      </section>

      {goals.length === 0 && <p className="hint">No goals yet. Add one above; MeetingLens can suggest the steps.</p>}
      {goals.map((g) => {
        const s = steps(g.id).filter((x) => x.kind !== "resource");
        const p = percent(s.filter((x) => x.status === "done").length, s.length);
        return (
          <section key={g.id} className="learn-goal">
            <div className="inc-head"><h2>{g.title}</h2><span className="hint">{p === null ? "No steps" : `${p}% done`}</span><button className="btn btn-ghost btn-sm" onClick={() => void remove(g.id)}>Delete</button></div>
            {p !== null && <div className="learn-bar" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${p}%` }} /></div>}
            <ul className="learn-steps">
              {s.map((x) => (
                <li key={x.id}>
                  <span><strong>{x.title}</strong> <em className="tc-chip">{x.kind}</em>{x.detail && <><br /><span className="hint">{x.detail}</span></>}</span>
                  {x.kind === "drill" && <button className="btn btn-ghost btn-sm" onClick={() => onNavigate("interview")}>Practice</button>}
                  {x.kind === "lesson" && <button className="btn btn-ghost btn-sm" onClick={() => onNavigate("classroom")}>Study</button>}
                  <select value={x.status} onChange={(e) => void save({ ...x, status: e.target.value as LearningItem["status"] })} aria-label={`Status of ${x.title}`}>{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  <button className="btn btn-ghost btn-sm" onClick={() => void remove(x.id)} aria-label={`Remove ${x.title}`}>Remove</button>
                </li>
              ))}
            </ul>
            <AddStep onAdd={(title) => void save({ id: newId(), kind: "lesson", title, status: "todo", parent_id: g.id })} />
          </section>
        );
      })}

      {weak.length > 0 && (
        <section className="dash-card"><h2>Knowledge gaps</h2><p className="hint">Topics where your quiz accuracy is under 70% after at least five answers.</p>
          <ul className="dash-list">{weak.map((t) => <li key={t.topic}><div className="dash-list-main"><strong>{t.topic}</strong><span>{t.correct} of {t.total} correct over {t.attempts} quiz{t.attempts > 1 ? "zes" : ""}</span></div><button className="btn btn-sm" onClick={() => void addGap(t)}>Add a review step</button></li>)}</ul></section>
      )}
      {resources.length > 0 && (
        <section className="dash-card"><h2>Saved resources</h2>
          <ul className="dash-list">{resources.map((r) => <li key={r.id}><div className="dash-list-main"><strong>{r.title}</strong><span>{r.source}</span></div><span className="disc-row">{r.url && <button className="btn btn-sm" onClick={() => void api.openExternal(r.url!).catch((e) => onError(errorText(e)))}>Open</button>}<button className="btn btn-ghost btn-sm" onClick={() => void remove(r.id)}>Remove</button></span></li>)}</ul></section>
      )}
    </div>
  );
}

function AddStep({ onAdd }: { onAdd: (t: string) => void }) {
  const [v, setV] = useState("");
  return <form className="disc-row" onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onAdd(v.trim()); setV(""); } }}><input value={v} onChange={(e) => setV(e.target.value)} placeholder="Add a step" aria-label="Add a step" maxLength={160} /><button className="btn btn-sm" type="submit" disabled={!v.trim()}>Add</button></form>;
}
