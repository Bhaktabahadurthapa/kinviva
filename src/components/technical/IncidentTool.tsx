import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "../../lib/api";
import { emptyIncident, mergeExtracted, parseIncident, rootCauseAllowed, type IncidentData, type ListKey } from "../../lib/incident";
import { newId, type AppRecord } from "../../lib/platform";

const LISTS: [ListKey, string, string][] = [
  ["symptoms", "Symptoms", "What is observed"],
  ["evidence", "Evidence", "Facts and results you collected"],
  ["actions", "Investigative actions", "What was checked or tried"],
  ["decisions", "Decisions", "What was agreed"],
  ["open_questions", "Open questions", "What is still unknown"],
  ["follow_ups", "Follow-up tasks", "What must happen next"],
];

function ListEditor({ label, hint, items, onChange }: { label: string; hint: string; items: string[]; onChange: (l: string[]) => void }) {
  const [v, setV] = useState("");
  const add = () => v.trim() && (onChange([...items, v.trim()]), setV(""));
  return (
    <section className="inc-list">
      <h3>{label}</h3>
      <ul>{items.map((t, i) => <li key={i}><span>{t}</span><button className="btn btn-ghost btn-sm" aria-label={`Remove ${t}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove</button></li>)}</ul>
      <form onSubmit={(e) => { e.preventDefault(); add(); }}><input value={v} onChange={(e) => setV(e.target.value)} placeholder={hint} maxLength={300} aria-label={`Add to ${label}`} /><button className="btn btn-sm" type="submit" disabled={!v.trim()}>Add</button></form>
    </section>
  );
}

/** Tracks one incident at a time: nothing is called a root cause without a supported hypothesis and evidence. */
export function IncidentTool({ onError, onChanged, seed }: { onError: (m: string) => void; onChanged: () => void; seed: { title: string; hypotheses: string[]; evidence: string[] } | null }) {
  const [list, setList] = useState<AppRecord[]>([]);
  const [sel, setSel] = useState<AppRecord | null>(null);
  const [data, setData] = useState<IncidentData>(emptyIncident());
  const [busy, setBusy] = useState(false);
  const timer = useRef<number>();

  const load = useCallback(() => api.recordList("incident").then(setList).catch((e) => onError(errorText(e))), [onError]);
  useEffect(() => void load(), [load]);

  const save = useCallback(async (r: AppRecord, d: IncidentData) => {
    try {
      const saved = await api.recordSave({ ...r, body: JSON.stringify(d) });
      setList((l) => [saved, ...l.filter((x) => x.id !== saved.id)]);
      onChanged();
    } catch (e) {
      onError(errorText(e));
    }
  }, [onError, onChanged]);

  const change = (nextData: IncidentData, nextRec: AppRecord = sel!) => {
    setData(nextData);
    setSel(nextRec);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(nextRec, nextData), 600);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const create = (title = "New incident", d: IncidentData = emptyIncident()) => {
    const r: AppRecord = { id: newId(), kind: "incident", title, body: "" };
    setSel(r);
    setData(d);
    void save(r, d);
  };
  const seeded = useRef<unknown>(null);
  useEffect(() => {
    if (seed && seeded.current !== seed) {
      seeded.current = seed;
      create(seed.title, { ...emptyIncident(), symptoms: [seed.title], hypotheses: seed.hypotheses.map((text) => ({ text, state: "hypothesis" as const })), evidence: [] });
    }
  }, [seed]); // eslint-disable-line react-hooks/exhaustive-deps

  const fromConversation = async () => {
    if (!sel) return;
    setBusy(true);
    try {
      const x = JSON.parse(await api.studioGenerate(crypto.randomUUID(), "incident_extract")) as Partial<Record<ListKey | "hypotheses", string[]>>;
      change(mergeExtracted(data, x));
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const allowed = rootCauseAllowed(data);
  return (
    <div className="inc">
      <aside className="inc-side">
        <button className="btn btn-primary btn-sm" onClick={() => create()}>New incident</button>
        <ul>{list.map((r) => <li key={r.id} className={sel?.id === r.id ? "active" : ""}><button onClick={() => { setSel(r); setData(parseIncident(r.body)); }}>{r.title}</button></li>)}</ul>
        {list.length === 0 && <p className="hint">No incidents yet.</p>}
      </aside>
      {sel ? (
        <div className="inc-main">
          <div className="inc-head">
            <input className="notes-title" value={sel.title} onChange={(e) => change(data, { ...sel, title: e.target.value })} aria-label="Incident title" maxLength={200} />
            <select value={data.status} onChange={(e) => change({ ...data, status: e.target.value as IncidentData["status"] })} aria-label="Status"><option value="open">Open</option><option value="monitoring">Monitoring</option><option value="resolved">Resolved</option></select>
            <button className="btn btn-sm" onClick={() => void fromConversation()} disabled={busy}>{busy ? "Reading…" : "Fill from the conversation"}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => void api.recordDelete(sel.id).then(() => { setSel(null); void load(); onChanged(); })}>Delete</button>
          </div>
          <section className="inc-list">
            <h3>Hypotheses</h3>
            <ul>{data.hypotheses.map((h, i) => (
              <li key={i}><span>{h.text}</span>
                <select value={h.state} aria-label={`State of ${h.text}`} onChange={(e) => change({ ...data, hypotheses: data.hypotheses.map((x, j) => (j === i ? { ...x, state: e.target.value as typeof h.state } : x)) })}>
                  <option value="hypothesis">Hypothesis</option><option value="supported">Supported by evidence</option><option value="ruled_out">Ruled out</option>
                </select>
                <button className="btn btn-ghost btn-sm" onClick={() => change({ ...data, hypotheses: data.hypotheses.filter((_, j) => j !== i) })}>Remove</button></li>
            ))}</ul>
            <HypothesisAdd onAdd={(t) => change({ ...data, hypotheses: [...data.hypotheses, { text: t, state: "hypothesis" }] })} />
          </section>
          {LISTS.map(([k, label, hint]) => <ListEditor key={k} label={label} hint={hint} items={data[k]} onChange={(l) => change({ ...data, [k]: l })} />)}
          <section className="inc-list">
            <h3>Confirmed root cause</h3>
            <textarea rows={2} value={data.root_cause} disabled={!allowed} onChange={(e) => change({ ...data, root_cause: e.target.value })} placeholder={allowed ? "State the root cause that the evidence supports" : "Locked until one hypothesis is marked supported and some evidence is recorded"} aria-label="Confirmed root cause" />
          </section>
        </div>
      ) : (
        <div className="notes-empty"><h3>Track an incident</h3><p>Record symptoms, hypotheses, evidence, actions and decisions in one place. A root cause can only be written once the evidence supports it.</p></div>
      )}
    </div>
  );
}

function HypothesisAdd({ onAdd }: { onAdd: (t: string) => void }) {
  const [v, setV] = useState("");
  return <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onAdd(v.trim()); setV(""); } }}><input value={v} onChange={(e) => setV(e.target.value)} placeholder="A possible cause" maxLength={300} aria-label="Add hypothesis" /><button className="btn btn-sm" type="submit" disabled={!v.trim()}>Add</button></form>;
}
