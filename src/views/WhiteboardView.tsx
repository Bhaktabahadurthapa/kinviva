import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { peekInbox, subscribeInbox } from "../lib/boardInbox";
import { CaptureUpdateAction, Excalidraw, convertToExcalidrawElements, exportToBlob, exportToSvg, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { esc, type DiagramRecord, type ArchModel } from "../lib/architecture";
import { api, errorText } from "../lib/api";
import { archToSpec, describeOps, nodesText, specToMermaid, toSkeleton, usableOps, type BoardNode, type BoardOp, type DiagramSpec } from "../lib/board";
import { chooseImagePath } from "../lib/download";
import { latestGuard } from "../lib/latest";
import { newId, type AppRecord } from "../lib/platform";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type El = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Api = any;
const guard = latestGuard();
const STYLES: [string, string][] = [["flowchart", "Flowchart"], ["concept_map", "Concept map"], ["decision_tree", "Decision tree"], ["timeline", "Timeline"], ["sequence", "Sequence of steps"]];
const toB64 = (buf: ArrayBuffer) => {
  let s = "";
  new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
};
const textB64 = (t: string) => toB64(new TextEncoder().encode(t).buffer as ArrayBuffer);

const live = (els: El[]) => els.filter((e) => !e.isDeleted);
function boardNodes(els: El[]): BoardNode[] {
  return live(els)
    .filter((e) => ["rectangle", "ellipse", "diamond"].includes(e.type))
    .map((e) => ({ id: e.id as string, label: (live(els).find((t) => t.type === "text" && t.containerId === e.id)?.text as string) ?? "" }))
    .filter((n) => n.label);
}
const bottomRight = (els: El[]) => live(els).reduce((m, e) => Math.max(m, e.x + (e.width ?? 0)), -200);

/** Editable whiteboard (Excalidraw) with AI diagram generation and previewed AI edits. */
export default function WhiteboardView({ onError, onChanged, initialBoard }: { onError: (m: string) => void; onChanged: () => void; initialBoard?: string | null }) {
  const [boards, setBoards] = useState<AppRecord[]>([]);
  const [cur, setCur] = useState<AppRecord | null>(null);
  const [initial, setInitial] = useState<object | null>(null);
  const [status, setStatus] = useState("");
  const [panel, setPanel] = useState<"" | "ai" | "versions">("ai");
  const [exportOpen, setExportOpen] = useState(false);
  const apiRef = useRef<Api>(null);
  const inbox = useSyncExternalStore(subscribeInbox, peekInbox);
  const handled = useRef(0);
  const timer = useRef<number>();
  const version = useRef(0);
  const dirty = useRef(false);

  const loadList = useCallback(() => api.recordList("board", undefined, null, false).then(setBoards).catch((e) => onError(errorText(e))), [onError]);
  useEffect(() => void loadList(), [loadList]);

  const serialize = (): string => {
    const a = apiRef.current;
    return serializeAsJSON(a.getSceneElements(), a.getAppState(), {}, "local");
  };
  const save = useCallback(async (rec: AppRecord) => {
    if (!apiRef.current) return;
    setStatus("Saving…");
    try {
      const saved = await api.recordSave({ ...rec, body: serialize() });
      dirty.current = false;
      setStatus("Saved");
      setBoards((l) => [{ ...saved, body: "" }, ...l.filter((x) => x.id !== saved.id)]);
      onChanged();
    } catch (e) {
      onError(errorText(e));
    }
  }, [onChanged, onError]);

  const open = async (id: string) => {
    if (cur && dirty.current) await save(cur);
    const rec = await api.recordGet(id);
    if (!rec) return;
    let scene: object = { elements: [] };
    try {
      scene = JSON.parse(rec.body || "{}");
    } catch {
      /* start empty */
    }
    apiRef.current = null;
    setInitial(scene);
    setCur({ ...rec, body: "" });
    setStatus("");
    setPanel("ai");
  };
  const create = async () => {
    const rec: AppRecord = { id: newId(), kind: "board", title: "Untitled board", body: JSON.stringify({ elements: [] }) };
    try {
      await api.recordSave(rec);
      await loadList();
      await open(rec.id);
    } catch (e) {
      onError(errorText(e));
    }
  };
  useEffect(() => {
    if (initialBoard) void open(initialBoard);
  }, [initialBoard]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Draw on Whiteboard" from another screen: make sure a board is open and preview a diagram of that text.
  useEffect(() => {
    if (!inbox || inbox.id === handled.current) return;
    if (!cur) {
      if (boards.length >= 0) void create();
      return;
    }
    handled.current = inbox.id;
    setPanel("ai");
  }, [inbox, cur]); // eslint-disable-line react-hooks/exhaustive-deps

  const onChange = (els: readonly El[]) => {
    if (!cur) return;
    const v = els.reduce((a, e) => a + (e.version ?? 0), els.length);
    if (v === version.current) return;
    version.current = v;
    dirty.current = true;
    setStatus("Unsaved changes");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(cur), 1500);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const snapshot = async (label: string) => {
    if (!cur || !apiRef.current) return;
    try {
      await api.boardSnapshot(cur.id, label, serialize());
    } catch (e) {
      onError(errorText(e));
    }
  };

  // ---- insert generated diagrams and apply edits (never replaces the whole board) -------------
  const insert = async (spec: DiagramSpec) => {
    const a = apiRef.current;
    if (!a) return;
    await snapshot(`Before adding “${spec.title}”`);
    const els = a.getSceneElements();
    const prefix = `ml${Date.now().toString(36)}`;
    const added = convertToExcalidrawElements(toSkeleton(spec, { x: bottomRight(els) + 120, y: 0 }, prefix) as never);
    a.updateScene({ elements: [...els, ...added], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    a.scrollToContent(added, { fitToViewport: true, viewportZoomFactor: 0.6, animate: true });
  };

  const applyOps = async (ops: BoardOp[]) => {
    const a = apiRef.current;
    if (!a) return;
    await snapshot("Before an AI edit");
    let els: El[] = a.getSceneElements();
    const created: Record<string, string> = {};
    let n = 0;
    const toAdd: Record<string, unknown>[] = [];
    const shapes = (id: string) => els.find((e) => e.id === id);
    const resolve = (id: string) => created[id] ?? id;
    for (const o of ops) {
      if (o.op === "add_node") {
        n += 1;
        const near = o.near ? shapes(resolve(o.near)) : null;
        const id = `ml-${Date.now().toString(36)}-${n}`;
        created[`new${n}`] = id;
        toAdd.push({ type: "rectangle", id, x: near ? near.x + 260 : bottomRight(els) + 80, y: near ? near.y + 100 * n : 0, width: 190, height: 72, backgroundColor: "#ece8ff", strokeColor: "#5b3fd6", strokeWidth: 2, roundness: { type: 3 }, label: { text: o.label, fontSize: 16 }, customData: { ml: { ai: true, node: id } } });
      } else if (o.op === "rename") {
        els = els.map((e) => (e.type === "text" && e.containerId === o.id ? { ...e, text: o.label, originalText: o.label, version: e.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31) } : e));
      } else if (o.op === "remove") {
        els = els.map((e) => (e.id === o.id || e.containerId === o.id || e.startBinding?.elementId === o.id || e.endBinding?.elementId === o.id ? { ...e, isDeleted: true, version: e.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31) } : e));
      } else if (o.op === "highlight") {
        els = els.map((e) => (e.id === o.id ? { ...e, strokeColor: "#d63b3b", backgroundColor: "#fde8e8", strokeWidth: 4, customData: { ...(e.customData ?? {}), ml: { ...(e.customData?.ml ?? { ai: true }), note: o.reason } }, version: e.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31) } : e));
      } else if (o.op === "connect") {
        toAdd.push({ type: "arrow", x: 0, y: 0, width: 1, height: 1, start: { id: resolve(o.from) }, end: { id: resolve(o.to) }, strokeColor: "#4b5262", ...(o.label ? { label: { text: o.label, fontSize: 14 } } : {}), customData: { ml: { ai: true } } });
      }
    }
    // Existing objects are passed along so new arrows can bind to them; only new ones are converted.
    const skeletonWithExisting = [...els.filter((e) => !e.isDeleted && !(e.type === "text" && e.containerId)), ...toAdd];
    const converted = toAdd.length ? convertToExcalidrawElements(skeletonWithExisting as never, { regenerateIds: false }) : [];
    const newOnes = converted.filter((c: El) => toAdd.some((t) => t.id === c.id) || c.containerId || (c.type === "arrow" && !els.some((e) => e.id === c.id)));
    const known = new Set(els.map((e) => e.id));
    a.updateScene({ elements: [...els, ...newOnes.filter((c: El) => !known.has(c.id))], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  };

  // ---- export ---------------------------------------------------------------------------------
  const exportAs = async (kind: "png" | "svg" | "excalidraw" | "mermaid") => {
    const a = apiRef.current;
    if (!a || !cur) return;
    try {
      const els = live(a.getSceneElements());
      if (kind === "mermaid") {
        const spec = elementsToSpec(a.getSceneElements());
        if (!spec) return onError("There is no connected diagram to turn into Mermaid yet.");
        await navigator.clipboard.writeText(specToMermaid(spec, esc));
        return setStatus("Mermaid source copied");
      }
      const stem = (cur.title || "board").replace(/[^\w\- ]+/g, "").trim() || "board";
      const path = kind === "excalidraw"
        ? await (await import("@tauri-apps/plugin-dialog")).save({ defaultPath: `${stem}.excalidraw`, filters: [{ name: "Excalidraw board", extensions: ["excalidraw"] }] })
        : await chooseImagePath(stem, kind);
      if (!path) return;
      let data: string;
      if (kind === "excalidraw") data = textB64(serialize());
      else if (kind === "svg") data = textB64((await exportToSvg({ elements: els, appState: { ...a.getAppState(), exportBackground: true }, files: null })).outerHTML);
      else data = toB64(await (await exportToBlob({ elements: els, appState: { ...a.getAppState(), exportBackground: true }, files: null, mimeType: "image/png" })).arrayBuffer());
      await api.architectureWriteFile(path, data);
      setStatus(`Exported to ${path}`);
    } catch (e) {
      onError(errorText(e));
    }
  };

  const restore = async (rev: AppRecord) => {
    const full = await api.recordGet(rev.id);
    if (!full || !apiRef.current) return;
    await snapshot("Before restoring a version");
    try {
      const scene = JSON.parse(full.body) as { elements: El[] };
      apiRef.current.updateScene({ elements: scene.elements, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      setPanel("");
    } catch (e) {
      onError(errorText(e));
    }
  };

  const rename = async (title: string) => {
    if (!cur) return;
    const next = { ...cur, title };
    setCur(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(next), 600);
  };

  return (
    <div className="wb">
      <aside className="wb-list">
        <button className="btn btn-primary btn-sm" onClick={() => void create()}>New whiteboard</button>
        <ul>{boards.map((b) => <li key={b.id} className={cur?.id === b.id ? "active" : ""}><button onClick={() => void open(b.id)}>{b.title}</button></li>)}</ul>
        {boards.length === 0 && <p className="hint">Create a board to draw, or generate a diagram from a conversation.</p>}
      </aside>
      <section className="wb-main">
        {cur && initial ? (
          <>
            <div className="wb-bar">
              <input className="notes-title" value={cur.title} onChange={(e) => void rename(e.target.value)} aria-label="Board name" maxLength={200} />
              <span className="hint" role="status">{status}</span>
              <button className="btn btn-primary btn-sm" onClick={() => setPanel(panel === "ai" ? "" : "ai")} aria-pressed={panel === "ai"}>{panel === "ai" ? "Hide AI panel" : "Generate or edit with AI"}</button>
              <button className="btn btn-sm" onClick={() => void snapshot("Saved version").then(() => setStatus("Version saved"))}>Save version</button>
              <button className="btn btn-sm" onClick={() => setPanel(panel === "versions" ? "" : "versions")} aria-pressed={panel === "versions"}>Versions</button>
              <div className="wb-export">
                <button className="btn btn-sm" aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen((o) => !o)}>Export ▾</button>
                {exportOpen && (
                  <div className="wb-menu" role="menu" onMouseLeave={() => setExportOpen(false)}>
                    {([["png", "PNG image"], ["svg", "SVG image"], ["excalidraw", "Editable board file (.excalidraw)"], ["mermaid", "Copy as Mermaid text"]] as const).map(([k, l]) => (
                      <button key={k} role="menuitem" onClick={() => { setExportOpen(false); void exportAs(k); }}>{l}</button>
                    ))}
                  </div>
                )}
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => void api.recordDelete(cur.id).then(() => { setCur(null); setInitial(null); void loadList(); onChanged(); })}>Delete board</button>
            </div>
            <div className="wb-stage">
              <div className="wb-canvas">
                <Excalidraw key={cur.id} initialData={initial as never} excalidrawAPI={(a: Api) => (apiRef.current = a)} onChange={onChange as never} />
              </div>
              {panel === "ai" && <AiPanel seed={inbox && inbox.id === handled.current ? inbox : null} getNodes={() => boardNodes(apiRef.current?.getSceneElements() ?? [])} onInsert={insert} onApply={applyOps} onError={onError} />}
              {panel === "versions" && <VersionsPanel boardId={cur.id} onRestore={restore} />}
            </div>
          </>
        ) : (
          <div className="notes-empty"><h3>Whiteboard</h3><p>Draw freely, or let MeetingLens turn a conversation, your notes or a saved architecture into an editable diagram. Your own drawings are never overwritten by AI changes.</p></div>
        )}
      </section>
    </div>
  );
}

/** A connected diagram on the board, rebuilt from tagged shapes and their arrows (used for Mermaid). */
function elementsToSpec(els: El[]): DiagramSpec | null {
  const nodes = boardNodes(els);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = live(els).filter((e) => e.type === "arrow" && ids.has(e.startBinding?.elementId) && ids.has(e.endBinding?.elementId)).map((e) => ({ from: e.startBinding.elementId as string, to: e.endBinding.elementId as string, label: (live(els).find((t) => t.type === "text" && t.containerId === e.id)?.text as string) ?? "" }));
  return nodes.length >= 2 && edges.length ? { title: "Board", kind: "flowchart", nodes, edges } : null;
}

function VersionsPanel({ boardId, onRestore }: { boardId: string; onRestore: (r: AppRecord) => void }) {
  const [list, setList] = useState<AppRecord[]>([]);
  useEffect(() => void api.boardRevisions(boardId).then(setList).catch(() => setList([])), [boardId]);
  return (
    <aside className="wb-panel">
      <h3>Versions</h3>
      {list.length === 0 ? <p className="hint">Versions are saved when you press Save version and before every AI change.</p> : (
        <ul>{list.map((r) => <li key={r.id}><span>{r.title}<br /><span className="hint">{new Date(r.updated_at ?? 0).toLocaleString()}</span></span><button className="btn btn-sm" onClick={() => onRestore(r)}>Restore</button></li>)}</ul>
      )}
    </aside>
  );
}

function AiPanel({ seed, getNodes, onInsert, onApply, onError }: { seed: { id: number; text: string } | null; getNodes: () => BoardNode[]; onInsert: (s: DiagramSpec) => Promise<void>; onApply: (o: BoardOp[]) => Promise<void>; onError: (m: string) => void }) {
  const [style, setStyle] = useState("flowchart");
  const [source, setSource] = useState<"conversation" | "note" | "prompt" | "diagram">("conversation");
  const [notes, setNotes] = useState<AppRecord[]>([]);
  const [diagrams, setDiagrams] = useState<DiagramRecord[]>([]);
  const [pick, setPick] = useState("");
  const [extra, setExtra] = useState("");
  const [spec, setSpec] = useState<DiagramSpec | null>(null);
  const [cmd, setCmd] = useState("");
  const [ops, setOps] = useState<BoardOp[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.recordList("note").then(setNotes).catch(() => {});
    api.architectureList(null).then(setDiagrams).catch(() => {});
  }, []);

  const seeded = useRef(0);
  useEffect(() => {
    if (seed && seeded.current !== seed.id) {
      seeded.current = seed.id;
      setSource("prompt");
      setStyle("concept_map");
      setExtra(seed.text);
      void generate({ source: "prompt", style: "concept_map", extra: seed.text });
    }
  }, [seed]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async (over?: { source: typeof source; style: string; extra: string }) => {
    const useSource = over?.source ?? source;
    const useStyle = over?.style ?? style;
    const useExtra = over?.extra ?? extra;
    const mine = guard.next();
    setBusy(true);
    setSpec(null);
    try {
      if (useSource === "diagram") {
        const d = diagrams.find((x) => x.id === pick);
        const m = d?.model ? (JSON.parse(d.model) as ArchModel) : null;
        if (!m) throw new Error("Pick a saved architecture diagram that was generated by MeetingLens.");
        return void setSpec(archToSpec(m));
      }
      const noteBody = useSource === "note" ? notes.find((n) => n.id === pick)?.body ?? "" : "";
      if (useSource === "note" && !noteBody) throw new Error("Pick a note first.");
      const input = `Style: ${useStyle}. ${useExtra}\n${noteBody}`.slice(0, 6000);
      const raw = await api.studioGenerate(crypto.randomUUID(), "board_diagram", input, null);
      if (guard.isCurrent(mine)) setSpec(JSON.parse(raw) as DiagramSpec);
    } catch (e) {
      onError(errorText(e));
    } finally {
      if (guard.isCurrent(mine)) setBusy(false);
    }
  };

  const plan = async () => {
    const nodes = getNodes();
    if (nodes.length === 0) return onError("Draw or generate a diagram first; edit commands change existing objects.");
    setBusy(true);
    setOps(null);
    try {
      const raw = JSON.parse(await api.studioGenerate(crypto.randomUUID(), "board_ops", nodesText(nodes, cmd.trim()))) as { ops: BoardOp[] };
      setOps(usableOps(raw.ops, nodes));
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const desc = ops ? describeOps(ops, getNodes()) : null;
  return (
    <aside className="wb-panel">
      <h3>Generate a diagram with AI</h3>
      <label className="tc-label" htmlFor="wb-src">From</label>
      <select id="wb-src" value={source} onChange={(e) => { setSource(e.target.value as typeof source); setPick(""); }}>
        <option value="conversation">The current conversation</option>
        <option value="note">One of my notes</option>
        <option value="prompt">My description only</option>
        <option value="diagram">A saved architecture diagram</option>
      </select>
      {source === "note" && <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Note"><option value="">Choose a note…</option>{notes.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}</select>}
      {source === "diagram" && <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Diagram"><option value="">Choose a diagram…</option>{diagrams.filter((d) => d.model).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select>}
      {source !== "diagram" && (
        <>
          <select value={style} onChange={(e) => setStyle(e.target.value)} aria-label="Diagram style">{STYLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <textarea rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Optional: what to focus on" aria-label="Extra wishes" maxLength={500} />
        </>
      )}
      <button className="btn btn-primary btn-sm" onClick={() => void generate()} disabled={busy}>{busy ? "Working…" : "Generate preview"}</button>
      {spec && (
        <div className="wb-preview">
          <strong>{spec.title}</strong>
          <span className="hint">{spec.nodes.length} objects, {spec.edges.length} connections. It is added beside your drawing; nothing existing changes.</span>
          <ul>{spec.nodes.slice(0, 8).map((n) => <li key={n.id}>{n.label}</li>)}</ul>
          {spec.references && spec.references.length > 0 && <span className="hint">From: “{spec.references[0]}”</span>}
          <div className="tc-actions"><button className="btn btn-primary btn-sm" onClick={() => void onInsert(spec).then(() => setSpec(null))}>Add to board</button><button className="btn btn-ghost btn-sm" onClick={() => setSpec(null)}>Discard</button></div>
        </div>
      )}
      <h3>Edit with words</h3>
      <textarea rows={2} value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="For example: add a cache between the API and the database, or highlight the single point of failure" aria-label="Edit request" maxLength={500} />
      <button className="btn btn-sm" onClick={() => void plan()} disabled={busy || cmd.trim().length < 4}>Preview the change</button>
      {desc && (
        <div className="wb-preview">
          <ul>{desc.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          {desc.problems.length > 0 && <span className="hint">Skipped: {desc.problems.join("; ")}</span>}
          {desc.lines.length > 0 && <div className="tc-actions"><button className="btn btn-primary btn-sm" onClick={() => void onApply(ops!).then(() => setOps(null))}>Apply</button><button className="btn btn-ghost btn-sm" onClick={() => setOps(null)}>Discard</button></div>}
        </div>
      )}
      <p className="hint">Handwriting: Apple Pencil works through Sidecar or a compatible iPad; a stylus or trackpad works directly.</p>
    </aside>
  );
}
