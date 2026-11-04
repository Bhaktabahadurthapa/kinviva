const LABELS = ["Key points", "Meaning", "Details", "Terms", "Answer", "Fill in", "Unclear", "Asking", "Points to cover"];
const LABEL_RE = new RegExp(`^\\**(${LABELS.join("|")})\\**\\s*:\\s*\\**\\s*(.*)$`, "i");

/** The model's way of saying a question needs no answer from the user. */
export const isNoAnswer = (text: string) => /^\s*NO_ANSWER\b/i.test(text);

type Block = { kind: "label"; label: string; text: string } | { kind: "p"; text: string } | { kind: "li"; text: string };

/**
 * Renders model text: "Meaning:" / "Details:" style labels as small headings,
 * "- " lines as bullets, everything else as paragraphs.
 */
export function AiText({ text, streaming }: { text: string; streaming?: boolean }) {
  if (isNoAnswer(text)) return <p className="note-muted">No question for you to answer.</p>;
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const label = line.match(LABEL_RE);
    const bullet = line.match(/^(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (label) {
      const name = LABELS.find((l) => l.toLowerCase() === label[1].toLowerCase()) ?? label[1];
      blocks.push({ kind: "label", label: name, text: label[2].replace(/\*+$/, "").trim() });
    } else if (bullet) blocks.push({ kind: "li", text: bullet[1].replace(/^(?:[-•*]\s+)+/, "") });
    else blocks.push({ kind: "p", text: line });
  }
  const out: JSX.Element[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      out.push(
        <ul key={`ul${out.length}`}>
          {list.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  blocks.forEach((b, i) => {
    if (b.kind === "li") return void list.push(b.text);
    flush();
    if (b.kind === "label") {
      const cls = `ai-label is-${b.label.toLowerCase().replace(/\s+/g, "-")}`;
      out.push(
        <div key={i} className={cls}>
          <span className="ai-label-name">{b.label}</span>
          {b.text && <p>{b.text}</p>}
        </div>,
      );
    } else out.push(<p key={i}>{b.text}</p>);
  });
  flush();
  return (
    <div className="ai-rich">
      {out}
      {streaming && <span className="caret" />}
    </div>
  );
}
