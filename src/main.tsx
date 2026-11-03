import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { inTauri } from "./lib/api";
import App from "./App";
import Overlay from "./Overlay";
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/fraunces/full-italic.css";
import "@fontsource-variable/instrument-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";

const label = inTauri ? getCurrentWindow().label : new URLSearchParams(location.search).get("view") ?? "main";
document.documentElement.dataset.window = label;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{label === "overlay" ? <Overlay /> : <App />}</React.StrictMode>,
);

if (import.meta.env.DEV && import.meta.env.VITE_SELFTEST && label === "main") {
  import("./dev/selftest").then((m) => m.runSelfTest(import.meta.env.VITE_SELFTEST));
}
