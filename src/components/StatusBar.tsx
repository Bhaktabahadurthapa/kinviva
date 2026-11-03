import type { MeetingStatus, Source, SourceStatus } from "../lib/types";

function Meter({ level }: { level: number }) {
  // Map RMS (roughly 0..0.3 for speech) to 0..100%.
  const pct = Math.min(100, Math.round(Math.sqrt(level / 0.3) * 100));
  return (
    <span className="meter" aria-hidden>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

const captureLabel: Record<SourceStatus["capture"], string> = {
  off: "Off",
  starting: "Starting…",
  capturing: "Capturing",
  error: "Problem",
};

export function SourcePill({ name, source, st, level, idle, idleEnabled }: { name: string; source: Source; st: SourceStatus; level?: number; idle?: boolean; idleEnabled?: boolean }) {
  if (idle) {
    return (
      <span className="pill pill-muted" data-source={source} title="Status while no meeting is running">
        <span className="dot" />
        {name}: {idleEnabled ? "Standby" : "Disabled in settings"}
      </span>
    );
  }
  const tone = !st.enabled
    ? "muted"
    : st.capture === "error" || st.stt === "error"
      ? "bad"
      : st.capture === "capturing"
        ? "live"
        : "muted";
  const title = [st.device, st.message, st.stt !== "idle" ? `Speech: ${st.stt}` : null].filter(Boolean).join(" · ");
  return (
    <span className={`pill pill-${tone}`} title={title} data-source={source}>
      <span className="dot" />
      {name}: {st.enabled ? captureLabel[st.capture] : "Disabled"}
      {st.capture === "capturing" && <Meter level={level ?? 0} />}
    </span>
  );
}

export function PrivacyPills({ status, llmHost, llmLocal }: { status: MeetingStatus; llmHost: string; llmLocal: boolean }) {
  const running = status.state === "running";
  return (
    <>
      {running && (
        <span className={`pill ${status.audio_to_cloud ? "pill-warn" : "pill-ok"}`} title="Where meeting audio goes">
          Audio → {status.audio_to_cloud ? `${status.stt_host ?? "cloud"} (cloud)` : "this device"}
        </span>
      )}
      <span className={`pill ${llmLocal ? "pill-ok" : "pill-warn"}`} title="Where text is sent when you use an AI action">
        AI text → {llmLocal ? "this device" : `${llmHost} (cloud)`} · on request
      </span>
      {running && status.recording_audio && <span className="pill pill-warn">● Recording audio to disk</span>}
    </>
  );
}

export function SourceErrors({ status }: { status: MeetingStatus }) {
  const errs = (["mic", "system"] as const)
    .map((s) => ({ s, st: status[s] }))
    .filter(({ st }) => st.enabled && st.message && (st.capture === "error" || st.stt === "error" || status.state === "running"));
  if (!errs.length) return null;
  return (
    <div className="banner banner-bad" role="alert">
      {errs.map(({ s, st }) => (
        <div key={s}>
          <strong>{s === "mic" ? "Microphone" : "System audio"}:</strong> {st.message}
        </div>
      ))}
    </div>
  );
}
