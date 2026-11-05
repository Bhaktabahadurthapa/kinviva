import type { View } from "./MermaidRenderer";

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

/** Zoom, fit, full screen, copy and export controls. */
export function DiagramToolbar({
  view,
  disabled,
  fullscreen,
  onZoom,
  onFit,
  onFullscreen,
  onCopy,
  onExport,
  copied,
}: {
  view: View;
  disabled: boolean;
  fullscreen: boolean;
  onZoom: (factor: number) => void;
  onFit: () => void;
  onFullscreen: () => void;
  onCopy: () => void;
  onExport: (kind: "svg" | "png") => void;
  copied: boolean;
}) {
  return (
    <div className="mm-toolbar" role="toolbar" aria-label="Diagram tools">
      <button className="btn btn-sm btn-ghost" onClick={() => onZoom(1 / 1.2)} disabled={disabled} aria-label="Zoom out" title="Zoom out"><Icon d="M5 12h14" /></button>
      <span className="mm-zoom" aria-live="polite">{Math.round(view.scale * 100)}%</span>
      <button className="btn btn-sm btn-ghost" onClick={() => onZoom(1.2)} disabled={disabled} aria-label="Zoom in" title="Zoom in"><Icon d="M12 5v14M5 12h14" /></button>
      <button className="btn btn-sm btn-ghost" onClick={onFit} disabled={disabled} title="Fit to screen">Fit</button>
      <button className="btn btn-sm btn-ghost" onClick={onFullscreen} disabled={disabled} title={fullscreen ? "Leave full screen" : "Full screen"}>{fullscreen ? "Exit full screen" : "Full screen"}</button>
      <span className="mm-sep" aria-hidden />
      <button className="btn btn-sm btn-ghost" onClick={onCopy} disabled={disabled} title="Copy the Mermaid source">{copied ? "Copied" : "Copy source"}</button>
      <button className="btn btn-sm btn-ghost" onClick={() => onExport("svg")} disabled={disabled} title="Export as SVG">SVG</button>
      <button className="btn btn-sm btn-ghost" onClick={() => onExport("png")} disabled={disabled} title="Export as PNG">PNG</button>
    </div>
  );
}
