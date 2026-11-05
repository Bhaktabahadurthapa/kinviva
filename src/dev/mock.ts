// Development-only: lets the UI render in a plain browser (open
// http://localhost:1420/?mock) with canned backend answers, so screens can be
// checked without the desktop shell. Nothing here runs in a production build
// or inside the real app.
if (import.meta.env.DEV && typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window) && location.search.includes("mock")) {
  const settings = {
    onboarded: true, capture_mic: true, capture_system: true, mic_device: null, save_audio: false,
    stt_provider: "whisper_native", deepgram_model: "nova-3", deepgram_endpoint: "wss://api.deepgram.com/v1/listen",
    language: "en", whisper_cli_path: "whisper-cli", whisper_model_path: "", llm_base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    llm_model: "gemini-3.8-flash", llm_use_api_key: true, llm_temperature: 0.3, llm_reasoning: "auto", context_chars: 6000, use_documents: true, web_search: false,
    question_detection: false, question_cooldown_secs: 20, auto_assist: "explain_reply", auto_min_words: 6,
    overlay_content_protection: false, overlay_on_minimize: true, screen_auto: false,
    shortcuts: { toggle_meeting: "CommandOrControl+Shift+M", toggle_overlay: "CommandOrControl+Shift+O", suggest_reply: "CommandOrControl+Shift+R", explain: "CommandOrControl+Shift+E", screen_help: "CommandOrControl+Shift+S" },
  };
  const viewLabel = new URLSearchParams(location.search).get("view") ?? "main";
  const answers: Record<string, unknown> = {
    get_settings: settings,
    save_settings: { shortcut_errors: [] },
    list_input_devices: [],
    speech_engines: { native_available: true },
    list_models: ["models/gemini-3.8-flash", "models/gemini-3.5-flash-lite"],
    interview_skills: [
      { category: "cloud_devops", name: "cloud-devops-interview", description: "Coach answers to Cloud and DevOps interview questions.", error: null },
      { category: "system_design", name: "system-design-interview", description: "Coach system design answers.", error: null },
      { category: "ai_engineering", name: "ai-engineering-interview", description: "Coach AI engineering answers.", error: null },
      { category: "coding", name: "coding-interview", description: "Coach coding answers in Python, Java or C++.", error: null },
    ],
    interview_run: "mock-request",
    interview_saved_count: 3,
    list_courses: [{ id: "os", name: "Operating Systems", code: "CS350", term: "Fall", created_at: 1, resources: 2 }],
    architecture_list: [],
    architecture_save: null,
    architecture_write_file: null,
    architecture_generate: {
      title: "Web app on AWS", diagram: "flowchart", illustrative: false, confidence: "medium",
      components: [
        { id: "n1", label: "AWS load balancer", kind: "loadbalancer", evidence: "mentioned" },
        { id: "n2", label: "Ingress controller", kind: "ingress", evidence: "mentioned" },
        { id: "n3", label: "Kubernetes services", kind: "service", evidence: "mentioned" },
        { id: "n4", label: "PostgreSQL", kind: "database", evidence: "verified" },
        { id: "n5", label: "Redis cache", kind: "cache", evidence: "inferred" },
      ],
      relations: [
        { from: "n1", to: "n2", label: "HTTPS", evidence: "mentioned" },
        { from: "n2", to: "n3", label: "", evidence: "mentioned" },
        { from: "n3", to: "n4", label: "SQL", evidence: "verified" },
        { from: "n3", to: "n5", label: "", evidence: "inferred" },
      ],
      explanation: "Visitors reach the app through a load balancer. It passes them to the ingress controller, which sends each request to the right service inside Kubernetes. The services keep their data in PostgreSQL.",
      concerns: [{ kind: "unknown", text: "Nobody said how the database is backed up." }, { kind: "failure_point", text: "One load balancer is a single point of failure." }],
      references: ["uses an AWS load balancer"],
    },
    list_meetings: [],
    get_meeting: { meeting: { id: "demo-1", title: "Meeting Nov 5, 09:21" }, segments: [{ id: 1 }] },
    list_documents: [
      { id: "d1", name: "week2-scheduling.pdf", kind: "pdf", chars: 9000, chunks: 12, active: true, created_at: 1, course_id: "os", week: 2 },
      { id: "d2", name: "syllabus.md", kind: "md", chars: 1200, chunks: 2, active: true, created_at: 1, course_id: "os", week: null },
      { id: "d3", name: "my-notes.txt", kind: "txt", chars: 800, chunks: 1, active: true, created_at: 1, course_id: null, week: null },
    ],
    app_info: { version: "dev", data_dir: "(mock)", os: "macos", schema_version: 1 },
    secret_status: { llm_api_key: false },
    get_snapshot: {
      status: {
        state: "idle", meeting_id: null, title: null, started_at: null,
        mic: { enabled: true, capture: "off", stt: "idle", device: null, message: null }, system: { enabled: true, capture: "off", stt: "idle", device: null, message: null },
        stt_provider: "whisper_native", audio_to_cloud: false, stt_host: null, recording_audio: false,
        context_meeting_id: null, context_is_demo: false,
      },
      transcript: { finals: [], partials: {} }, notes: "", ai: {},
    },
  };
  // Event bus so scenes can push live events (used for website screenshots).
  const callbacks = new Map<number, (e: unknown) => void>();
  const listeners = new Map<string, number[]>();
  let nextId = 1;
  const emit = (event: string, payload: unknown) => (listeners.get(event) ?? []).forEach((id) => callbacks.get(id)?.({ event, id, payload }));
  (window as unknown as Record<string, unknown>).__mlEmit = emit;
  (window as unknown as Record<string, unknown>).__mlListeners = () => listeners.size;
  (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: viewLabel }, currentWebview: { label: viewLabel, windowLabel: viewLabel } },
    transformCallback: (cb: (e: unknown) => void) => {
      const id = nextId++;
      callbacks.set(id, cb);
      return id;
    },
    invoke: async (cmd: string, args?: { event?: string; handler?: number }) => {
      if (cmd === "plugin:event|listen" && args?.event && args.handler) {
        listeners.set(args.event, [...(listeners.get(args.event) ?? []), args.handler]);
        return args.handler;
      }
      return cmd in answers ? answers[cmd] : null;
    },
  };
  const params = new URLSearchParams(location.search);
  if (params.get("theme")) {
    localStorage.setItem("ml.appearance", JSON.stringify({ theme: params.get("theme"), size: "normal", font: "system" }));
  }
  if (params.get("scene")) {
    import("./scenes").then((m) => m.runScene(params.get("scene")!, emit));
  }
}
export {};
