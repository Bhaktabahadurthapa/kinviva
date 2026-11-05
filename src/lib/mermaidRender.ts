/** Mermaid, loaded on demand and locked down. Rendering is serialised, cached and
 *  the resulting SVG is cleaned again before it is shown. */
import { checkSource, MAX_SOURCE_CHARS, MAX_EDGES } from "./architecture";

type Mermaid = typeof import("mermaid").default;
export type DiagramTheme = "light" | "dark";

let loader: Promise<Mermaid> | null = null;
let configured: DiagramTheme | null = null;

export async function loadMermaid(theme: DiagramTheme): Promise<Mermaid> {
  loader ??= import("mermaid").then((m) => m.default);
  const mermaid = await loader;
  if (configured !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict", // sanitises labels and disables click handlers and links
      theme: theme === "dark" ? "dark" : "neutral",
      maxTextSize: MAX_SOURCE_CHARS,
      maxEdges: MAX_EDGES,
      // Directives inside a diagram can never change these.
      secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "htmlLabels", "dompurifyConfig"],
      suppressErrorRendering: true,
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: false, curve: "basis" },
      sequence: { useMaxWidth: false },
      er: { useMaxWidth: false },
      state: { useMaxWidth: false },
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif",
    });
    configured = theme;
  }
  return mermaid;
}

const DROP_TAGS = new Set(["script", "foreignobject", "iframe", "object", "embed", "link", "meta", "audio", "video", "image", "a"]);

/** Removes anything active from an SVG string (second line of defence after Mermaid's own sanitiser). */
export function sanitizeSvg(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg" || doc.getElementsByTagName("parsererror").length) {
    throw new Error("The diagram could not be drawn safely.");
  }
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (DROP_TAGS.has(child.localName.toLowerCase())) {
        child.remove();
        continue;
      }
      walk(child);
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      else if ((name === "href" || name === "xlink:href") && !value.startsWith("#")) el.removeAttribute(attr.name);
      else if (name === "style" && /url\s*\(\s*(?!["']?#)/i.test(value)) el.removeAttribute(attr.name);
    }
  };
  walk(root);
  for (const style of Array.from(root.getElementsByTagName("style"))) {
    // Keep Mermaid's own CSS, but never external imports or resources.
    style.textContent = (style.textContent ?? "").replace(/@import[^;]*;?/gi, "").replace(/url\s*\(\s*(?!["']?#)[^)]*\)/gi, "none");
  }
  return new XMLSerializer().serializeToString(root);
}

const cache = new Map<string, string>();
let queue: Promise<unknown> = Promise.resolve();
let counter = 0;

/** Checks the source, then draws it. Resolves with sanitised SVG markup. */
export function renderDiagram(source: string, theme: DiagramTheme): Promise<string> {
  const checked = checkSource(source);
  if (!checked.ok) return Promise.reject(new Error(checked.error));
  const key = `${theme}\u0000${checked.source}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const run = async () => {
    const mermaid = await loadMermaid(theme);
    await mermaid.parse(checked.source);
    const { svg } = await mermaid.render(`mm-${++counter}`, checked.source);
    const clean = sanitizeSvg(svg);
    if (cache.size >= 24) cache.delete(cache.keys().next().value as string);
    cache.set(key, clean);
    return clean;
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result.catch((e: unknown) => {
    throw new Error(friendlyParseError(e));
  });
}

export function friendlyParseError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const line = msg.match(/line (\d+)/i);
  if (/Parse error|Syntax error|Lexical error|Expecting/i.test(msg)) return `The diagram source has a mistake${line ? ` near line ${line[1]}` : ""}. Check the arrows and quotes.`;
  return msg.split("\n")[0].slice(0, 200) || "The diagram could not be drawn.";
}

/** Size of an SVG from its viewBox (falls back to width/height). */
export function svgSize(svg: string): { width: number; height: number } {
  const vb = svg.match(/viewBox="([\d.\-\s,e]+)"/i)?.[1].split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { width: vb[2], height: vb[3] };
  const w = Number(svg.match(/\bwidth="([\d.]+)/)?.[1]);
  const h = Number(svg.match(/\bheight="([\d.]+)/)?.[1]);
  return { width: w > 0 ? w : 800, height: h > 0 ? h : 600 };
}

/** Standalone SVG file content (explicit size and white or dark background). */
export function svgForExport(svg: string, background: string): string {
  const { width, height } = svgSize(svg);
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  root.setAttribute("width", String(Math.ceil(width)));
  root.setAttribute("height", String(Math.ceil(height)));
  root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  root.setAttribute("style", `background:${background};${root.getAttribute("style") ?? ""}`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(root)}`;
}

export const toBase64 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
};

/** PNG (base64, no prefix) of an SVG at 2x. Mermaid is configured without HTML labels, so it draws cleanly on a canvas. */
export async function svgToPngBase64(svg: string, background: string, scale = 2): Promise<string> {
  const { width, height } = svgSize(svg);
  const w = Math.min(8000, Math.ceil(width * scale));
  const h = Math.min(8000, Math.ceil(height * scale));
  const img = new Image();
  img.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("The picture could not be created."));
    img.src = `data:image/svg+xml;base64,${toBase64(svgForExport(svg, background))}`;
  });
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The picture could not be created.");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/png").split(",")[1];
}
