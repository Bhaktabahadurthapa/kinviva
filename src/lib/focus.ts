import { useEffect, useState } from "react";

/** Full-screen watching: the bars around the video are hidden and the window can fill the display. */
export const isFocus = () => document.documentElement.hasAttribute("data-focus");

export function setFocus(on: boolean): void {
  if (on) document.documentElement.setAttribute("data-focus", "1");
  else document.documentElement.removeAttribute("data-focus");
  // Only the bars around the video hide. The window itself keeps its size, so leaving never moves or shrinks it.
}

/** True while full-screen watching is on, from anywhere in the app. */
export function useFocus(): boolean {
  const [on, setOn] = useState(isFocus());
  useEffect(() => {
    const mo = new MutationObserver(() => setOn(isFocus()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-focus"] });
    return () => mo.disconnect();
  }, []);
  return on;
}
