import type { Passage } from "./types";

/** "notes.pdf, p. 4" for PDFs, "notes.md, part 2" for text files. */
export function citationText(p: Passage): string {
  return p.page != null ? `${p.document}, p. ${p.page}` : `${p.document}, part ${p.chunk + 1}`;
}

/**
 * Replaces [S1], [S2] ... markers with the real file and page. A marker that
 * points at no retrieved passage becomes "[unverified source]" so an invented
 * citation is never shown as if it were real. Mirrors the Rust version that
 * stores answers with the meeting.
 */
export function resolveCitations(text: string, passages: Passage[]): string {
  return text.replace(/\[S(\d+)\]/g, (_, n: string) => {
    const p = passages[Number(n) - 1];
    return p ? `[${citationText(p)}]` : "[unverified source]";
  });
}
