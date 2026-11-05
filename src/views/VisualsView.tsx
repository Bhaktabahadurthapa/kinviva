import { useCallback, useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, errorText } from "../lib/api";
import type { DiagramRecord } from "../lib/architecture";
import { editPoint, emptyChart, isIllustrative, PALETTE, parseChart, stats, toRows, type ChartSpec, type ChartType } from "../lib/charts";
import { chooseImagePath } from "../lib/download";
import { svgForExport, svgToPngBase64, toBase64 } from "../lib/mermaidRender";
import { sendToBoard } from "../lib/boardInbox";
import { newId, type AppRecord } from "../lib/platform";
import type { MeetingSummary } from "../lib/types";

const when = (ms?: number) => (ms ? new Date(ms).toLocaleDateString([], { dateStyle: "medium" }) : "");

function ChartView({ spec }: { spec: ChartSpec }) {
  const rows = toRows(spec);
  const color = (i: number) => spec.series[i]?.color ?? PALETTE[i % PALETTE.length];
  const unit = spec.unit ? ` ${spec.unit}` : "";
  return (
    <ResponsiveContainer width="100%" height={340}>
      {spec.type === "pie" ? (
        <PieChart>
          <Pie data={spec.series[0]?.points ?? []} dataKey="value" nameKey="label" outerRadius={120} label isAnimationActive={false}>
            {(spec.series[0]?.points ?? []).map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip formatter={(v) => `${v}${unit}`} /><Legend />
        </PieChart>
      ) : spec.type === "line" ? (
        <LineChart data={rows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis unit={spec.unit ? ` ${spec.unit}` : ""} /><Tooltip /><Legend />
          {spec.series.map((s, i) => <Line key={s.name} type="monotone" dataKey={s.name} stroke={color(i)} strokeWidth={2} isAnimationActive={false} />)}</LineChart>
      ) : (
        <BarChart data={rows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis unit={spec.unit ? ` ${spec.unit}` : ""} /><Tooltip /><Legend />
          {spec.series.map((s, i) => <Bar key={s.name} dataKey={s.name} fill={color(i)} isAnimationActive={false} />)}</BarChart>
      )}
    </ResponsiveContainer>
  );
}

/** Diagrams, whiteboards and charts in one place. Charts only use numbers from your material or that you typed. */
export default function VisualsView({ onError, onChanged, onOpenBoard, onOpenDiagram, hasLive, onToBoard }: { onError: (m: string) => void; onChanged: () => void; onOpenBoard: (id: string) => void; onOpenDiagram: () => void; hasLive: boolean; onToBoard: () => void }) {
  const [sessions, setSessions] = useState<MeetingSummary[]>([]);
  const [from, setFrom] = useState<string>(hasLive ? "live" : "");
  const [vstyle, setVstyle] = useState("flowchart");
  useEffect(() => {
    api.listMeetings().then((l) => setSessions(l.filter((m) => m.segment_count > 0))).catch(() => {});
  }, []);
  const makeVisual = () => {
    const saved = sessions.find((m) => m.id === from);
    sendToBoard(extraNote, { meetingId: from === "live" ? null : from, style: vstyle, title: saved ? `${saved.title} diagram` : "Current conversation diagram", auto: true });
    onToBoard();
  };
  const [extraNote, setExtraNote] = useState("");
  const [diagrams, setDiagrams] = useState<DiagramRecord[]>([]);
  const [boards, setBoards] = useState<AppRecord[]>([]);
  const [charts, setCharts] = useState<AppRecord[]>([]);
  const [rec, setRec] = useState<AppRecord | null>(null);
  const [spec, setSpec] = useState<ChartSpec | null>(null);
  const [source, setSource] = useState<"conversation" | "text">("conversation");
  const [text, setText] = useState("");
  const [type, setType] = useState<ChartType>("bar");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<number>();

  const load = useCallback(() => {
    api.architectureList(null).then(setDiagrams).catch(() => {});
    api.recordList("board", undefined, null, false).then(setBoards).catch(() => {});
    api.recordList("chart").then(setCharts).catch((e) => onError(errorText(e)));
  }, [onError]);
  useEffect(() => load(), [load]);

  const persist = useCallback(async (r: AppRecord, s: ChartSpec) => {
    try {
      const saved = await api.recordSave({ ...r, title: s.title, body: JSON.stringify(s) });
      setCharts((l) => [saved, ...l.filter((x) => x.id !== saved.id)]);
      setMsg("Saved");
      onChanged();
    } catch (e) {
      onError(errorText(e));
    }
  }, [onChanged, onError]);
  const update = (next: ChartSpec, r = rec!) => {
    setSpec(next);
    setMsg("Saving…");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void persist(r, next), 700);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const startWith = (s: ChartSpec) => {
    const r: AppRecord = { id: newId(), kind: "chart", title: s.title, body: JSON.stringify(s) };
    setRec(r);
    setSpec(s);
    void persist(r, s);
  };
  const generate = async () => {
    setBusy(true);
    try {
      const raw = await api.studioGenerate(crypto.randomUUID(), "chart", `Chart type: ${type}.\n${source === "text" ? text : ""}`, null);
      startWith(JSON.parse(raw) as ChartSpec);
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const svgEl = () => box.current?.querySelector("svg.recharts-surface") as SVGElement | null;
  const exportAs = async (kind: "svg" | "png") => {
    const el = svgEl();
    if (!el || !spec) return;
    try {
      const path = await chooseImagePath((spec.title || "chart").replace(/[^\w\- ]+/g, "").trim() || "chart", kind);
      if (!path) return;
      const raw = new XMLSerializer().serializeToString(el);
      const data = kind === "svg" ? toBase64(svgForExport(raw, "#ffffff")) : await svgToPngBase64(raw, "#ffffff");
      await api.architectureWriteFile(path, data);
      setMsg(`Exported to ${path}`);
    } catch (e) {
      onError(errorText(e));
    }
  };
  const open = (r: AppRecord) => {
    const s = parseChart(r.body);
    if (!s) return onError("That chart could not be read.");
    setRec(r);
    setSpec(s);
    setMsg("");
  };

  const st = spec ? stats(spec) : null;
  return (
    <div className="vis">
      <header><h1>Visuals &amp; Diagrams</h1><p className="hint">Everything you drew or generated: architecture diagrams, whiteboards and charts.</p></header>
      <div className="vis-grid">
        <section className="dash-card"><header><h2>Architecture diagrams</h2><button className="btn btn-ghost btn-sm" onClick={onOpenDiagram}>Open Architecture</button></header>
          {diagrams.length === 0 ? <p className="hint">None yet. Generate one in Technical Copilot → Architecture.</p> : <ul className="dash-list">{diagrams.slice(0, 6).map((d) => <li key={d.id}><div className="dash-list-main"><strong>{d.title}</strong><span>{when(d.created_at)} · {d.kind}</span></div></li>)}</ul>}
        </section>
        <section className="dash-card"><header><h2>Whiteboards</h2></header>
          {boards.length === 0 ? <p className="hint">None yet. Create one in Whiteboard.</p> : <ul className="dash-list">{boards.slice(0, 6).map((b) => <li key={b.id}><div className="dash-list-main"><strong>{b.title}</strong><span>{when(b.updated_at)}</span></div><button className="btn btn-sm" onClick={() => onOpenBoard(b.id)}>Open</button></li>)}</ul>}
        </section>
      </div>

      <section className="dash-card">
        <header><h2>Draw a session on the whiteboard</h2></header>
        <p className="hint">Turn a meeting, interview or lecture into an editable diagram. It opens on a new whiteboard, where you can move, rename and add to it.</p>
        <div className="vis-make">
          <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Session to draw">
            <option value="">Choose a session…</option>
            {hasLive && <option value="live">Current meeting or interview (live)</option>}
            {sessions.map((m) => <option key={m.id} value={m.id}>{m.title} · {new Date(m.started_at).toLocaleDateString()}</option>)}
          </select>
          <select value={vstyle} onChange={(e) => setVstyle(e.target.value)} aria-label="Diagram style">
            <option value="flowchart">Flowchart</option><option value="concept_map">Concept map</option><option value="decision_tree">Decision tree</option><option value="timeline">Timeline</option><option value="sequence">Sequence of steps</option>
          </select>
          <button className="btn btn-primary" onClick={makeVisual} disabled={!from}>Generate on whiteboard</button>
        </div>
        <input value={extraNote} onChange={(e) => setExtraNote(e.target.value)} placeholder="Optional: what to focus on, for example the deployment steps" aria-label="Focus" maxLength={300} />
      </section>

      <section className="dash-card">
        <header><h2>Charts</h2></header>
        <div className="vis-make">
          <select value={type} onChange={(e) => setType(e.target.value as ChartType)} aria-label="Chart type"><option value="bar">Bar</option><option value="line">Line or time series</option><option value="pie">Pie</option></select>
          <select value={source} onChange={(e) => setSource(e.target.value as typeof source)} aria-label="Numbers come from"><option value="conversation">Numbers from the current conversation</option><option value="text">Numbers from text I paste</option></select>
          <button className="btn btn-primary" onClick={() => void generate()} disabled={busy || (source === "text" && text.trim().length < 5)}>{busy ? "Reading the numbers…" : "Build chart"}</button>
          <button className="btn" onClick={() => startWith({ ...emptyChart(), type })}>Start a blank chart</button>
        </div>
        {source === "text" && <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste text that contains the figures, for example: Revenue was 5,000 in March and 7,500 in April." aria-label="Text with numbers" maxLength={6000} />}
        {charts.length > 0 && <div className="seg" role="group" aria-label="Saved charts">{charts.slice(0, 6).map((c) => <button key={c.id} className={rec?.id === c.id ? "active" : ""} onClick={() => open(c)}>{c.title}</button>)}</div>}
        {spec && rec && (
          <div className="vis-chart">
            {isIllustrative(spec) && <p className="arch-illustrative" role="note"><strong>Illustrative.</strong> None of these numbers could be matched to your material. Edit them to your real data or discard this chart.</p>}
            <div className="vis-edit">
              <input value={spec.title} onChange={(e) => update({ ...spec, title: e.target.value })} aria-label="Chart title" maxLength={80} />
              <select value={spec.type} onChange={(e) => update({ ...spec, type: e.target.value as ChartType })} aria-label="Chart type"><option value="bar">Bar</option><option value="line">Line</option><option value="pie">Pie</option></select>
              <input value={spec.unit} onChange={(e) => update({ ...spec, unit: e.target.value })} placeholder="Unit" aria-label="Unit" maxLength={20} style={{ width: 90 }} />
              {spec.series.map((s, i) => <label key={i} className="check">{s.name} <input type="color" value={s.color ?? PALETTE[i % PALETTE.length]} onChange={(e) => update({ ...spec, series: spec.series.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })} aria-label={`Colour of ${s.name}`} /></label>)}
            </div>
            <div ref={box}><ChartView spec={spec} /></div>
            <table className="vis-table">
              <thead><tr><th>Series</th><th>Label</th><th>Value{spec.unit ? ` (${spec.unit})` : ""}</th><th>Source</th><th /></tr></thead>
              <tbody>
                {spec.series.flatMap((s, si) => s.points.map((p, pi) => (
                  <tr key={`${si}-${pi}`}>
                    <td>{s.name}</td>
                    <td><input value={p.label} onChange={(e) => update(editPoint(spec, si, pi, { label: e.target.value }))} aria-label="Label" maxLength={40} /></td>
                    <td><input type="number" value={p.value} onChange={(e) => update(editPoint(spec, si, pi, { value: Number(e.target.value) || 0 }))} aria-label="Value" /></td>
                    <td className="hint">{p.edited ? "Entered or edited by you" : p.verified ? `From your material${p.quote ? `: “${p.quote}”` : ""}` : "Not found in your material"}</td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => update({ ...spec, series: spec.series.map((x, j) => (j === si ? { ...x, points: x.points.filter((_, k) => k !== pi) } : x)) })} aria-label="Remove row">Remove</button></td>
                  </tr>
                )))}
              </tbody>
            </table>
            <div className="tc-actions">
              <button className="btn btn-sm" onClick={() => update({ ...spec, series: spec.series.map((x, j) => (j === 0 ? { ...x, points: [...x.points, { label: `Item ${x.points.length + 1}`, value: 0, quote: "", verified: false, edited: true }] } : x)) })}>Add a row</button>
              <button className="btn btn-sm btn-ghost" onClick={() => void exportAs("png")}>PNG</button>
              <button className="btn btn-sm btn-ghost" onClick={() => void exportAs("svg")}>SVG</button>
              <button className="btn btn-sm btn-ghost" onClick={() => void api.recordDelete(rec.id).then(() => { setRec(null); setSpec(null); load(); onChanged(); })}>Delete</button>
              <span className="hint" role="status">{msg}{st ? ` · ${st.verified} of ${st.total} numbers from your material, ${st.edited} edited by you` : ""}</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
