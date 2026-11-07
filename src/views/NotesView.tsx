import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NoteEditor } from "../components/NoteEditor";
import { api, errorText } from "../lib/api";
import { chooseSavePath } from "../lib/download";
import { toBase64 } from "../lib/mermaidRender";
import { checklistOf, htmlToMarkdown, htmlToText, metaOf, previewOf, tagsOf, toHtml, withMeta } from "../lib/noteDoc";
import { newId, type AppRecord } from "../lib/platform";

const DAY = 86_400_000;
const when = (ms?: number) => (ms ? new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");
const short = (ms?: number) => {
  if (!ms) return "";
  const d = new Date(ms);
  const t = new Date();
  return d.toDateString() === t.toDateString() ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
};
type Sort = "edited" | "created" | "title";
type Scope = { kind: "all" } | { kind: "folder"; name: string } | { kind: "tag"; name: string } | { kind: "trash" };
const FOLDERS_KEY = "ml.noteFolders";
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));
const loadW = (k: string, d: number, lo: number, hi: number) => {
  try { const v = Number(localStorage.getItem(k)); return v ? clamp(v, lo, hi) : d; } catch { return d; }
};

/** A thin handle: drag it to make the column on its left wider or narrower. Double-click to reset, arrow keys to nudge. */
function Handle({ label, value, min, max, reset, onChange }: { label: string; value: number; min: number; max: number; reset: number; onChange: (v: number) => void }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      className="nh"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      onPointerDown={(e) => { start.current = { x: e.clientX, w: value }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => { if (start.current) onChange(clamp(start.current.w + e.clientX - start.current.x, min, max)); }}
      onPointerUp={() => { start.current = null; }}
      onPointerCancel={() => { start.current = null; }}
      onDoubleClick={() => onChange(reset)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onChange(clamp(value - 16, min, max));
        else if (e.key === "ArrowRight") onChange(clamp(value + 16, min, max));
        else return;
        e.preventDefault();
      }}
    />
  );
}

/** All notes, in the style people know from a good notes app: folders, pinned notes, tags, rich text, a trash with restore. */
export function NotesView({ onError, refreshKey, onChanged }: { onError: (m: string) => void; refreshKey: number; onChanged: () => void }) {
  const [all, setAll] = useState<AppRecord[]>([]);
  const [scope, setScope] = useState<Scope>({ kind: "all" });
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem("ml.noteSort") as Sort) || "edited");
  const [view, setView] = useState<"list" | "gallery">(() => (localStorage.getItem("ml.noteView") === "gallery" ? "gallery" : "list"));
  const [sel, setSel] = useState<AppRecord | null>(null);
  const [state, setState] = useState<"saved" | "saving" | "">("");
  const [full, setFull] = useState(false);
  const [extraFolders, setExtraFolders] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? "[]") as string[]; } catch { return []; }
  });
  const [undo, setUndo] = useState<AppRecord | null>(null);
  const [fw, setFw] = useState(() => loadW("ml.noteFolderW", 200, 130, 340));
  const [lw, setLw] = useState(() => loadW("ml.noteListW", 300, 220, 560));
  const saveW = (k: string, v: number) => { try { localStorage.setItem(k, String(v)); } catch { /* not essential */ } };
  const timer = useRef<number>();
  const dirty = useRef(false);
  const selRef = useRef<AppRecord | null>(null);
  selRef.current = sel;

  useEffect(() => {
    if (!full) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [full]);

  const load = useCallback(() => api.recordList("note").then((l) => {
    setAll(l);
    // Notes in the trash for more than 30 days are erased.
    const old = l.filter((n) => { const d = metaOf(n).deleted_at; return d && Date.now() - d > 30 * DAY; });
    old.forEach((n) => void api.recordDelete(n.id).catch(() => {}));
    if (old.length) setAll((cur) => cur.filter((n) => !old.some((o) => o.id === n.id)));
  }).catch((e) => onError(errorText(e))), [onError]);
  useEffect(() => void load(), [load, refreshKey]);

  const persist = useCallback(async (n: AppRecord) => {
    setState("saving");
    try {
      const saved = await api.recordSave(n);
      dirty.current = false;
      setState("saved");
      setAll((l) => [saved, ...l.filter((x) => x.id !== saved.id)]);
      onChanged();
      return saved;
    } catch (e) {
      onError(errorText(e));
      return null;
    }
  }, [onError, onChanged]);
  const flush = () => {
    window.clearTimeout(timer.current);
    if (selRef.current && dirty.current) void persist(selRef.current);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const edit = (patch: Partial<AppRecord>) => {
    const cur = selRef.current;
    if (!cur) return;
    const next = { ...cur, ...patch };
    selRef.current = next;
    setSel(next);
    dirty.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void persist(next), 700);
  };
  const apply = async (n: AppRecord, patch: Partial<ReturnType<typeof metaOf>>) => {
    const next = withMeta(n, patch);
    if (sel?.id === n.id) { setSel(next); selRef.current = next; }
    await persist(next);
  };

  const folders = useMemo(() => {
    const set = new Set(extraFolders);
    all.forEach((n) => { const m = metaOf(n); if (m.folder && !m.deleted_at) set.add(m.folder); });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [all, extraFolders]);
  const live = useMemo(() => all.filter((n) => !metaOf(n).deleted_at), [all]);
  const trashed = useMemo(() => all.filter((n) => metaOf(n).deleted_at), [all]);
  const tags = useMemo(() => {
    const c = new Map<string, number>();
    live.forEach((n) => tagsOf(`${n.title} ${htmlToText(n.body)}`).forEach((t) => c.set(t, (c.get(t) ?? 0) + 1)));
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [live]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = scope.kind === "trash" ? trashed : scope.kind === "folder" ? live.filter((n) => metaOf(n).folder === scope.name) : scope.kind === "tag" ? live.filter((n) => tagsOf(`${n.title} ${htmlToText(n.body)}`).includes(scope.name)) : live;
    const items = base.map((n) => ({ n, text: htmlToText(n.body) })).filter(({ n, text }) => !q || n.title.toLowerCase().includes(q) || text.toLowerCase().includes(q));
    const cmp = (a: AppRecord, b: AppRecord) => (sort === "title" ? a.title.localeCompare(b.title) : sort === "created" ? (b.created_at ?? 0) - (a.created_at ?? 0) : (b.updated_at ?? 0) - (a.updated_at ?? 0));
    return items.sort((a, b) => cmp(a.n, b.n));
  }, [live, trashed, scope, search, sort]);
  const pinned = scope.kind === "trash" ? [] : shown.filter(({ n }) => metaOf(n).pinned);
  const rest = scope.kind === "trash" ? shown : shown.filter(({ n }) => !metaOf(n).pinned);

  const open = (n: AppRecord) => { flush(); setSel(n); setState(""); };
  const create = async () => {
    flush();
    const base: AppRecord = { id: newId(), kind: "note", title: "New note", body: "" };
    const n = scope.kind === "folder" ? withMeta(base, { folder: scope.name }) : base;
    setSel(n);
    setState("");
    if (scope.kind === "trash") setScope({ kind: "all" });
    await persist(n);
  };
  const trash = async (n: AppRecord) => {
    await apply(n, { deleted_at: Date.now() });
    if (sel?.id === n.id) setSel(null);
    setUndo(n);
  };
  const restore = async (n: AppRecord) => { await apply(n, { deleted_at: undefined }); if (sel?.id === n.id) setSel(null); setUndo(null); };
  const erase = async (n: AppRecord) => {
    if (!window.confirm(`Delete “${n.title || "Untitled"}” permanently? This cannot be undone.`)) return;
    try { await api.recordDelete(n.id); setAll((l) => l.filter((x) => x.id !== n.id)); if (sel?.id === n.id) setSel(null); onChanged(); } catch (e) { onError(errorText(e)); }
  };
  const emptyTrash = async () => {
    if (!window.confirm(`Delete ${trashed.length} note${trashed.length === 1 ? "" : "s"} in Recently Deleted permanently?`)) return;
    try { await Promise.all(trashed.map((n) => api.recordDelete(n.id))); setAll((l) => l.filter((n) => !metaOf(n).deleted_at)); setSel(null); onChanged(); } catch (e) { onError(errorText(e)); }
  };
  const duplicate = async (n: AppRecord) => {
    const copy = await persist({ ...withMeta({ ...n, id: newId(), title: `${n.title} copy` }, { pinned: false }), created_at: undefined, updated_at: undefined });
    if (copy) open(copy);
  };
  const addFolder = () => {
    const name = window.prompt("Name of the new folder")?.trim().slice(0, 40);
    if (!name) return;
    if (folders.some((f) => f.toLowerCase() === name.toLowerCase())) return onError(`There is already a folder named “${name}”.`);
    const next = [...extraFolders, name];
    setExtraFolders(next);
    try { localStorage.setItem(FOLDERS_KEY, JSON.stringify(next)); } catch { /* not essential */ }
    setScope({ kind: "folder", name });
  };
  const removeFolder = async (name: string) => {
    if (!window.confirm(`Delete the folder “${name}”? Its notes stay in All Notes.`)) return;
    const next = extraFolders.filter((f) => f !== name);
    setExtraFolders(next);
    try { localStorage.setItem(FOLDERS_KEY, JSON.stringify(next)); } catch { /* not essential */ }
    await Promise.all(all.filter((n) => metaOf(n).folder === name).map((n) => persist(withMeta(n, { folder: undefined }))));
    setScope({ kind: "all" });
  };
  const exportMd = async (n: AppRecord) => {
    try {
      const path = await chooseSavePath((n.title || "note").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "note", "md");
      if (!path) return;
      await api.architectureWriteFile(path, toBase64(htmlToMarkdown(n.title || "Note", n.body)));
    } catch (e) { onError(errorText(e)); }
  };
  const copyText = async (n: AppRecord) => { try { await navigator.clipboard.writeText(`${n.title}\n\n${htmlToText(n.body)}`); } catch { onError("Could not copy to the clipboard."); } };

  const text = sel ? htmlToText(sel.body) : "";
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const selMeta = sel ? metaOf(sel) : {};
  const inTrash = scope.kind === "trash";

  const item = ({ n, text: t }: { n: AppRecord; text: string }) => {
    const m = metaOf(n);
    const chk = checklistOf(n.body);
    return (
      <li key={n.id} className={`${sel?.id === n.id ? "active" : ""} ${view === "gallery" ? "card" : ""}`}>
        <button onClick={() => open(n)}>
          <strong>{m.pinned && <i className="pin" title="Pinned">●</i>}{n.title || "Untitled"}</strong>
          <span className="np-prev">{previewOf(t, n.title) || "No additional text"}</span>
          <span className="np-meta">{short(n.updated_at)}{m.folder ? ` · ${m.folder}` : ""}{chk.total ? ` · ${chk.done}/${chk.total} done` : ""}</span>
        </button>
      </li>
    );
  };

  return (
    <div className={`notes2 ${full ? "notes-full" : ""}`} style={{ ["--nf" as string]: `${fw}px`, ["--nl" as string]: `${lw}px` }}>
      <nav className="nf" aria-label="Folders">
        <button className={scope.kind === "all" ? "on" : ""} onClick={() => setScope({ kind: "all" })}>All Notes <em>{live.length}</em></button>
        <h4>Folders <button className="nf-add" title="New folder" aria-label="New folder" onClick={addFolder}>+</button></h4>
        {folders.length === 0 && <p className="hint">No folders yet.</p>}
        {folders.map((f) => (
          <div key={f} className="nf-row">
            <button className={scope.kind === "folder" && scope.name === f ? "on" : ""} onClick={() => setScope({ kind: "folder", name: f })}>{f} <em>{live.filter((n) => metaOf(n).folder === f).length}</em></button>
            {scope.kind === "folder" && scope.name === f && <button className="nf-x" title="Delete folder" aria-label={`Delete folder ${f}`} onClick={() => void removeFolder(f)}>✕</button>}
          </div>
        ))}
        {tags.length > 0 && <h4>Tags</h4>}
        <div className="nf-tags">
          {tags.slice(0, 20).map(([t, c]) => <button key={t} className={scope.kind === "tag" && scope.name === t ? "on" : ""} onClick={() => setScope({ kind: "tag", name: t })}>#{t} <em>{c}</em></button>)}
        </div>
        <button className={`nf-trash ${inTrash ? "on" : ""}`} onClick={() => setScope({ kind: "trash" })}>Recently Deleted <em>{trashed.length}</em></button>
      </nav>

      <Handle label="Resize the folders column" value={fw} min={130} max={340} reset={200} onChange={(v) => { setFw(v); saveW("ml.noteFolderW", v); }} />
      <aside className="notes-list2">
        <div className="nl-head">
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search notes" aria-label="Search notes" />
          <button className="btn btn-primary btn-sm" onClick={() => void create()}>New note</button>
        </div>
        <div className="nl-tools">
          <label>Sort <select value={sort} onChange={(e) => { setSort(e.target.value as Sort); try { localStorage.setItem("ml.noteSort", e.target.value); } catch { /* not essential */ } }} aria-label="Sort notes"><option value="edited">Date edited</option><option value="created">Date created</option><option value="title">Title</option></select></label>
          <span className="seg" role="group" aria-label="View">
            <button className={view === "list" ? "active" : ""} aria-pressed={view === "list"} onClick={() => { setView("list"); try { localStorage.setItem("ml.noteView", "list"); } catch { /* not essential */ } }}>List</button>
            <button className={view === "gallery" ? "active" : ""} aria-pressed={view === "gallery"} onClick={() => { setView("gallery"); try { localStorage.setItem("ml.noteView", "gallery"); } catch { /* not essential */ } }}>Gallery</button>
          </span>
        </div>
        {inTrash && trashed.length > 0 && <div className="nl-trash"><span className="hint">Notes here are erased after 30 days.</span><button className="btn btn-sm btn-danger" onClick={() => void emptyTrash()}>Empty</button></div>}
        {shown.length === 0 && <p className="hint">{search ? "No notes match." : inTrash ? "Nothing in Recently Deleted." : "No notes here yet. Press New note, or Save to notes under any answer."}</p>}
        {pinned.length > 0 && <h5>Pinned</h5>}
        {pinned.length > 0 && <ul className={view}>{pinned.map(item)}</ul>}
        {rest.length > 0 && pinned.length > 0 && <h5>Notes</h5>}
        {rest.length > 0 && <ul className={view}>{rest.map(item)}</ul>}
        {undo && !inTrash && <div className="undo-toast" role="status">Moved to Recently Deleted.<button className="btn btn-sm" onClick={() => void restore(undo)}>Undo</button><button className="btn btn-ghost btn-sm" aria-label="Dismiss" onClick={() => setUndo(null)}>✕</button></div>}
      </aside>

      <Handle label="Resize the notes list" value={lw} min={220} max={560} reset={300} onChange={(v) => { setLw(v); saveW("ml.noteListW", v); }} />
      <section className="notes-editor2">
        {sel ? (
          <>
            <div className="ne-head">
              <input className="notes-title" value={sel.title} onChange={(e) => edit({ title: e.target.value })} onBlur={flush} aria-label="Note title" maxLength={200} disabled={inTrash} />
              <span className="hint" role="status">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : ""}</span>
            </div>
            <div className="ne-actions">
              {!inTrash && <button className={`btn btn-sm ${selMeta.pinned ? "btn-primary" : ""}`} aria-pressed={!!selMeta.pinned} onClick={() => void apply(sel, { pinned: !selMeta.pinned })}>{selMeta.pinned ? "Pinned" : "Pin"}</button>}
              {!inTrash && (
                <label className="ne-move">Folder
                  <select value={selMeta.folder ?? ""} onChange={(e) => void apply(sel, { folder: e.target.value || undefined })} aria-label="Move to folder">
                    <option value="">None</option>
                    {folders.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
              )}
              {!inTrash && <button className="btn btn-sm" onClick={() => void duplicate(sel)}>Duplicate</button>}
              <button className="btn btn-sm" onClick={() => void copyText(sel)}>Copy text</button>
              <button className="btn btn-sm" onClick={() => void exportMd(sel)}>Download</button>
              <button className="btn btn-sm" onClick={() => setFull((f) => !f)} aria-pressed={full} title={full ? "Back to the app (Esc)" : "Full screen: hides the menu so you can write"}>{full ? "Exit full screen" : "Full screen"}</button>
              {inTrash ? (
                <>
                  <button className="btn btn-sm btn-primary" onClick={() => void restore(sel)}>Restore</button>
                  <button className="btn btn-sm btn-danger" onClick={() => void erase(sel)}>Delete permanently</button>
                </>
              ) : <button className="btn btn-sm btn-ghost" onClick={() => void trash(sel)}>Delete</button>}
            </div>
            {inTrash ? (
              <div className="ne-readonly"><div className="ne-doc" dangerouslySetInnerHTML={{ __html: toHtml(sel.body) }} /></div>
            ) : (
              <NoteEditor key={sel.id} noteId={sel.id} html={toHtml(sel.body)} onChange={(h) => edit({ body: h })} onError={onError} />
            )}
            <div className="ne-foot">
              <span>{words} word{words === 1 ? "" : "s"}</span>
              <span>Edited {when(sel.updated_at)}</span>
              <span>Created {when(sel.created_at)}</span>
              {sel.meeting_id && <span>Linked to a session</span>}
              {tagsOf(`${sel.title} ${text}`).map((t) => <button key={t} className="ne-tag" onClick={() => setScope({ kind: "tag", name: t })}>#{t}</button>)}
            </div>
          </>
        ) : (
          <div className="notes-empty"><h3>Select or create a note</h3><p>Notes stay on this computer. Add #tags anywhere in a note to group them.</p></div>
        )}
      </section>
    </div>
  );
}
