import type { Frame } from "../../lib/deck";

const W = 10;
const H = 5.625;
const FONT = { head: 'Cambria, Georgia, "Times New Roman", serif', body: 'Calibri, Carlito, "Segoe UI", Arial, sans-serif' };

/** Draws one planned slide on screen with the same positions the PowerPoint file uses. */
export function SlidePreview({ frame, label }: { frame: Frame; label: string }) {
  return (
    <div className="sp" role="img" aria-label={label} style={{ background: `#${frame.background}` }}>
      {frame.els.map((e, i) => {
        const box = { left: `${(e.x / W) * 100}%`, top: `${(e.y / H) * 100}%`, width: `${(e.w / W) * 100}%`, height: `${(e.h / H) * 100}%` };
        if (e.t === "shape") {
          return <div key={i} className="sp-shape" style={{ ...box, background: `#${e.fill}`, opacity: 1 - (e.transparency ?? 0) / 100, borderRadius: e.kind === "ellipse" ? "50%" : `${(((e.radius ?? 0) * 1.6) / W) * 100}cqw`, border: e.border ? `1px solid #${e.border}` : "none", boxShadow: e.shadow ? "0 0.3cqw 1cqw rgba(0,0,0,.10)" : "none" }} />;
        }
        const style = { ...box, color: `#${e.color}`, fontSize: `${e.size * 0.1389}cqw`, fontWeight: e.bold ? 700 : 400, fontStyle: e.italic ? "italic" : "normal", fontFamily: FONT[e.font], textAlign: e.align ?? "left", justifyContent: e.valign === "middle" ? "center" : "flex-start" } as const;
        return (
          <div key={i} className="sp-text" style={style}>
            {e.list ? <ul style={{ paddingLeft: "1.2em", margin: 0 }}>{e.list.map((t, k) => <li key={k} style={{ marginBottom: "0.5em" }}>{t}</li>)}</ul> : e.text}
          </div>
        );
      })}
    </div>
  );
}
