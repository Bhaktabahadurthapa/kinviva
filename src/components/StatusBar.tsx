import type { MeetingStatus, Source, SourceStatus } from "../lib/types";

const SEGMENTS = 12;

/** Segmented console meter. RMS of speech sits roughly in 0..0.3. */
function Meter({ level }: { level: number }) {
  const lit = Math.round(Math.min(1, Math.sqrt(level / 0.3)) * SEGMENTS);
  return (
    <span className="meter" aria-hidden>
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <i key={i} className={`${i < lit ? "on" : ""} ${i >= 8 ? "hot" : ""} ${i >= 11 ? "peak" : ""}`} />
      ))}
    </span>
  );
}

const captureLabel: Record<SourceStatus["capture"], string> = {
  off: "Off",
  starting: "Starting…",
  capturing: "Live",
  error: "Problem",
};

export function SourcePill({
  name,
  source,
  st,
  level,
  idle,
  idleEnabled,
}: {
  name: string;
  source: Source;
  st: SourceStatus;
  level?: number;
  idle?: boolean;
  idleEnabled?: boolean;
}) {
  if (idle) {
    return (
      <span className="strip" data-source={source} title="Status while no meeting is running">
        <span className="ch">{name}</span>
        <span className="st">{idleEnabled ? "Standby" : "Disabled"}</span>
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
    <span className={`strip tone-${tone}`} title={title} data-source={source}>
      <span className="ch">{name}</span>
      <span className="st">{st.enabled ? captureLabel[st.capture] : "Disabled"}</span>
      {st.capture === "capturing" && <Meter level={level ?? 0} />}
    </span>
  );
}

export function PrivacyPills({
  status,
  llmHost,
  llmLocal,
  auto,
}: {
  status: MeetingStatus;
  llmHost: string;
  llmLocal: boolean;
  auto?: boolean;
}) {
  const running = status.state === "running";
  return (
    <>
      {running && (
        <span className={`route ${status.audio_to_cloud ? "cloud" : "local"}`} title="Where meeting audio goes">
          audio → <b>{status.audio_to_cloud ? `${status.stt_host ?? "cloud"} · cloud` : "this device"}</b>
        </span>
      )}
      <span
        className={`route ${llmLocal ? "local" : "cloud"}`}
        title={auto ? "Auto-assist sends what others say to the AI as they speak" : "Where text is sent when you use an AI action"}
      >
        ai text → <b>{llmLocal ? "this device" : `${llmHost} · cloud`}</b> · {auto ? "automatic" : "on request"}
      </span>
      {running && status.recording_audio && <span className="route rec-disk">● recording audio to disk</span>}
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
