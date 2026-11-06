import { useMemo, useState } from "react";
import { api, errorText } from "../lib/api";
import { chooseSavePath } from "../lib/download";
import { toBase64 } from "../lib/mermaidRender";
import { saveToNotes } from "../lib/notes";
import { forModel, parseInsights, parseScript, scriptMarkdown, type ScriptInsights } from "../lib/script";

/** The complete script of a video, to read instead of watching: every line, with the important ones highlighted. */
export function ScriptReader({ onError, onSaved }: { onError: (m: string) => void; onSaved?: () => void }) {
  const [raw, setRaw] = useState("");
  const [title, setTitle] = useState("Video script");
  const [lines, setLines] = useState(() => parseScript(""));
  const [ins, setIns] = useState<ScriptInsights | null>(null);
  const [busy, setBusy] = useState(false);
  const [find, setFind] = useState("");
  const [onlyKey, setOnlyKey] = useState(false);
  const [note, setNote] = useState("");

  const make = () => {
    setIns(null);
    setNote("");
    setLines(parseScript(raw));
  };
  const analyse = async () => {
    setBusy(true);
    try {
      setIns(parseInsights(await api.studioGenerate(crypto.randomUUID(), "script_highlights", forModel(lines))));
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const imp = useMemo(() => new Set(ins?.important ?? []), [ins]);
  const chap = useMemo(() => new Map((ins?.chapters ?? []).map((c) => [c.line, c.title])), [ins]);
  const q = find.trim().toLowerCase();
  const shown = lines.filter((l) => (!q || l.text.toLowerCase().includes(q)) && (!onlyKey || imp.has(l.n)));
  const words = lines.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
  const jump = (n: number) => document.getElementById(`sl-${n}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  const md = () => scriptMarkdown(title, lines, ins);
  const download = async () => {
    try {
      const path = await chooseSavePath(title.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "video-script", "md");
      if (!path) return;
      await api.architectureWriteFile(path, toBase64(md()));
      setNote(`Saved to ${path}`);
    } catch (e) {
      onError(errorText(e));
    }
  };

  return (
    <div className="sr">
      {lines.length === 0 ? (
        <div className="sr-paste">
          <h3>Read the video instead of watching it</h3>
          <ol>
            <li>On YouTube, under the video press <b>…more</b>, then <b>Show transcript</b>.</li>
            <li>Select the transcript text and copy it.</li>
            <li>Paste it here. You get the complete script, with the important lines highlighted.</li>
          </ol>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} aria-label="Script title" placeholder="Title (optional)" />
          <textarea rows={9} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={"0:00\nare vector databases still needed\n0:05\nI ask because there is a good deal of discussion…"} aria-label="Pasted script" />
          <div className="tc-actions"><button className="btn btn-primary" disabled={raw.trim().length < 30} onClick={make}>Make the script</button><span className="hint">Works with any transcript text, not only YouTube. Nothing is sent anywhere until you press Highlight.</span></div>
        </div>
      ) : (
        <>
          <div className="sr-bar">
            <strong title={title}>{title}</strong>
            <span className="hint">{lines.length} lines · about {Math.max(1, Math.round(words / 230))} min to read</span>
            <span className="sr-actions">
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void analyse()}>{busy ? "Reading it…" : ins ? "Highlight again" : "Highlight important points"}</button>
              <button className="btn btn-sm" onClick={() => void saveToNotes(md(), { title }).then(() => { setNote("Saved to notes."); onSaved?.(); })}>Save to notes</button>
              <button className="btn btn-sm" onClick={() => void download()}>Download</button>
              <button className="btn btn-sm btn-ghost" onClick={() => { setLines([]); setIns(null); }}>New script</button>
            </span>
          </div>
          {note && <p className="hint sr-note" role="status">{note}</p>}
          {ins && (
            <div className="sr-sum">
              {ins.summary && <p>{ins.summary}</p>}
              {ins.key_points.length > 0 && (
                <ol className="sr-points">{ins.key_points.map((k, i) => <li key={i}><button onClick={() => jump(k.line)} title="Show this in the script">{k.point}</button></li>)}</ol>
              )}
            </div>
          )}
          <div className="sr-tools">
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search the script" aria-label="Search the script" />
            {ins && <label className="check"><input type="checkbox" checked={onlyKey} onChange={(e) => setOnlyKey(e.target.checked)} /> Only important lines</label>}
          </div>
          <div className="sr-script">
            {shown.length === 0 && <p className="hint">Nothing matches.</p>}
            {shown.map((l) => (
              <div key={l.n}>
                {chap.has(l.n) && !onlyKey && !q && <h4 className="sr-chap">{chap.get(l.n)}</h4>}
                <p id={`sl-${l.n}`} className={`sr-line ${imp.has(l.n) ? "key" : ""}`}>
                  <span className="sr-t">{l.time ?? l.n}</span>
                  <span>{l.text}</span>
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
