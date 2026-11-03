/** Renders model text: plain paragraphs, "- " lines as bullets, "Unclear:" as a note. */
export function AiText({ text, streaming }: { text: string; streaming?: boolean }) {
  const blocks: { kind: "p" | "li" | "unclear"; text: string }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (bullet) blocks.push({ kind: "li", text: bullet[1] });
    else if (/^unclear:/i.test(line)) blocks.push({ kind: "unclear", text: line.replace(/^unclear:\s*/i, "") });
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
    out.push(
      b.kind === "unclear" ? (
        <p key={i} className="unclear">
          <span>Unclear</span> {b.text}
        </p>
      ) : (
        <p key={i}>{b.text}</p>
      ),
    );
  });
  flush();
  return (
    <div className="ai-rich">
      {out}
      {streaming && <span className="caret" />}
    </div>
  );
}
