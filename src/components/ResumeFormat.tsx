import { TEMPLATES, pageHint, parseResume, usChecks, type ResumeDoc, type TemplateId } from "../lib/resume";

/** What the saved file will look like. Same structure as the Word export, so the preview and the file match. */
export function ResumePreview({ doc, template }: { doc: ResumeDoc; template: TemplateId }) {
  if (!doc.name && doc.sections.length === 0) return <p className="hint">Nothing to preview yet.</p>;
  return (
    <div className={`rp rp-${template}`} role="img" aria-label="Resume preview">
      <div className="rp-name">{doc.name}</div>
      {doc.contacts.length > 0 && <div className="rp-contact">{doc.contacts.join("  |  ")}</div>}
      {doc.sections.map((s, i) => (
        <section key={i}>
          <h4>{s.heading}</h4>
          {s.items.map((it, j) =>
            it.kind === "role" ? (
              <div key={j} className="rp-role"><span><b>{it.left}</b>{it.sub ? `, ${it.sub}` : ""}</span><span>{it.dates}</span></div>
            ) : it.kind === "bullet" ? (
              <div key={j} className="rp-bullet"><span>•</span><span>{it.text}</span></div>
            ) : it.kind === "skills" ? (
              <div key={j}>{it.label && <b>{it.label}: </b>}{it.text}</div>
            ) : (
              <div key={j}>{it.text}</div>
            ),
          )}
        </section>
      ))}
    </div>
  );
}

/** Layout choices, US-format checks and a preview for one resume text. */
export function ResumeFormat({ text, template, onTemplate }: { text: string; template: TemplateId; onTemplate: (t: TemplateId) => void }) {
  const doc = parseResume(text);
  const info = TEMPLATES.find((t) => t.id === template) ?? TEMPLATES[0];
  const checks = usChecks(doc, text);
  return (
    <div className="rf">
      <div className="rf-opts" role="radiogroup" aria-label="Resume layout">
        {TEMPLATES.map((t) => (
          <button key={t.id} role="radio" aria-checked={t.id === template} className={`rf-opt ${t.id === template ? "on" : ""}`} onClick={() => onTemplate(t.id)}>
            <strong>{t.label}</strong>
            <span className="hint">{t.blurb}</span>
          </button>
        ))}
      </div>
      <p className="hint">Letter size (8.5 × 11 in), one column, real text and no tables or images, so applicant tracking systems read it correctly. Length: {pageHint(text, info)}.</p>
      <ul className="jb-checks" aria-label="US resume checks">
        {checks.map((c) => <li key={c.label} className={c.ok ? "ok" : "warn"}>{c.ok ? "✓" : "!"} {c.label}</li>)}
      </ul>
      <ResumePreview doc={doc} template={template} />
    </div>
  );
}
