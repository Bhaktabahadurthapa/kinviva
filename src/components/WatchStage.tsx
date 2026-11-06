import { useEffect, useRef, useState } from "react";

/** A theatre for videos: play a video file next to the live transcript and answers. Its sound is heard by MeetingLens like any other sound on this computer. */
export function WatchStage({ caption }: { caption: { who: string; text: string } | null }) {
  const [src, setSrc] = useState<{ url: string; name: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState("");
  const [cc, setCc] = useState(() => {
    try {
      return localStorage.getItem("ml.watchCc") !== "off";
    } catch {
      return true;
    }
  });
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (src) URL.revokeObjectURL(src.url); }, [src]);

  const load = (f: File | undefined | null) => {
    setErr("");
    if (!f) return;
    if (!/^(video|audio)\//.test(f.type) && !/\.(mp4|m4v|mov|webm|mkv|mp3|m4a|wav)$/i.test(f.name)) return setErr("Choose a video file, for example MP4, MOV or WebM.");
    setSrc({ url: URL.createObjectURL(f), name: f.name });
  };
  const toggleCc = () => {
    setCc((v) => {
      try { localStorage.setItem("ml.watchCc", v ? "off" : "on"); } catch { /* not essential */ }
      return !v;
    });
  };

  return (
    <section className="ws" aria-label="Video">
      <input ref={input} type="file" accept="video/*,audio/*,.mkv" hidden onChange={(e) => { load(e.target.files?.[0]); e.target.value = ""; }} />
      {!src ? (
        <div className={`ws-drop ${drag ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); load(e.dataTransfer.files?.[0]); }}>
          <button className="ws-play" onClick={() => input.current?.click()} aria-label="Choose a video file">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden><path d="M8 5.5v13l11-6.5z" /></svg>
          </button>
          <h3>Watch a video here</h3>
          <p>Drop a video file, or choose one. It plays on this screen while the transcript and answers stay beside it.</p>
          <button className="btn btn-primary" onClick={() => input.current?.click()}>Choose a video</button>
          {err && <p className="ws-err" role="alert">{err}</p>}
          <p className="ws-tip"><b>Video in your browser?</b> Put the browser and MeetingLens side by side. MeetingLens hears the video's sound and writes the transcript here.</p>
        </div>
      ) : (
        <div className="ws-player">
          <div className="ws-bar">
            <span className="ws-name" title={src.name}>{src.name}</span>
            <button className={`btn btn-sm ${cc ? "" : "btn-ghost"}`} aria-pressed={cc} onClick={toggleCc}>Live captions</button>
            <button className="btn btn-sm" onClick={() => input.current?.click()}>Change</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setSrc(null)}>Close</button>
          </div>
          <div className="ws-frame">
            <video src={src.url} controls playsInline />
            {cc && caption && (
              <div className="ws-cc" aria-live="polite"><span>{caption.who}</span>{caption.text}</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
