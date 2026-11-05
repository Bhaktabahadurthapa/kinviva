import { useEffect, useState } from "react";
import { checkSource, MAX_SOURCE_CHARS } from "../../lib/architecture";

/** Edit the Mermaid source. Nothing is applied until the source passes the safety check. */
export function DiagramEditor({ source, onApply, onClose }: { source: string; onApply: (s: string) => void; onClose: () => void }) {
  const [text, setText] = useState(source);
  useEffect(() => setText(source), [source]);
  const check = checkSource(text);
  return (
    <div className="mm-editor">
      <label htmlFor="mm-source" className="mm-editor-label">Mermaid source</label>
      <textarea id="mm-source" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} rows={12} maxLength={MAX_SOURCE_CHARS + 500} />
      <p className={`hint ${!check.ok && text.trim() ? "mm-bad" : ""}`} role="status">
        {check.ok ? "Looks safe. Apply to redraw." : text.trim() ? check.error : "Write some diagram source."}
      </p>
      <div className="mm-editor-actions">
        <button className="btn btn-primary btn-sm" disabled={!check.ok} onClick={() => check.ok && onApply(check.source)}>Apply</button>
        <button className="btn btn-sm" onClick={() => setText(source)} disabled={text === source}>Reset</button>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
