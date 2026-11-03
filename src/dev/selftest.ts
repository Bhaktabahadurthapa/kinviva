// Development-only UI self-test. Enabled only when Vite runs with
// VITE_SELFTEST=1; it is compiled out of production builds. It clicks the
// real buttons so the real UI and command paths run, while a person or script
// plays audio. Progress is shown in the window title for screenshots.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../lib/api";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function clickButton(text: string) {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`button "${text}" not found`);
  (b as HTMLButtonElement).click();
}

async function until(pred: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await wait(250);
  }
  return false;
}

export async function runSelfTest(mode: string) {
  const w = getCurrentWindow();
  const step = (s: string) => w.setTitle(`MeetingLens — selftest: ${s}`);
  if (mode === "auto") {
    // Hands-free check: start, then wait for automatic notes with no clicks.
    await wait(1500);
    clickButton("Live");
    clickButton("Start meeting");
    await until(() => !!document.querySelector(".rec"), 15000);
    await step("listening");
    const answered = await until(
      () => !!document.querySelector(".simple-answer .ai-rich") && !document.querySelector(".simple-stream .caret, .simple-stream .thinking"),
      90000,
    );
    await step(answered ? "auto-answered" : "auto-timeout");
    await wait(4000);
    clickButton("Stop");
    await until(() => !document.querySelector(".rec"), 20000);
    return step("done");
  }
  if (mode === "tour") {
    // Visit each screen and pause so it can be captured.
    for (const tab of ["Documents", "Settings", "History", "Live"]) {
      await wait(1200);
      clickButton(tab);
      if (tab === "History") {
        await wait(600);
        (document.querySelector(".history-list li button") as HTMLButtonElement | null)?.click();
      }
      await wait(900);
      await step(`tab-${tab.toLowerCase()}`);
      await wait(2500);
    }
    return step("tour-done");
  }
  if (mode === "history") {
    // After a restart: show saved meetings without starting anything.
    await wait(1500);
    clickButton("History");
    await wait(1200);
    (document.querySelector(".history-list li button") as HTMLButtonElement | null)?.click();
    await wait(1500);
    return step("history");
  }
  try {
    await wait(1500);
    clickButton("Live");
    await step("start");
    clickButton("Start meeting");
    await until(() => !!document.querySelector(".rec"), 15000);
    await step("listening");
    // Audio is played externally during this window.
    await until(() => document.querySelectorAll(".transcript .line:not(.partial)").length > 0, 40000);
    await step("transcribed");
    await wait(1500);
    clickButton("Explain");
    clickButton("Suggest reply");
    await until(() => [...document.querySelectorAll(".panel")].every((p) => !p.querySelector(".caret")), 30000);
    await wait(1500);
    await step("answered");
    await api.toggleOverlay();
    await wait(6000);
    clickButton("Stop");
    await until(() => !document.querySelector(".rec"), 20000);
    await step("stopped");
    await wait(1500);
    clickButton("History");
    await wait(1200);
    (document.querySelector(".history-list li button") as HTMLButtonElement | null)?.click();
    await wait(1500);
    await step("done");
  } catch (e) {
    await step(`FAILED ${String(e)}`);
  }
}
