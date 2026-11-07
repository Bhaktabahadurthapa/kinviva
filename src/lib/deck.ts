/** Builds an editable PowerPoint file from a planned deck. Runs on this computer; nothing is uploaded. */

export type SlideLayout = "bullets" | "two_column" | "stat" | "steps" | "quote" | "summary";
export interface DeckSlide { layout: SlideLayout; title: string; bullets: string[]; stat: { value: string; label: string } | null; notes: string }
export interface DeckPlan { title: string; subtitle: string; slides: DeckSlide[] }

export interface DeckTheme { id: string; label: string; dark: string; mid: string; light: string; accent: string; ink: string; muted: string; card: string }
export const DECK_THEMES: DeckTheme[] = [
  { id: "navy", label: "Navy and blue", dark: "0B1735", mid: "2563EB", light: "F5F7FF", accent: "6D28D9", ink: "101B3C", muted: "475569", card: "FFFFFF" },
  { id: "teal", label: "Teal", dark: "0B3C49", mid: "028090", light: "F1FAF8", accent: "02C39A", ink: "0B2E38", muted: "46606A", card: "FFFFFF" },
  { id: "charcoal", label: "Charcoal", dark: "212121", mid: "36454F", light: "F2F2F2", accent: "D9480F", ink: "212121", muted: "555555", card: "FFFFFF" },
];

const W = 10;
const H = 5.625;
const M = 0.6;

export function parseDeck(json: string): DeckPlan {
  const v = JSON.parse(json) as DeckPlan;
  if (!Array.isArray(v.slides) || v.slides.length < 2) throw new Error("The presentation plan was empty.");
  return v;
}

export type El =
  | { t: "shape"; kind: "ellipse" | "roundRect"; x: number; y: number; w: number; h: number; fill: string; transparency?: number; border?: string; shadow?: boolean; radius?: number; name: string }
  | { t: "text"; x: number; y: number; w: number; h: number; text: string; list?: string[]; size: number; bold?: boolean; italic?: boolean; color: string; align?: "left" | "center" | "right"; valign?: "top" | "middle"; font: "head" | "body"; shrink?: boolean; name: string };
export interface Frame { background: string; els: El[]; notes: string }

const head = "Cambria";
const body = "Calibri";
const num = (n: number) => String(n).padStart(2, "0");

/** One description of every slide, drawn both by the on-screen preview and by the .pptx writer, so they match. */
export function frameOpening(plan: DeckPlan, author: string, T: DeckTheme): Frame {
  const els: El[] = [
    { t: "shape", kind: "ellipse", x: 6.6, y: -1.2, w: 5.2, h: 5.2, fill: T.mid, transparency: 70, name: "Decor circle large" },
    { t: "shape", kind: "ellipse", x: 7.9, y: 2.6, w: 3.4, h: 3.4, fill: T.accent, transparency: 72, name: "Decor circle small" },
    { t: "text", x: M, y: 1.5, w: 6.6, h: 1.8, text: plan.title, size: 40, bold: true, color: "FFFFFF", font: "head", name: "Title" },
  ];
  if (plan.subtitle) els.push({ t: "text", x: M, y: 3.45, w: 6.2, h: 0.9, text: plan.subtitle, size: 18, color: "CADCFC", font: "body", name: "Subtitle" });
  if (author) els.push({ t: "text", x: M, y: 4.85, w: 6, h: 0.35, text: author, size: 12, color: "AAB6D8", font: "body", name: "Presenter" });
  return { background: T.dark, els, notes: "" };
}

export function frameSlide(sl: DeckSlide, i: number, T: DeckTheme): Frame {
  const dark = sl.layout === "quote" || sl.layout === "summary";
  const fg = dark ? "FFFFFF" : T.ink;
  const soft = dark ? "CADCFC" : T.muted;
  const els: El[] = [];
  const b = sl.bullets;
  const title = () => els.push({ t: "text", x: M, y: 0.4, w: W - 2 * M, h: 0.95, text: sl.title, size: sl.title.length > 48 ? 30 : 36, bold: true, color: fg, font: "head", name: "Title" });
  const card = (x: number, y: number, w: number, h: number, name: string): El => ({ t: "shape", kind: "roundRect", x, y, w, h, fill: T.card, border: "DDE3F0", shadow: true, radius: 0.15, name });
  const badge = (x: number, y: number, d: number, label: string, color: string, size: number, name: string) => {
    els.push({ t: "shape", kind: "ellipse", x, y, w: d, h: d, fill: color, name: `${name} badge` });
    els.push({ t: "text", x, y, w: d, h: d, text: label, size, bold: true, color: "FFFFFF", align: "center", valign: "middle", font: "body", name: `${name} number` });
  };
  if (sl.layout === "stat" && sl.stat) {
    title();
    els.push({ t: "shape", kind: "roundRect", x: M, y: 1.65, w: 4.3, h: 3.1, fill: T.mid, radius: 0.2, name: "Stat card" });
    els.push({ t: "text", x: M + 0.2, y: 1.95, w: 3.9, h: 1.5, text: sl.stat.value, size: 66, bold: true, color: "FFFFFF", align: "center", valign: "middle", font: "head", shrink: true, name: "Stat value" });
    els.push({ t: "text", x: M + 0.3, y: 3.5, w: 3.7, h: 1.0, text: sl.stat.label, size: 16, color: "E3EBFF", align: "center", font: "body", name: "Stat label" });
    els.push({ t: "text", x: 5.4, y: 1.7, w: W - 5.4 - M, h: 3.0, text: "", list: b, size: 18, color: T.ink, font: "body", name: "Points" });
  } else if (sl.layout === "two_column" && b.length >= 2) {
    title();
    const half = Math.ceil(b.length / 2);
    [b.slice(0, half), b.slice(half)].forEach((col, c) => {
      const x = M + c * 4.5;
      els.push(card(x, 1.6, 4.3, 3.2, `Column ${c + 1} card`));
      badge(x + 0.3, 1.85, 0.5, String(c + 1), c === 0 ? T.mid : T.accent, 16, `Column ${c + 1}`);
      els.push({ t: "text", x: x + 0.3, y: 2.5, w: 3.7, h: 2.15, text: "", list: col, size: 15, color: T.ink, font: "body", name: `Column ${c + 1} text` });
    });
  } else if (sl.layout === "steps" && b.length >= 2) {
    title();
    const n = Math.min(b.length, 5);
    const cw = (W - 2 * M - (n - 1) * 0.25) / n;
    b.slice(0, n).forEach((t, k) => {
      const x = M + k * (cw + 0.25);
      els.push(card(x, 1.9, cw, 2.6, `Step ${k + 1} card`));
      badge(x + 0.2, 2.1, 0.55, String(k + 1), T.mid, 18, `Step ${k + 1}`);
      els.push({ t: "text", x: x + 0.2, y: 2.85, w: cw - 0.4, h: 1.5, text: t, size: n > 4 ? 13 : 15, color: T.ink, font: "body", shrink: true, name: `Step ${k + 1} text` });
    });
  } else if (sl.layout === "quote") {
    els.push({ t: "shape", kind: "ellipse", x: W - 3.6, y: -1.0, w: 4.4, h: 4.4, fill: T.mid, transparency: 72, name: "Decor circle" });
    els.push({ t: "text", x: M, y: 0.5, w: 1.2, h: 1.2, text: "\u201C", size: 96, bold: true, color: T.accent, font: "head", name: "Quote mark" });
    els.push({ t: "text", x: M, y: 1.5, w: W - 2 * M - 0.4, h: 1.7, text: sl.title, size: 32, italic: true, color: "FFFFFF", font: "head", name: "Title" });
    if (b.length) els.push({ t: "text", x: M, y: 3.5, w: W - 2 * M, h: 1.3, text: b.join("\n"), size: 16, color: "CADCFC", font: "body", name: "Supporting text" });
  } else if (sl.layout === "summary") {
    title();
    b.slice(0, 5).forEach((t, k) => {
      const y = 1.6 + k * 0.62;
      badge(M, y, 0.42, String(k + 1), T.mid, 13, `Point ${k + 1}`);
      els.push({ t: "text", x: M + 0.65, y: y - 0.04, w: W - 2 * M - 0.65, h: 0.5, text: t, size: 17, color: "FFFFFF", valign: "middle", font: "body", shrink: true, name: `Point ${k + 1} text` });
    });
  } else {
    title();
    const rest = b.slice(1);
    els.push({ t: "text", x: M, y: 1.7, w: 5.1, h: 3.1, text: "", list: rest, size: 18, color: T.ink, font: "body", name: "Points" });
    els.push({ t: "shape", kind: "roundRect", x: 6.2, y: 1.65, w: W - 6.2 - M, h: 3.0, fill: T.mid, radius: 0.2, name: "Highlight card" });
    els.push({ t: "text", x: 6.45, y: 1.9, w: W - 6.2 - M - 0.5, h: 2.5, text: b[0] ?? "", size: 20, bold: true, color: "FFFFFF", valign: "middle", font: "head", shrink: true, name: "Highlight text" });
  }
  els.push({ t: "text", x: W - M - 0.8, y: H - 0.5, w: 0.8, h: 0.3, text: num(i + 1), size: 11, color: soft, align: "right", font: "body", name: "Slide number" });
  return { background: dark ? T.dark : T.light, els, notes: sl.notes };
}

export function allFrames(plan: DeckPlan, author: string, T: DeckTheme): Frame[] {
  return [frameOpening(plan, author, T), ...plan.slides.map((s, i) => frameSlide(s, i, T))];
}

/** Returns the .pptx file as base64. */
export async function buildDeck(plan: DeckPlan, theme: DeckTheme, author: string): Promise<string> {
  const { default: Pptx } = await import("pptxgenjs");
  const p = new Pptx();
  p.layout = "LAYOUT_16x9";
  p.title = plan.title;
  p.author = author || "Kinviva";
  p.company = "Kinviva";
  for (const f of allFrames(plan, author, theme)) {
    const s = p.addSlide();
    s.background = { color: f.background };
    for (const e of f.els) {
      if (e.t === "shape") {
        s.addShape(e.kind, {
          x: e.x, y: e.y, w: e.w, h: e.h, fill: { color: e.fill, transparency: e.transparency ?? 0 },
          line: e.border ? { color: e.border, width: 0.75 } : { color: e.fill, transparency: 100 },
          ...(e.radius ? { rectRadius: e.radius } : {}),
          ...(e.shadow ? { shadow: { type: "outer", color: "000000", opacity: 0.08, blur: 6, offset: 2, angle: 90 } } : {}),
          objectName: e.name,
        });
      } else {
        const content = e.list ? e.list.map((t, k) => ({ text: t, options: { bullet: true, breakLine: k < e.list!.length - 1, paraSpaceAfter: 10 } })) : e.text;
        s.addText(content, {
          x: e.x, y: e.y, w: e.w, h: e.h, fontFace: e.font === "head" ? head : body, fontSize: e.size, bold: e.bold, italic: e.italic, color: e.color,
          align: e.align ?? "left", valign: e.valign ?? "top", isTextBox: true, margin: 0, ...(e.shrink ? { fit: "shrink" as const } : {}), objectName: e.name,
        });
      }
    }
    if (f.notes) s.addNotes(f.notes);
  }
  return (await p.write({ outputType: "base64" })) as string;
}
