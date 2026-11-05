import { save } from "@tauri-apps/plugin-dialog";

export type NotesFormat = "md" | "docx" | "txt";

export const FORMAT_LABEL: Record<NotesFormat, string> = { md: "Markdown", docx: "Word", txt: "Text" };
const FILTER: Record<NotesFormat, string> = { md: "Markdown", docx: "Word document", txt: "Text" };

/** A safe file name stem from a title. */
export function safeName(title: string, fallback: string): string {
  return title.replace(/[^\w\- ]+/g, "").trim().slice(0, 80) || fallback;
}

/** Asks where to save, or returns null if the user cancels. */
export async function chooseSavePath(stem: string, format: NotesFormat): Promise<string | null> {
  return save({ defaultPath: `${stem}.${format}`, filters: [{ name: FILTER[format], extensions: [format] }] });
}
