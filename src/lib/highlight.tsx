import type { ReactNode } from "react";

/** Text with **key words** marked by the model becomes highlighted spans. Stray asterisks are dropped. */
export function renderMarked(text: string): ReactNode {
  const parts = text.split(/\*\*([^*\n]{1,80}?)\*\*/g);
  return parts.map((part, i) => (i % 2 === 1 ? <mark key={i} className="hl">{part}</mark> : part.replace(/\*+/g, "")));
}

/** Plain text without the highlight markers (for copying and reading aloud). */
export function stripMarks(text: string): string {
  return text.replace(/\*\*([^*\n]+?)\*\*/g, "$1");
}

/** "term: meaning" lines in a word list: the term is shown in bold. */
export function renderTerm(text: string): ReactNode {
  const m = text.match(/^([^:]{1,40}):\s+(.*)$/);
  if (!m) return renderMarked(text);
  return (
    <>
      <strong className="term">{m[1].replace(/\*+/g, "")}</strong>
      {": "}
      {renderMarked(m[2])}
    </>
  );
}
