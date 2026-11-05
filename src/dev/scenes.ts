// Development-only scripted scenes for the browser mock, used to take the website
// screenshots from the real interface (http://localhost:1420/?mock&scene=live).
type Emit = (event: string, payload: unknown) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const click = (label: string, sel = ".rail-btn") => [...document.querySelectorAll<HTMLElement>(sel)].find((b) => b.textContent?.trim() === label)?.click();

const slot = (over: Record<string, unknown>) => ({
  request_id: "r", action: "explain", state: "done", text: "", error: null, sources: [], destination: null, question: null, auto: true, segment_id: null, web: [], ...over,
});

const LINES: { id: number; source: "system" | "mic"; text: string; at: number }[] = [
  { id: 1, source: "system", at: 12, text: "Thanks for joining. Before we decide anything, can you walk us through how the new export feature affects onboarding?" },
  { id: 2, source: "mic", at: 26, text: "Sure, give me a second to pull that up." },
  { id: 3, source: "system", at: 41, text: "We also saw activation drop about ten percent after we moved the tutorial behind the sign-up step." },
  { id: 4, source: "system", at: 58, text: "How would you design a multi-tenant CI/CD platform that keeps teams isolated and costs under control?" },
];

const NOTES: Record<number, { meaning: string; answer?: string }> = {
  1: { meaning: "Key points:\n- They want to know how the export feature changes the first steps for new users.\n- The decision waits for your explanation.\nHard words:\n- onboarding: the first steps a new user goes through" },
  3: { meaning: "Key points:\n- Fewer people finished setup after the tutorial moved behind sign-up.\n- The drop is about 10 out of every 100 people.\nHard words:\n- activation: a new user doing the first useful thing in the product" },
  4: {
    meaning: "",
    answer:
      "YOU COULD SAY\nI would give every team its own walled-off space, with its own build workers and secrets, so one team can never touch another. Then I would cap what each space can use and show each team its bill, which keeps cost under control. The tradeoff is more setup per team, but it is much safer.\n\nKEY TAKEAWAY\nSeparate spaces keep teams safe; limits and bills keep cost low.\n\nHARD WORDS\nmulti-tenant: many teams sharing one system\nCI/CD: tools that build and ship code automatically\nisolation: keeping things apart so they cannot affect each other\n\nSOURCES\n- General knowledge",
  },
};

const status = (running: boolean) => ({
  state: running ? "running" : "idle", meeting_id: "demo", title: "Product sync · onboarding", started_at: Date.now() - 134000,
  mic: { enabled: true, capture: "capturing", stt: "listening", device: "MacBook Air Microphone", message: null },
  system: { enabled: true, capture: "capturing", stt: "listening", device: "System audio", message: null },
  stt_provider: "whisper_native", audio_to_cloud: false, stt_host: null, recording_audio: false, paused: false,
  context_meeting_id: null, context_is_demo: false, session: { kind: "general", course_id: null, course_name: null, week: null },
});

async function live(emit: Emit) {
  emit("meeting-status", status(true));
  emit("audio-levels", { system: 0.55, mic: 0.2 });
  for (const l of LINES) {
    emit("transcript-final", { id: l.id, source: l.source, text: l.text, start_ms: l.at * 1000, end_ms: l.at * 1000 + 4000 });
  }
  for (const [id, n] of Object.entries(NOTES)) {
    if (n.meaning) emit("ai-event", slot({ slot: "meaning", request_id: `m${id}`, action: "explain", text: n.meaning, segment_id: Number(id) }));
    if (n.answer) emit("ai-event", slot({ slot: "reply", request_id: `a${id}`, action: "suggest", text: n.answer, segment_id: Number(id) }));
  }
}

async function interview(emit: Emit) {
  click("Interview");
  await sleep(500);
  const ta = document.querySelector<HTMLTextAreaElement>(".iv-body textarea");
  if (ta) {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    set.call(ta, "Design a multi-tenant CI/CD platform for internal teams across AWS and Azure. Focus on isolation, security and cost.");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  await sleep(200);
  [...document.querySelectorAll<HTMLElement>(".iv-body .btn-primary")].find((b) => /Explain answer/.test(b.textContent ?? ""))?.click();
  await sleep(300);
  emit("interview-event", {
    request_id: "mock-request", category: "cloud_devops", mode: "explain", skill: "cloud-devops-interview", state: "done", received_chars: 900, fallback_text: null, error: null,
    result: {
      kind: "answer",
      say_it: "I would give each team its own walled-off space, with separate build workers and secrets, on both AWS and Azure. Then I would set limits and show each team its bill. The tradeoff is more setup, but it is safer and cheaper to run.",
      understand_it: "Clarify scale, compliance and who owns pipelines.\nIsolation: one namespace and one cloud account or subscription per team, with its own roles and secrets.\nSecurity: short-lived credentials, signed builds, and a policy check before every deploy.\nCost: quotas per team, auto-scaling build workers, and a monthly report by team.",
      code: null,
      tradeoffs: ["Tradeoff: more setup per team for much stronger isolation.", "Assumption: teams already use Git for their code."],
      hard_words: ["multi-tenant: many teams sharing one system", "CI/CD: tools that build and ship code automatically", "namespace: a named room inside a cluster"],
      follow_up: "How would you stop one team's builds from slowing everyone else down?",
    },
  });
}

async function screen(emit: Emit) {
  await live(emit);
  await sleep(300);
  emit("screen-event", {
    request_id: "s", state: "done", error: null,
    text:
      "WHAT I SEE\nA terminal showing the command kubectl rollout undo deployment/api.\n\nEXPLANATION\nThis command goes back to the version before the latest one. Kubernetes keeps old versions, so it can switch back fast. One risk: it does not fix the bug, it only hides it.\n\nYOU COULD SAY\nThis command rolls the API back to the last working version. I would use it right away if the new release breaks users, then find the real cause calmly.\n\nHARD WORDS\nrollout: sending a new version to users\nKubernetes: a system that runs apps in containers",
  });
}

export async function runScene(name: string, emit: Emit) {
  // Wait until the app has subscribed to every event, or early events are lost.
  for (let i = 0; i < 80 && ((window as unknown as { __mlListeners?: () => number }).__mlListeners?.() ?? 0) < 8; i++) await sleep(100);
  await sleep(300);
  if (name === "live") await live(emit);
  if (name === "interview") await interview(emit);
  if (name === "screen") await screen(emit);
  if (name === "overlay") {
    // A stand-in for the screen behind the overlay: an interview coding page.
    const bg = document.createElement("div");
    bg.style.cssText = "position:fixed;inset:0;z-index:-1;background:linear-gradient(135deg,#0d1320,#18233a);font-family:-apple-system,Helvetica,Arial,sans-serif;color:#e6ecf8;padding:56px 64px;";
    bg.innerHTML = `<div style="max-width:560px"><div style="font-size:12px;letter-spacing:.08em;color:#8e9cba">LIVE INTERVIEW · SHARED SCREEN</div><h1 style="font-size:34px;margin:10px 0 14px">Two Sum</h1><p style="font-size:17px;line-height:1.55;margin:0 0 18px">Given an array of integers and a target, return the indices of the two numbers that add up to the target. You may assume exactly one solution exists.</p><pre style="background:#0a0f1a;border:1px solid #26334d;color:#d9e3ff;border-radius:10px;padding:18px;font-size:15px;line-height:1.5;margin:0">def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i</pre></div>`;
    document.body.appendChild(bg);
    const ov = document.querySelector<HTMLElement>(".overlay");
    if (ov) ov.style.cssText = "position:fixed;right:48px;top:52px;width:470px;height:640px;height:calc(100% - 104px);max-height:640px;";
    await live(emit);
  }
  if (name === "knowledge") click("Knowledge");
  if (name === "settings") {
    click("Settings");
    await sleep(300);
    click("Appearance", ".settings-tabs button");
  }
  document.documentElement.dataset.scene = "ready";
}
