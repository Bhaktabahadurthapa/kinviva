import type { AppRecord } from "./platform";

/** What a note remembers besides its text, kept in the record's `meta`. */
export interface NoteMeta { folder?: string; pinned?: boolean; deleted_at?: number }

export function metaOf(n: Pick<AppRecord, "meta">): NoteMeta {
  try {
    const v = JSON.parse(n.meta ?? "{}") as NoteMeta;
    return { folder: typeof v.folder === "string" && v.folder ? v.folder : undefined, pinned: !!v.pinned, deleted_at: typeof v.deleted_at === "number" ? v.deleted_at : undefined };
  } catch {
    return {};
  }
}
export const withMeta = (n: AppRecord, patch: Partial<NoteMeta>): AppRecord => {
  const m = { ...metaOf(n), ...patch };
  const clean: NoteMeta = {};
  if (m.folder) clean.folder = m.folder;
  if (m.pinned) clean.pinned = true;
  if (m.deleted_at) clean.deleted_at = m.deleted_at;
  return { ...n, meta: JSON.stringify(clean) };
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Notes written before the rich editor are plain text: turn them into paragraphs. */
export function toHtml(body: string): string {
  if (/^\s*<(p|h[1-6]|ul|ol|blockquote|pre|table|div)[\s>]/i.test(body)) return body;
  const lines = body.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      out.push(`<ul>${list.map((t) => `<li><p>${esc(t)}</p></li>`).join("")}</ul>`);
      list = [];
    }
  };
  for (const l of lines) {
    const b = l.match(/^\s*[-*•]\s+(.*)$/);
    if (b) list.push(b[1]);
    else {
      flush();
      out.push(l.trim() ? `<p>${esc(l)}</p>` : "<p></p>");
    }
  }
  flush();
  return out.join("");
}

export function htmlToText(html: string): string {
  if (!/<[a-z][\s\S]*>/i.test(html)) return html;
  const d = new DOMParser().parseFromString(html.replace(/<\/(p|h[1-6]|li|tr|blockquote|pre)>/gi, "\n</$1>"), "text/html");
  return (d.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Hash tags written anywhere in the text, like #project. */
export function tagsOf(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]{2,30})/gu)) found.add(m[1].toLowerCase());
  return [...found];
}

export function previewOf(text: string, title: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const rest = lines[0] === title.trim() ? lines.slice(1) : lines;
  return rest.join(" ").slice(0, 120);
}

/** Checklist progress, counted from the editor's HTML. */
export function checklistOf(html: string): { done: number; total: number } {
  const items = (html.match(/<li[^>]*data-type="taskItem"[^>]*>/g) ?? []);
  return { done: items.filter((t) => /data-checked="true"/.test(t)).length, total: items.length };
}

/** A small, honest Markdown export of the editor's HTML. */
export function htmlToMarkdown(title: string, html: string): string {
  const doc = new DOMParser().parseFromString(toHtml(html), "text/html");
  const inline = (n: Node): string => {
    if (n.nodeType === 3) return n.textContent ?? "";
    if (!(n instanceof HTMLElement)) return "";
    const inner = [...n.childNodes].map(inline).join("");
    switch (n.tagName) {
      case "STRONG": case "B": return `**${inner}**`;
      case "EM": case "I": return `*${inner}*`;
      case "S": case "DEL": return `~~${inner}~~`;
      case "U": return `<u>${inner}</u>`;
      case "CODE": return `\`${inner}\``;
      case "A": return `[${inner}](${n.getAttribute("href") ?? ""})`;
      case "BR": return "\n";
      case "IMG": return "![image](attached image)";
      default: return inner;
    }
  };
  const block = (n: Element, depth = 0): string => {
    const pad = "  ".repeat(depth);
    switch (n.tagName) {
      case "H1": return `# ${inline(n)}\n`;
      case "H2": return `## ${inline(n)}\n`;
      case "H3": return `### ${inline(n)}\n`;
      case "P": return `${inline(n)}\n`;
      case "BLOCKQUOTE": return [...n.children].map((c) => block(c, depth)).join("").split("\n").filter(Boolean).map((l) => `> ${l}`).join("\n") + "\n";
      case "PRE": return "```\n" + (n.textContent ?? "") + "\n```\n";
      case "HR": return "---\n";
      case "UL": case "OL": {
        const task = n.getAttribute("data-type") === "taskList";
        return [...n.children].map((li, i) => {
          const parts = [...li.children];
          const para = parts.find((c) => c.tagName === "P" || c.tagName === "DIV");
          const text = para ? inline(para) : inline(li);
          const sub = parts.filter((c) => c.tagName === "UL" || c.tagName === "OL").map((c) => block(c, depth + 1)).join("");
          const mark = task ? `- [${li.getAttribute("data-checked") === "true" ? "x" : " "}] ` : n.tagName === "OL" ? `${i + 1}. ` : "- ";
          return `${pad}${mark}${text}\n${sub}`;
        }).join("");
      }
      case "TABLE": {
        const rows = [...n.querySelectorAll("tr")].map((r) => [...r.children].map((c) => (c.textContent ?? "").trim().replace(/\|/g, "\\|")));
        if (!rows.length) return "";
        const w = Math.max(...rows.map((r) => r.length));
        const line = (r: string[]) => `| ${Array.from({ length: w }, (_, i) => r[i] ?? "").join(" | ")} |`;
        return [line(rows[0]), `| ${Array(w).fill("---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n") + "\n";
      }
      default: return [...n.children].map((c) => block(c, depth)).join("") || `${inline(n)}\n`;
    }
  };
  const body = [...doc.body.children].map((c) => block(c)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return `# ${title}\n\n${body}\n`;
}
