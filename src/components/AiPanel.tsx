import { useEffect, useState } from "react";
import { api, errorText } from "../lib/api";
import type { AiSlot } from "../lib/types";

const actionLabel: Record<string, string> = {
  explain: "Simple meaning",
  recap: "Recap",
  ask: "Answer",
  suggest: "Suggested reply",
};

export function AiPanel({
  title,
  slot,
  editable,
  placeholder,
  voice,
}: {
  title: string;
  slot?: AiSlot;
  editable?: boolean;
  placeholder: string;
  /** "serif" renders the answer in the editorial display face. */
  voice?: "serif";
}) {
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const streaming = slot?.state === "streaming";
  useEffect(() => {
    if (slot && (slot.state === "done" || slot.state === "streaming" || slot.state === "cancelled")) setDraft(slot.text);
  }, [slot?.text, slot?.state]);

  const copy = async () => {
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <section className={`panel ${voice ? `voice-${voice}` : ""} ${streaming ? "is-streaming" : ""}`}>
      <header>
        <h2>{slot?.action && slot.action !== "suggest" ? actionLabel[slot.action] : title}</h2>
        <div className="panel-tools">
          {streaming && (
            <button className="btn btn-ghost btn-sm" onClick={() => slot?.request_id && api.aiCancel(slot.request_id).catch(errorText)}>
              Cancel
            </button>
          )}
          {editable && draft && !streaming && (
            <button className="btn btn-ghost btn-sm" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>
      </header>
      {slot?.question && <div className="panel-q">Q: {slot.question}</div>}
      <div className="panel-body">
        {!slot || slot.state === "idle" ? (
          <p className="empty">{placeholder}</p>
        ) : slot.state === "error" ? (
          <div className="banner banner-bad" role="alert">{slot.error}</div>
        ) : editable && !streaming ? (
          <textarea className="reply-edit" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Editable suggested reply" />
        ) : (
          <div className="ai-text">
            {slot.text || (streaming ? <span className="thinking">Thinking </span> : null)}
            {streaming && slot.text && <span className="caret" />}
          </div>
        )}
        {slot?.state === "cancelled" && <p className="note">Cancelled. Partial text shown.</p>}
      </div>
      {slot && slot.state !== "idle" && (
        <footer className="panel-meta">
          {slot.destination && <span>via {slot.destination}</span>}
          {slot.sources.length > 0 ? (
            <details>
              <summary>{slot.sources.length} document passage{slot.sources.length > 1 ? "s" : ""} used</summary>
              {slot.sources.map((p, i) => (
                <blockquote key={i}>
                  <cite>
                    {p.document} #{p.chunk + 1}
                  </cite>
                  {p.text.length > 280 ? p.text.slice(0, 280) + "…" : p.text}
                </blockquote>
              ))}
            </details>
          ) : (
            <span>no document passages matched</span>
          )}
        </footer>
      )}
    </section>
  );
}
