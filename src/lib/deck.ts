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

/** Returns the .pptx file as base64. */
export async function buildDeck(plan: DeckPlan, theme: DeckTheme, author: string): Promise<string> {
  const { default: Pptx } = await import("pptxgenjs");
  const p = new Pptx();
  p.layout = "LAYOUT_16x9";
  p.title = plan.title;
  p.author = author || "MeetingLens";
  p.company = "MeetingLens";
  const head = "Cambria";
  const body = "Calibri";
  const T = theme;
  const num = (n: number) => String(n).padStart(2, "0");

  // Opening slide
  {
    const s = p.addSlide();
    s.background = { color: T.dark };
    s.addShape("ellipse", { x: 6.6, y: -1.2, w: 5.2, h: 5.2, fill: { color: T.mid, transparency: 70 }, line: { color: T.mid, transparency: 100 }, objectName: "Decor circle large" });
    s.addShape("ellipse", { x: 7.9, y: 2.6, w: 3.4, h: 3.4, fill: { color: T.accent, transparency: 72 }, line: { color: T.accent, transparency: 100 }, objectName: "Decor circle small" });
    s.addText(plan.title, { x: M, y: 1.5, w: 6.6, h: 1.8, fontFace: head, fontSize: 40, bold: true, color: "FFFFFF", valign: "top", isTextBox: true, margin: 0, objectName: "Title" });
    if (plan.subtitle) s.addText(plan.subtitle, { x: M, y: 3.45, w: 6.2, h: 0.9, fontFace: body, fontSize: 18, color: "CADCFC", valign: "top", isTextBox: true, margin: 0, objectName: "Subtitle" });
    s.addText(author || "", { x: M, y: 4.85, w: 6, h: 0.35, fontFace: body, fontSize: 12, color: "AAB6D8", isTextBox: true, margin: 0, objectName: "Presenter" });
  }

  plan.slides.forEach((sl, i) => {
    const s = p.addSlide();
    const dark = sl.layout === "quote" || sl.layout === "summary";
    s.background = { color: dark ? T.dark : T.light };
    const fg = dark ? "FFFFFF" : T.ink;
    const soft = dark ? "CADCFC" : T.muted;
    const title = (w = W - 2 * M) => s.addText(sl.title, { x: M, y: 0.4, w, h: 0.95, fontFace: head, fontSize: sl.title.length > 48 ? 30 : 36, bold: true, color: fg, valign: "top", isTextBox: true, margin: 0, objectName: "Title" });
    const pageNo = () => s.addText(`${num(i + 1)}`, { x: W - M - 0.8, y: H - 0.5, w: 0.8, h: 0.3, fontFace: body, fontSize: 11, color: soft, align: "right", isTextBox: true, margin: 0, objectName: "Slide number" });
    if (sl.notes) s.addNotes(sl.notes);
    const b = sl.bullets;

    if (sl.layout === "stat" && sl.stat) {
      title();
      s.addShape("roundRect", { x: M, y: 1.65, w: 4.3, h: 3.1, fill: { color: T.mid }, line: { color: T.mid, transparency: 100 }, rectRadius: 0.2, objectName: "Stat card" });
      s.addText(sl.stat.value, { x: M + 0.2, y: 1.95, w: 3.9, h: 1.5, fontFace: head, fontSize: 66, bold: true, color: "FFFFFF", align: "center", valign: "middle", isTextBox: true, margin: 0, fit: "shrink", objectName: "Stat value" });
      s.addText(sl.stat.label, { x: M + 0.3, y: 3.5, w: 3.7, h: 1.0, fontFace: body, fontSize: 16, color: "E3EBFF", align: "center", valign: "top", isTextBox: true, margin: 0, objectName: "Stat label" });
      s.addText(b.map((t, k) => ({ text: t, options: { bullet: true, breakLine: k < b.length - 1, paraSpaceAfter: 10 } })), { x: 5.4, y: 1.7, w: W - 5.4 - M, h: 3.0, fontFace: body, fontSize: 18, color: T.ink, valign: "top", isTextBox: true, margin: 0, objectName: "Points" });
    } else if (sl.layout === "two_column" && b.length >= 2) {
      title();
      const half = Math.ceil(b.length / 2);
      [b.slice(0, half), b.slice(half)].forEach((col, c) => {
        const x = M + c * 4.5;
        s.addShape("roundRect", { x, y: 1.6, w: 4.3, h: 3.2, fill: { color: T.card }, line: { color: "DDE3F0", width: 0.75 }, rectRadius: 0.15, shadow: { type: "outer", color: "000000", opacity: 0.08, blur: 6, offset: 2, angle: 90 }, objectName: `Column ${c + 1} card` });
        s.addShape("ellipse", { x: x + 0.3, y: 1.85, w: 0.5, h: 0.5, fill: { color: c === 0 ? T.mid : T.accent }, line: { color: "FFFFFF", transparency: 100 }, objectName: `Column ${c + 1} badge` });
        s.addText(String(c + 1), { x: x + 0.3, y: 1.85, w: 0.5, h: 0.5, fontFace: body, fontSize: 16, bold: true, color: "FFFFFF", align: "center", valign: "middle", isTextBox: true, margin: 0, objectName: `Column ${c + 1} number` });
        s.addText(col.map((t, k) => ({ text: t, options: { bullet: true, breakLine: k < col.length - 1, paraSpaceAfter: 8 } })), { x: x + 0.3, y: 2.5, w: 3.7, h: 2.15, fontFace: body, fontSize: 15, color: T.ink, valign: "top", isTextBox: true, margin: 0, objectName: `Column ${c + 1} text` });
      });
    } else if (sl.layout === "steps" && b.length >= 2) {
      title();
      const n = Math.min(b.length, 5);
      const cw = (W - 2 * M - (n - 1) * 0.25) / n;
      b.slice(0, n).forEach((t, k) => {
        const x = M + k * (cw + 0.25);
        s.addShape("roundRect", { x, y: 1.9, w: cw, h: 2.6, fill: { color: T.card }, line: { color: "DDE3F0", width: 0.75 }, rectRadius: 0.15, shadow: { type: "outer", color: "000000", opacity: 0.08, blur: 6, offset: 2, angle: 90 }, objectName: `Step ${k + 1} card` });
        s.addShape("ellipse", { x: x + 0.2, y: 2.1, w: 0.55, h: 0.55, fill: { color: T.mid }, line: { color: "FFFFFF", transparency: 100 }, objectName: `Step ${k + 1} badge` });
        s.addText(String(k + 1), { x: x + 0.2, y: 2.1, w: 0.55, h: 0.55, fontFace: body, fontSize: 18, bold: true, color: "FFFFFF", align: "center", valign: "middle", isTextBox: true, margin: 0, objectName: `Step ${k + 1} number` });
        s.addText(t, { x: x + 0.2, y: 2.85, w: cw - 0.4, h: 1.5, fontFace: body, fontSize: n > 4 ? 13 : 15, color: T.ink, valign: "top", isTextBox: true, margin: 0, fit: "shrink", objectName: `Step ${k + 1} text` });
      });
    } else if (sl.layout === "quote") {
      s.addShape("ellipse", { x: W - 3.6, y: -1.0, w: 4.4, h: 4.4, fill: { color: T.mid, transparency: 72 }, line: { color: T.mid, transparency: 100 }, objectName: "Decor circle" });
      s.addText("“", { x: M, y: 0.5, w: 1.2, h: 1.2, fontFace: head, fontSize: 96, bold: true, color: T.accent, isTextBox: true, margin: 0, objectName: "Quote mark" });
      s.addText(sl.title, { x: M, y: 1.5, w: W - 2 * M - 0.4, h: 1.7, fontFace: head, fontSize: 32, italic: true, color: "FFFFFF", valign: "top", isTextBox: true, margin: 0, objectName: "Title" });
      if (b.length) s.addText(b.join("\n"), { x: M, y: 3.5, w: W - 2 * M, h: 1.3, fontFace: body, fontSize: 16, color: "CADCFC", valign: "top", isTextBox: true, margin: 0, objectName: "Supporting text" });
    } else if (sl.layout === "summary") {
      title();
      b.slice(0, 5).forEach((t, k) => {
        const y = 1.6 + k * 0.62;
        s.addShape("ellipse", { x: M, y, w: 0.42, h: 0.42, fill: { color: T.mid }, line: { color: "FFFFFF", transparency: 100 }, objectName: `Point ${k + 1} badge` });
        s.addText(String(k + 1), { x: M, y, w: 0.42, h: 0.42, fontFace: body, fontSize: 13, bold: true, color: "FFFFFF", align: "center", valign: "middle", isTextBox: true, margin: 0, objectName: `Point ${k + 1} number` });
        s.addText(t, { x: M + 0.65, y: y - 0.04, w: W - 2 * M - 0.65, h: 0.5, fontFace: body, fontSize: 17, color: "FFFFFF", valign: "middle", isTextBox: true, margin: 0, fit: "shrink", objectName: `Point ${k + 1} text` });
      });
    } else {
      // bullets: text on the left, a soft panel with the first point as a highlight on the right
      title();
      const lead = b[0] ?? "";
      const rest = b.slice(1);
      s.addText(rest.map((t, k) => ({ text: t, options: { bullet: true, breakLine: k < rest.length - 1, paraSpaceAfter: 10 } })), { x: M, y: 1.7, w: 5.1, h: 3.1, fontFace: body, fontSize: 18, color: T.ink, valign: "top", isTextBox: true, margin: 0, objectName: "Points" });
      s.addShape("roundRect", { x: 6.2, y: 1.65, w: W - 6.2 - M, h: 3.0, fill: { color: T.mid }, line: { color: T.mid, transparency: 100 }, rectRadius: 0.2, objectName: "Highlight card" });
      s.addText(lead, { x: 6.45, y: 1.9, w: W - 6.2 - M - 0.5, h: 2.5, fontFace: head, fontSize: 20, bold: true, color: "FFFFFF", valign: "middle", isTextBox: true, margin: 0, fit: "shrink", objectName: "Highlight text" });
    }
    pageNo();
  });

  return (await p.write({ outputType: "base64" })) as string;
}
