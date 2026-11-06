import { getCurrentWindow } from "@tauri-apps/api/window";

/** Full-screen watching: the bars around the video are hidden and the window can fill the display. */
export const isFocus = () => document.documentElement.hasAttribute("data-focus");

export async function setFocus(on: boolean) {
  if (on) document.documentElement.setAttribute("data-focus", "1");
  else document.documentElement.removeAttribute("data-focus");
  try {
    await getCurrentWindow().setFullscreen(on);
  } catch {
    /* the bars still hide when the window cannot go full screen */
  }
}
