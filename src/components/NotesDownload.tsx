import { FORMAT_LABEL, type NotesFormat } from "../lib/download";

const FORMATS: NotesFormat[] = ["md", "docx", "txt"];

/** Download buttons for a notes file: Markdown, Word, or plain text. */
export function NotesDownload({ onPick, disabled }: { onPick: (f: NotesFormat) => void; disabled?: boolean }) {
  return (
    <span className="notes-download" role="group" aria-label="Download notes">
      {FORMATS.map((f) => (
        <button key={f} className="btn btn-sm" disabled={disabled} onClick={() => onPick(f)}>
          {FORMAT_LABEL[f]}
        </button>
      ))}
    </span>
  );
}
