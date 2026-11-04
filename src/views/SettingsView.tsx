import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api, errorText } from "../lib/api";
import type { DeviceInfo, Settings, Shortcuts } from "../lib/types";

const PRESETS = [
  { label: "OpenAI", url: "https://api.openai.com/v1", key: true },
  { label: "Google Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai", key: true },
  { label: "OpenRouter (many models)", url: "https://openrouter.ai/api/v1", key: true },
  { label: "Groq", url: "https://api.groq.com/openai/v1", key: true },
  { label: "Mistral", url: "https://api.mistral.ai/v1", key: true },
  { label: "DeepSeek", url: "https://api.deepseek.com/v1", key: true },
  { label: "Together", url: "https://api.together.xyz/v1", key: true },
  { label: "xAI", url: "https://api.x.ai/v1", key: true },
  { label: "Ollama (local)", url: "http://localhost:11434/v1", key: false },
  { label: "LM Studio (local)", url: "http://localhost:1234/v1", key: false },
];

function KeyField({ name, label, has, onChange }: { name: string; label: string; has: boolean; onChange: () => void }) {
  const [v, setV] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="field">
      <label>{label}</label>
      <div className="row">
        <input
          type="password"
          value={v}
          autoComplete="off"
          onChange={(e) => setV(e.target.value)}
          placeholder={has ? "Saved in system keychain — enter a new key to replace" : "Paste your key"}
        />
        <button
          className="btn btn-sm"
          disabled={!v.trim()}
          onClick={async () => {
            try {
              await api.setSecret(name, v);
              setV("");
              setErr(null);
              onChange();
            } catch (e) {
              setErr(errorText(e));
            }
          }}
        >
          Save
        </button>
        {has && (
          <button className="btn btn-ghost btn-sm" onClick={() => api.deleteSecret(name).then(onChange)}>
            Remove
          </button>
        )}
      </div>
      <small className={has ? "ok" : ""}>{has ? "✓ Stored in the OS credential store" : "Not set"}</small>
      {err && <small className="bad">{err}</small>}
    </div>
  );
}

export function SettingsView({ onError, onSaved }: { onError: (m: string) => void; onSaved: (s: Settings) => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [secrets, setSecrets] = useState<Record<string, boolean>>({});
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [nativeAvailable, setNativeAvailable] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [modelErr, setModelErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [info, setInfo] = useState<{ data_dir: string; version: string; schema_version: number } | null>(null);

  const loadSecrets = () => api.secretStatus().then(setSecrets).catch((e) => onError(errorText(e)));
  useEffect(() => {
    api.getSettings().then(setS).catch((e) => onError(errorText(e)));
    api.listInputDevices().then(setDevices).catch(() => {});
    api.speechEngines().then((e) => setNativeAvailable(e.native_available)).catch(() => {});
    api.appInfo().then(setInfo).catch(() => {});
    loadSecrets();
  }, []);
  if (!s) return <div className="page">Loading…</div>;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const setSc = (k: keyof Shortcuts, v: string) => setS({ ...s, shortcuts: { ...s.shortcuts, [k]: v } });

  const sttReady =
    s.stt_provider === "deepgram" ? !!secrets.deepgram_api_key : !!s.whisper_model_path.trim();
  const aiReady = !!s.llm_model.trim() && (!s.llm_use_api_key || !!secrets.llm_api_key);
  const audioReady = s.capture_mic || s.capture_system;

  const persist = async (next: Settings) => {
    try {
      const r = await api.saveSettings(next);
      setS(next);
      onSaved(next);
      setSaved(r.shortcut_errors.length ? r.shortcut_errors.join(" ") : "Settings saved.");
    } catch (e) {
      onError(errorText(e));
    }
  };

  const llmLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(s.llm_base_url.trim());

  const fetchModels = async () => {
    setModels(null);
    setModelErr(null);
    setFetching(true);
    try {
      // Some providers (Gemini) list ids as "models/<name>" but expect "<name>" in requests.
      setModels((await api.listModels(s.llm_base_url, s.llm_use_api_key)).map((m) => m.replace(/^models\//, "")));
    } catch (e) {
      setModelErr(errorText(e));
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="page settings">
      <header className="page-head">
        <h1>{s.onboarded ? "Settings" : "Set up MeetingLens"}</h1>
        <button className="btn btn-primary" onClick={() => persist(s)}>
          Save
        </button>
      </header>

      {!s.onboarded && (
        <div className="setup">
          <p>Three steps, then you're ready. Keys are stored in your system keychain, not in MeetingLens files.</p>
          <ol>
            <li className={audioReady ? "done" : ""}>Choose audio sources</li>
            <li className={sttReady ? "done" : ""}>Set up speech recognition</li>
            <li className={aiReady ? "done" : ""}>Set up the AI provider</li>
          </ol>
          <button className="btn btn-primary" disabled={!(audioReady && sttReady && aiReady)} onClick={() => persist({ ...s, onboarded: true })}>
            Finish setup
          </button>
        </div>
      )}
      {saved && <div className="banner banner-ok">{saved}</div>}

      <section className="card">
        <h2>1 · Audio</h2>
        <label className="check">
          <input type="checkbox" checked={s.capture_system} onChange={(e) => set("capture_system", e.target.checked)} />
          Capture system audio (other participants, labelled “Them”)
        </label>
        <p className="hint">
          macOS: uses ScreenCaptureKit and needs Screen &amp; System Audio Recording permission. Windows: WASAPI loopback of the default output
          device. Works with any app whose sound plays through this computer; headsets with their own audio path may not be captured.
        </p>
        <label className="check">
          <input type="checkbox" checked={s.capture_mic} onChange={(e) => set("capture_mic", e.target.checked)} />
          Capture my microphone (labelled “Me”)
        </label>
        <div className="field">
          <label>Microphone</label>
          <select value={s.mic_device ?? ""} onChange={(e) => set("mic_device", e.target.value || null)}>
            <option value="">System default</option>
            {devices.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}
                {d.is_default ? " (default)" : ""}
              </option>
            ))}
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={s.save_audio} onChange={(e) => set("save_audio", e.target.checked)} />
          Save audio recordings (WAV) with meetings — off by default
        </label>
      </section>

      <section className="card">
        <h2>2 · Speech recognition</h2>
        <div className="field">
          <label>Provider</label>
          <select value={s.stt_provider} onChange={(e) => set("stt_provider", e.target.value as Settings["stt_provider"])}>
            <option value="whisper_native" disabled={!nativeAvailable && s.stt_provider !== "whisper_native"}>
              Built-in whisper.cpp engine (local, fastest){nativeAvailable ? "" : " — not in this build"}
            </option>
            <option value="whisper_cli">whisper.cpp command-line tool (local)</option>
            <option value="deepgram">Deepgram streaming (cloud)</option>
          </select>
        </div>
        {s.stt_provider === "deepgram" ? (
          <>
            <p className="hint">Meeting audio is streamed to Deepgram while a meeting runs. Partial results appear as people speak.</p>
            <KeyField name="deepgram_api_key" label="Deepgram API key" has={!!secrets.deepgram_api_key} onChange={loadSecrets} />
            <div className="grid2">
              <div className="field">
                <label>Model</label>
                <input value={s.deepgram_model} onChange={(e) => set("deepgram_model", e.target.value)} />
              </div>
              <div className="field">
                <label>Language</label>
                <input value={s.language} onChange={(e) => set("language", e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label>Endpoint</label>
              <input value={s.deepgram_endpoint} onChange={(e) => set("deepgram_endpoint", e.target.value)} />
            </div>
          </>
        ) : (
          <>
            {s.stt_provider === "whisper_native" ? (
              <p className="hint">
                Audio stays on this computer. MeetingLens includes its own whisper.cpp engine that keeps the model loaded, so text appears quickly and
                nothing else needs installing. You only choose a ggml model file (for example <code>ggml-small.en.bin</code>, more accurate than
                base). {!nativeAvailable && <b>This build does not include the engine; pick the command-line tool instead.</b>}
              </p>
            ) : (
              <>
                <p className="hint">
                  Audio stays on this computer. Requires a whisper.cpp <code>whisper-cli</code> binary and a ggml model file you download yourself.
                  Text appears after short pauses rather than word by word.
                </p>
                <div className="field">
                  <label>whisper-cli path</label>
                  <input value={s.whisper_cli_path} onChange={(e) => set("whisper_cli_path", e.target.value)} />
                </div>
              </>
            )}
            <div className="field">
              <label>Model file (.bin)</label>
              <div className="row">
                <input value={s.whisper_model_path} onChange={(e) => set("whisper_model_path", e.target.value)} placeholder="e.g. ggml-base.en.bin" />
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    const p = await open({ filters: [{ name: "ggml model", extensions: ["bin"] }] });
                    if (typeof p === "string") set("whisper_model_path", p);
                  }}
                >
                  Browse…
                </button>
              </div>
            </div>
            <div className="field">
              <label>Language</label>
              <input value={s.language} onChange={(e) => set("language", e.target.value)} />
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>3 · AI provider</h2>
        <p className="hint">Any OpenAI-compatible Chat Completions endpoint. Meeting text is sent to this provider when you press an action or when Auto-assist answers; use a local model to keep it on this computer.</p>
        <div className="row presets">
          {PRESETS.map((p) => (
            <button key={p.url} className="btn btn-ghost btn-sm" aria-pressed={s.llm_base_url === p.url} onClick={() => setS({ ...s, llm_base_url: p.url, llm_use_api_key: p.key })}>
              {p.label}
            </button>
          ))}
          <button className="btn btn-ghost btn-sm" aria-pressed={!PRESETS.some((p) => p.url === s.llm_base_url)} onClick={() => setS({ ...s, llm_base_url: "", llm_use_api_key: true })}>
            Other (type your own)
          </button>
        </div>
        <p className="hint">Any other service works too: paste its OpenAI-compatible base URL (the part before <code>/chat/completions</code>), your API key, and a model name from its docs.</p>
        <div className="field">
          <label htmlFor="llm-base-url">Base URL</label>
          <input id="llm-base-url" value={s.llm_base_url} placeholder="https://api.example.com/v1" spellCheck={false} autoComplete="off" onChange={(e) => set("llm_base_url", e.target.value)} />
          <small className={s.llm_base_url.trim() ? (llmLocal ? "ok" : "") : "bad"}>
            {!s.llm_base_url.trim()
              ? "Enter the provider's base URL."
              : llmLocal
                ? "Runs on this computer — meeting text stays here."
                : "Cloud provider — meeting text is sent to it. Use a paid/business plan if the content is private."}
          </small>
        </div>
        <label className="check">
          <input type="checkbox" checked={s.llm_use_api_key} onChange={(e) => set("llm_use_api_key", e.target.checked)} />
          This provider needs an API key
        </label>
        {s.llm_use_api_key && <KeyField name="llm_api_key" label="AI provider API key" has={!!secrets.llm_api_key} onChange={loadSecrets} />}
        <div className="field">
          <label htmlFor="llm-model">Model</label>
          <div className="row">
            <input id="llm-model" list="models" spellCheck={false} autoComplete="off" value={s.llm_model} onChange={(e) => set("llm_model", e.target.value)} placeholder="Choose or type a model name" />
            <datalist id="models">{models?.map((m) => <option key={m} value={m} />)}</datalist>
            <button className="btn btn-sm" onClick={fetchModels} disabled={fetching || !s.llm_base_url.trim()}>
              {fetching ? "Fetching…" : "Fetch models"}
            </button>
          </div>
          {models && <small className="ok">{models.length} models available — pick one from the list.</small>}
          {modelErr && <small className="bad">{modelErr}</small>}
        </div>
        <div className="field narrow">
          <label htmlFor="llm-reasoning">Thinking time (faster = less)</label>
          <select id="llm-reasoning" value={s.llm_reasoning} onChange={(e) => set("llm_reasoning", e.target.value as Settings["llm_reasoning"])}>
            <option value="auto">Auto (fast on Gemini)</option>
            <option value="off">Provider default</option>
            <option value="minimal">Minimal — fastest</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High — slowest, deepest</option>
          </select>
          <small>Only used by models that think before answering. If a model does not support it, MeetingLens retries without it.</small>
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="llm-temp">Temperature</label>
            <input id="llm-temp" type="number" step="0.1" min="0" max="2" value={s.llm_temperature} onChange={(e) => set("llm_temperature", Number(e.target.value))} />
          </div>
          <div className="field">
            <label htmlFor="llm-ctx">Transcript context (characters)</label>
            <input id="llm-ctx" type="number" min="500" step="500" value={s.context_chars} onChange={(e) => set("context_chars", Number(e.target.value))} />
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={s.use_documents} onChange={(e) => set("use_documents", e.target.checked)} />
          Include matching passages from context documents
        </label>
      </section>

      <section className="card">
        <h2>Assist</h2>
        <div className="field narrow">
          <label>Automatic help when others speak</label>
          <select value={s.auto_assist} onChange={(e) => set("auto_assist", e.target.value as Settings["auto_assist"])}>
            <option value="explain_reply">Explain + answer questions</option>
            <option value="explain">Explain only</option>
            <option value="off">Off (buttons only)</option>
          </select>
        </div>
        <p className="hint">
          When on, each finished sentence from other participants is sent to your AI provider and explained in simple words beside the
          transcript; questions also get a draft answer. Nothing is ever said or typed into the meeting. With a cloud provider this sends
          the conversation continuously.
        </p>
        <div className="field narrow">
          <label>Ignore sentences shorter than (words)</label>
          <input type="number" min="1" value={s.auto_min_words} onChange={(e) => set("auto_min_words", Number(e.target.value))} />
        </div>
        <label className="check">
          <input type="checkbox" checked={s.question_detection} onChange={(e) => set("question_detection", e.target.checked)} />
          Highlight questions from other participants (shows a prompt; never answers automatically)
        </label>
        <div className="field narrow">
          <label>Minimum seconds between highlights</label>
          <input type="number" min="0" value={s.question_cooldown_secs} onChange={(e) => set("question_cooldown_secs", Number(e.target.value))} />
        </div>
      </section>

      <section className="card">
        <h2>Overlay &amp; shortcuts</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={s.overlay_content_protection}
            onChange={(e) => set("overlay_content_protection", e.target.checked)}
          />
          Ask the OS to exclude the overlay from screen capture
        </label>
        <p className="hint">
          Best effort only. It relies on the OS window-sharing flag; some capture methods, apps or OS versions ignore it. Always check before sharing your
          screen.
        </p>
        <div className="grid2">
          {(
            [
              ["toggle_meeting", "Start / stop meeting"],
              ["toggle_overlay", "Show / hide overlay"],
              ["suggest_reply", "Suggest reply"],
              ["explain", "Explain"],
            ] as [keyof Shortcuts, string][]
          ).map(([k, label]) => (
            <div className="field" key={k}>
              <label>{label}</label>
              <input value={s.shortcuts[k]} onChange={(e) => setSc(k, e.target.value)} placeholder="e.g. CommandOrControl+Shift+M" />
            </div>
          ))}
        </div>
        <p className="hint">Use names like CommandOrControl, Shift, Alt plus a key. Leave blank to disable.</p>
      </section>

      {info && (
        <section className="card about">
          <h2>About</h2>
          <p>
            MeetingLens {info.version} · data stored locally in <code>{info.data_dir}</code> · schema v{info.schema_version}
          </p>
          <p className="hint">No telemetry. Meeting content and API keys are not written to logs.</p>
        </section>
      )}
    </div>
  );
}
