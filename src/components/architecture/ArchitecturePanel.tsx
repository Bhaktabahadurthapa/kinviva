import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText } from "../../lib/api";
import { checkSource, fileStem, shouldAutoGenerate, toMermaid, type ArchModel, type DiagramRecord } from "../../lib/architecture";
import { latestGuard } from "../../lib/latest";
import { chooseImagePath } from "../../lib/download";
import type { LiveState } from "../../lib/liveReducer";
import { svgForExport, svgToPngBase64, toBase64, type DiagramTheme } from "../../lib/mermaidRender";
import { ArchitectureExplanation } from "./ArchitectureExplanation";
import { DiagramEditor } from "./DiagramEditor";
import { DiagramHistory } from "./DiagramHistory";
import { DiagramToolbar } from "./DiagramToolbar";
import { MermaidRenderer, MAX_SCALE, MIN_SCALE, type View } from "./MermaidRenderer";

function useTheme(): DiagramTheme {
  const read = (): DiagramTheme => {
    const t = document.documentElement.dataset.theme;
    if (t === "dark" || t === "light") return t;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };
  const [theme, setTheme] = useState<DiagramTheme>(read);
  useEffect(() => {
    const update = () => setTheme(read());
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    mq?.addEventListener?.("change", update);
    return () => {
      mo.disconnect();
      mq?.removeEventListener?.("change", update);
    };
  }, []);
  return theme;
}

const parseModel = (json: string | null): ArchModel | null => {
  if (!json) return null;
  try {
    const m = JSON.parse(json) as ArchModel;
    return Array.isArray(m.components) && Array.isArray(m.relations) ? m : null;
  } catch {
    return null;
  }
};

/** Architecture diagrams from the conversation: generate, inspect, edit, export and keep. */
export function ArchitecturePanel({ live, onError }: { live: LiveState; onError: (m: string) => void }) {
  const theme = useTheme();
  const status = live.status;
  const running = status?.state === "running";
  const meetingId = status?.meeting_id ?? status?.context_meeting_id ?? null;
  const finals = live.transcript.finals;

  const [model, setModel] = useState<ArchModel | null>(null);
  const [source, setSource] = useState("");
  const [origin, setOrigin] = useState<"generated" | "edited">("generated");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [auto, setAuto] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [drawError, setDrawError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [fitSignal, setFitSignal] = useState(0);
  const [editing, setEditing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<DiagramRecord[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const guard = useRef(latestGuard()).current; // newest generation wins; older answers are ignored
  const requestId = useRef<string | null>(null);
  const seenFinals = useRef(0);
  const lastGeneratedAt = useRef(0);
  const lastActivity = useRef(Date.now());
  const lastSaved = useRef("");

  const refreshHistory = useCallback(() => api.architectureList(null).then(setHistory).catch(() => {}), []);
  useEffect(() => void refreshHistory(), [refreshHistory]);

  useEffect(() => {
    lastActivity.current = Date.now();
  }, [finals.length, live.transcript.partials]);

  const save = useCallback(
    async (m: ArchModel | null, src: string, how: "generated" | "edited", quiet = false) => {
      if (!src || lastSaved.current === src) return;
      const record: DiagramRecord = {
        id: crypto.randomUUID(),
        meeting_id: meetingId,
        created_at: Date.now(),
        title: m?.title || "Architecture",
        kind: checkSource(src).ok ? ((checkSource(src) as { kind: string }).kind ?? "flowchart") : "flowchart",
        source: src,
        model: m ? JSON.stringify(m) : null,
        origin: how,
      };
      try {
        await api.architectureSave(record);
        lastSaved.current = src;
        setActiveId(record.id);
        if (!quiet) setMessage("Saved to your session history.");
        void refreshHistory();
      } catch (e) {
        onError(errorText(e));
      }
    },
    [meetingId, onError, refreshHistory],
  );

  const generate = useCallback(
    async (auto = false) => {
      if (requestId.current) void api.aiCancel(requestId.current).catch(() => {});
      const mine = guard.next();
      const id = crypto.randomUUID();
      requestId.current = id;
      setGenerating(true);
      setNote(null);
      setMessage(null);
      lastGeneratedAt.current = Date.now();
      seenFinals.current = live.transcript.finals.length;
      try {
        const m = await api.architectureGenerate(id, hint.trim() || undefined);
        if (!guard.isCurrent(mine)) return; // a newer request replaced this one
        const src = toMermaid(m);
        const ok = checkSource(src);
        if (!ok.ok) throw new Error(ok.error);
        setModel(m);
        setSource(ok.source);
        setOrigin("generated");
        setEditing(false);
        void save(m, ok.source, "generated", true);
      } catch (e) {
        if (!guard.isCurrent(mine)) return;
        const text = errorText(e);
        if (text === "Cancelled.") return;
        // Automatic updates stay quiet when there is simply not enough to draw yet.
        if (auto || /not enough architecture detail/i.test(text)) setNote(text);
        else onError(text);
      } finally {
        if (guard.isCurrent(mine)) {
          setGenerating(false);
          requestId.current = null;
        }
      }
    },
    [hint, live.transcript.finals.length, onError, save],
  );

  // Live updates: finalized speech only, after a quiet moment, not more often than every 45 seconds.
  const generateRef = useRef(generate);
  generateRef.current = generate;
  useEffect(() => {
    if (!auto || !running) return;
    const timer = window.setInterval(() => {
      const newText = live.transcript.finals.slice(seenFinals.current).map((s) => s.text).join(" ");
      if (shouldAutoGenerate({ newText, lastGeneratedAt: lastGeneratedAt.current, lastActivityAt: lastActivity.current, now: Date.now(), generating })) {
        void generateRef.current(true);
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [auto, running, generating, live.transcript.finals]);

  useEffect(() => {
    if (!fullscreen) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setFullscreen(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [fullscreen]);

  const zoom = (factor: number) => setView((v) => ({ ...v, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor)) }));
  const background = theme === "dark" ? "#12161d" : "#ffffff";

  const exportImage = async (kind: "svg" | "png") => {
    if (!svg) return;
    try {
      const path = await chooseImagePath(fileStem(model?.title ?? "architecture"), kind);
      if (!path) return;
      const data = kind === "svg" ? toBase64(svgForExport(svg, background)) : await svgToPngBase64(svg, background);
      await api.architectureWriteFile(path, data);
      setMessage(`Saved ${kind.toUpperCase()} to ${path}`);
    } catch (e) {
      onError(errorText(e));
    }
  };

  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      onError("Could not copy. Select the text in Edit source instead.");
    }
  };

  const open = (d: DiagramRecord) => {
    const ok = checkSource(d.source);
    if (!ok.ok) return onError(`That saved diagram cannot be shown: ${ok.error}`);
    guard.invalidate(); // ignore any answer still on its way
    setGenerating(false);
    setModel(parseModel(d.model));
    setSource(ok.source);
    setOrigin(d.origin);
    setActiveId(d.id);
    lastSaved.current = ok.source;
    setEditing(false);
    setNote(null);
    setMessage(null);
  };

  const remove = async (d: DiagramRecord) => {
    try {
      await api.architectureDelete(d.id);
      if (d.id === activeId) setActiveId(null);
      void refreshHistory();
    } catch (e) {
      onError(errorText(e));
    }
  };

  const hasTranscript = finals.length > 0;
  const empty = !source;
  const generateLabel = generating ? "Generating…" : model || source ? "Regenerate" : "Generate from conversation";
  const evidence = useMemo(() => (model ? model.components.length : 0), [model]);

  return (
    <div className="arch">
      <header className="arch-head">
        <div>
          <h2>Architecture</h2>
          <p className="hint">Turns what people describe into a diagram. Dashed boxes and lines are suggestions, not facts.</p>
        </div>
        <div className="arch-actions">
          <input className="arch-hint" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="Optional: focus on CI/CD, networking, data flow…" aria-label="Hint for the diagram" maxLength={200} />
          <label className="check arch-auto" title="Refreshes after a quiet moment when the conversation is about architecture">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Update while we talk
          </label>
          <button className="btn btn-primary" onClick={() => void generate(false)} disabled={generating || !hasTranscript} title={hasTranscript ? undefined : "Start a meeting or open a saved session first"}>
            {generateLabel}
          </button>
          {generating && (
            <button className="btn btn-ghost" onClick={() => { guard.invalidate(); if (requestId.current) void api.aiCancel(requestId.current).catch(() => {}); setGenerating(false); }}>
              Cancel
            </button>
          )}
        </div>
      </header>

      {note && <p className="banner banner-info" role="status">{note}</p>}
      {message && <p className="banner banner-ok" role="status">{message}</p>}

      <div className="arch-body">
        <section className={`arch-viewer ${fullscreen ? "is-fullscreen" : ""}`} aria-label="Diagram">
          <DiagramToolbar
            view={view}
            disabled={!svg}
            fullscreen={fullscreen}
            onZoom={zoom}
            onFit={() => setFitSignal((n) => n + 1)}
            onFullscreen={() => { setFullscreen((f) => !f); setFitSignal((n) => n + 1); }}
            onCopy={() => void copySource()}
            onExport={(k) => void exportImage(k)}
            copied={copied}
          />
          <div className="mm-frame">
            {empty ? (
              <div className="arch-empty">
                <h3>No diagram yet</h3>
                <p>{hasTranscript ? "Press Generate from conversation. Kinviva reads the transcript so far and draws the system people described." : "Start a meeting or open a saved session in Sessions. Then come back and press Generate."}</p>
                <p className="hint">Works for Kubernetes, AWS and Azure setups, microservices, CI/CD pipelines, databases and incident flows.</p>
              </div>
            ) : (
              <MermaidRenderer source={source} theme={theme} view={view} onView={setView} fitSignal={fitSignal} onSvg={setSvg} onError={setDrawError} />
            )}
            {drawError && !empty && (
              <div className="banner banner-bad mm-error" role="alert">
                {drawError} <button className="btn btn-sm" onClick={() => setEditing(true)}>Edit source</button>
              </div>
            )}
          </div>
          <div className="arch-viewer-foot">
            <button className="btn btn-sm" onClick={() => setEditing((e) => !e)} disabled={empty}>{editing ? "Hide source" : "Edit source"}</button>
            <button className="btn btn-sm" onClick={() => void save(model, source, origin)} disabled={empty || lastSaved.current === source}>Save to history</button>
            <span className="hint">{origin === "edited" ? "Edited by you" : evidence ? `${evidence} components` : ""}</span>
          </div>
          {editing && (
            <DiagramEditor
              source={source}
              onClose={() => setEditing(false)}
              onApply={(s) => {
                setSource(s);
                setOrigin("edited");
                void save(model, s, "edited", true);
              }}
            />
          )}
        </section>

        <aside className="arch-side">
          {model ? <ArchitectureExplanation model={model} /> : <p className="hint">The explanation, evidence labels and concerns appear here after a diagram is generated.</p>}
          <h3>Saved diagrams</h3>
          <DiagramHistory items={history} activeId={activeId} onOpen={open} onDelete={(d) => void remove(d)} />
        </aside>
      </div>
    </div>
  );
}
