import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { renderDiagram, svgSize, type DiagramTheme } from "../../lib/mermaidRender";

export interface View { scale: number; x: number; y: number }
export const MIN_SCALE = 0.2;
export const MAX_SCALE = 4;

/** Draws Mermaid source as SVG with pan and zoom. The SVG is sanitised and inserted as DOM nodes, never as HTML text. */
export function MermaidRenderer({
  source,
  theme,
  view,
  onView,
  fitSignal,
  onSvg,
  onError,
}: {
  source: string;
  theme: DiagramTheme;
  view: View;
  onView: (v: View) => void;
  fitSignal: number;
  onSvg: (svg: string | null) => void;
  onError: (message: string | null) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const size = useRef({ width: 0, height: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [drawn, setDrawn] = useState(0);
  const latest = useRef(0);

  const fit = () => {
    const box = viewport.current?.getBoundingClientRect();
    if (!box || !size.current.width) return;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min((box.width - 40) / size.current.width, (box.height - 40) / size.current.height, 1.6)));
    onView({ scale, x: (box.width - size.current.width * scale) / 2, y: (box.height - size.current.height * scale) / 2 });
  };

  // Draw. Only the newest request may show its result (older ones are ignored).
  useEffect(() => {
    const mine = ++latest.current;
    setBusy(true);
    renderDiagram(source, theme)
      .then((svg) => {
        if (mine !== latest.current || !stage.current) return;
        const parsed = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
        const node = document.importNode(parsed, true) as unknown as SVGSVGElement;
        node.removeAttribute("style");
        size.current = svgSize(svg);
        node.setAttribute("width", String(size.current.width));
        node.setAttribute("height", String(size.current.height));
        stage.current.replaceChildren(node);
        onSvg(svg);
        onError(null);
        setDrawn((d) => d + 1);
      })
      .catch((e: unknown) => {
        if (mine !== latest.current) return;
        onSvg(null);
        onError(e instanceof Error ? e.message : "The diagram could not be drawn.");
      })
      .finally(() => mine === latest.current && setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, theme]);

  // Fit after every new drawing and whenever the toolbar asks.
  useLayoutEffect(fit, [drawn, fitSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = viewport.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => size.current.width && fit());
    ro.observe(el);
    return () => ro.disconnect();
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = (factor: number, cx: number, cy: number) => {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
    const k = scale / view.scale;
    onView({ scale, x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k });
  };

  return (
    <div
      ref={viewport}
      className={`mm-viewport ${drag.current ? "is-dragging" : ""}`}
      tabIndex={0}
      role="img"
      aria-label="Architecture diagram. Drag to move, use the plus and minus keys or the toolbar to zoom."
      onWheel={(e) => {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
      }}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) onView({ ...view, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y });
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (e.key === "+" || e.key === "=") zoomAt(1.2, r.width / 2, r.height / 2);
        else if (e.key === "-") zoomAt(1 / 1.2, r.width / 2, r.height / 2);
        else if (e.key === "0") fit();
        else if (e.key === "ArrowLeft") onView({ ...view, x: view.x + 40 });
        else if (e.key === "ArrowRight") onView({ ...view, x: view.x - 40 });
        else if (e.key === "ArrowUp") onView({ ...view, y: view.y + 40 });
        else if (e.key === "ArrowDown") onView({ ...view, y: view.y - 40 });
        else return;
        e.preventDefault();
      }}
    >
      <div ref={stage} className="mm-stage" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
      {busy && <div className="mm-busy" role="status">Drawing…</div>}
    </div>
  );
}
