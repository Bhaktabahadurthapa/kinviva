import React from "react";
import ReactDOM from "react-dom/client";
import "./dev/mock";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { inTauri } from "./lib/api";
import App from "./App";
import Overlay from "./Overlay";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/400-italic.css";
import "@fontsource/atkinson-hyperlegible/700.css";
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
