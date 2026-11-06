import { useCallback, useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { save } from "@tauri-apps/plugin-dialog";
import { api, errorText } from "../lib/api";
import type { DiagramRecord } from "../lib/architecture";
import { editPoint, emptyChart, isIllustrative, PALETTE, parseChart, parseTable, stats, toCsv, toRows, type ChartSpec, type ChartType } from "../lib/charts";
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
  const [make, setMake] = useState<"table" | "numbers" | "diagram">("table");
  const [paste, setPaste] = useState("");
  const [filter, setFilter] = useState<"all" | "chart" | "diagram" | "board">("all");
  const [find, setFind] = useState("");
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
  const fromTable = () => {
    const r = parseTable(paste);
    if ("error" in r) return onError(r.error);
    startWith(r.spec);
    setMsg("");
  };
  const downloadCsv = async () => {
    if (!spec) return;
    try {
      const path = await save({ defaultPath: `${(spec.title || "chart").replace(/[^\w\- ]+/g, "").trim() || "chart"}.csv`, filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (!path) return;
      await api.architectureWriteFile(path, toBase64(toCsv(spec)));
      setMsg(`Data saved to ${path}`);
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
  const q = find.trim().toLowerCase();
  const lib = [
    ...charts.map((c) => ({ id: c.id, kind: "chart" as const, title: c.title, at: c.updated_at ?? 0, sub: "Chart", go: () => { open(c); window.scrollTo?.({ top: 0 }); } })),
    ...diagrams.map((d) => ({ id: d.id, kind: "diagram" as const, title: d.title, at: d.created_at, sub: `Diagram · ${d.kind}`, go: onOpenDiagram })),
    ...boards.map((b) => ({ id: b.id, kind: "board" as const, title: b.title, at: b.updated_at ?? 0, sub: "Whiteboard", go: () => onOpenBoard(b.id) })),
  ].filter((x) => (filter === "all" || x.kind === filter) && (!q || x.title.toLowerCase().includes(q))).sort((x, y) => y.at - x.at);
  const MAKE: [typeof make, string, string][] = [["table", "Paste a table", "From Excel, Google Sheets or CSV"], ["numbers", "Numbers in a conversation", "Finds the figures that were said"], ["diagram", "Diagram from a session", "Meeting, interview or lecture"]];
  return (
    <div className="vis">
      <header><h1>Visuals &amp; Diagrams</h1><p className="hint">Turn numbers into charts and conversations into diagrams. Charts only use numbers you pasted or that were really said, and every number shows where it came from.</p></header>

      <section className="dash-card vis-create">
        <header><h2>Create</h2><button className="btn btn-sm" onClick={onToBoard}>New blank whiteboard</button></header>
        <div className="vis-tiles" role="tablist" aria-label="What to make">
          {MAKE.map(([id, l, d]) => <button key={id} role="tab" aria-selected={make === id} className={make === id ? "on" : ""} onClick={() => setMake(id)}><strong>{l}</strong><span>{d}</span></button>)}
        </div>
        {make === "table" && (
          <div className="vis-pane">
            <textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"Copy cells from a spreadsheet and paste them here. Labels in the first column, numbers after it.\n\nMonth\tRevenue\tCost\nJan\t1200\t800\nFeb\t1500\t900"} aria-label="Table to chart" />
            <div className="tc-actions"><button className="btn btn-primary" onClick={fromTable} disabled={paste.trim().length < 5}>Build chart</button><button className="btn" onClick={() => startWith({ ...emptyChart(), type })}>Start a blank chart</button><span className="hint">Instant, and the numbers are exactly what you pasted.</span></div>
          </div>
        )}
        {make === "numbers" && (
          <div className="vis-pane">
            <div className="vis-make">
              <select value={type} onChange={(e) => setType(e.target.value as ChartType)} aria-label="Chart type"><option value="bar">Bar</option><option value="line">Line or time series</option><option value="pie">Pie</option></select>
              <select value={source} onChange={(e) => setSource(e.target.value as typeof source)} aria-label="Numbers come from"><option value="conversation">Numbers from the current conversation</option><option value="text">Numbers from text I paste</option></select>
              <button className="btn btn-primary" onClick={() => void generate()} disabled={busy || (source === "text" && text.trim().length < 5)}>{busy ? "Reading the numbers…" : "Build chart"}</button>
            </div>
            {source === "text" && <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste text that contains the figures, for example: Revenue was 5,000 in March and 7,500 in April" aria-label="Text with figures" />}
          </div>
        )}
        {make === "diagram" && (
          <div className="vis-pane">
            <div className="vis-make">
              <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Session to draw">
                <option value="">Choose a session…</option>
                {hasLive && <option value="live">Current meeting or interview (live)</option>}
                {sessions.map((m) => <option key={m.id} value={m.id}>{m.title} · {new Date(m.started_at).toLocaleDateString()}</option>)}
              </select>
              <select value={vstyle} onChange={(e) => setVstyle(e.target.value)} aria-label="Diagram style">
                <option value="flowchart">Flowchart</option><option value="concept_map">Concept map</option><option value="decision_tree">Decision tree</option><option value="timeline">Timeline</option><option value="sequence">Sequence</option>
              </select>
              <button className="btn btn-primary" onClick={makeVisual} disabled={!from}>Generate on whiteboard</button>
            </div>
            <input value={extraNote} onChange={(e) => setExtraNote(e.target.value)} placeholder="Optional: what to focus on, for example the deployment steps" aria-label="Focus" maxLength={300} />
            <p className="hint">It opens on a new whiteboard where you can move, rename and add to it. For system diagrams use Technical Copilot → Architecture.</p>
          </div>
        )}
      </section>

      {spec && rec && (
        <section className="dash-card vis-chart">
          <header><h2>Your chart</h2><button className="btn btn-ghost btn-sm" onClick={() => { setRec(null); setSpec(null); setMsg(""); }}>Close</button></header>
          {isIllustrative(spec) && <p className="arch-illustrative" role="note"><strong>Illustrative.</strong> None of these numbers could be matched to your material. Edit them to your real data or discard the chart.</p>}
          <div className="vis-edit">
            <input value={spec.title} onChange={(e) => update({ ...spec, title: e.target.value })} aria-label="Chart title" maxLength={80} />
            <select value={spec.type} onChange={(e) => update({ ...spec, type: e.target.value as ChartType })} aria-label="Chart type"><option value="bar">Bar</option><option value="line">Line</option><option value="pie">Pie</option></select>
            <input value={spec.unit} onChange={(e) => update({ ...spec, unit: e.target.value })} placeholder="Unit" aria-label="Unit" maxLength={20} style={{ width: 90 }} />
            {spec.series.map((s, i) => <label key={i} className="check">{s.name} <input type="color" value={s.color ?? PALETTE[i % PALETTE.length]} onChange={(e) => update({ ...spec, series: spec.series.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })} aria-label={`Colour of ${s.name}`} /></label>)}
          </div>
          <div ref={box}><ChartView spec={spec} /></div>
          <details className="vis-data"><summary>Edit the numbers ({st?.total ?? 0})</summary>
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
            <div className="tc-actions"><button className="btn btn-sm" onClick={() => update({ ...spec, series: spec.series.map((x, j) => (j === 0 ? { ...x, points: [...x.points, { label: `Item ${x.points.length + 1}`, value: 0, quote: "", verified: false, edited: true }] } : x)) })}>Add a row</button></div>
          </details>
          <div className="tc-actions">
            <button className="btn btn-sm btn-primary" onClick={() => void exportAs("png")}>Download image (PNG)</button>
            <button className="btn btn-sm" onClick={() => void exportAs("svg")}>SVG</button>
            <button className="btn btn-sm" onClick={() => void downloadCsv()}>Data (CSV)</button>
            <button className="btn btn-sm btn-ghost" onClick={() => void api.recordDelete(rec.id).then(() => { setRec(null); setSpec(null); load(); onChanged(); })}>Delete</button>
            <span className="hint" role="status">{msg}{st ? ` · ${st.verified} of ${st.total} numbers from your material, ${st.edited} entered or edited by you` : ""}</span>
          </div>
        </section>
      )}

      <section className="dash-card">
        <header><h2>Your visuals</h2></header>
        <div className="vis-filter">
          <div className="seg" role="group" aria-label="Show">
            {([["all", "All"], ["chart", "Charts"], ["diagram", "Diagrams"], ["board", "Whiteboards"]] as const).map(([k, l]) => <button key={k} className={filter === k ? "active" : ""} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
          </div>
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search your visuals" aria-label="Search visuals" />
        </div>
        {lib.length === 0 ? <p className="hint">{charts.length + diagrams.length + boards.length === 0 ? "Nothing yet. Paste a table above to make your first chart." : "Nothing matches."}</p> : (
          <ul className="vis-lib">
            {lib.map((x) => (
              <li key={`${x.kind}-${x.id}`}>
                <button onClick={x.go}>
                  <span className={`vis-kind vk-${x.kind}`}>{x.kind === "chart" ? "Chart" : x.kind === "diagram" ? "Diagram" : "Board"}</span>
                  <strong>{x.title}</strong>
                  <span className="hint">{x.sub}{x.at ? ` · ${when(x.at)}` : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
