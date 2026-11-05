// Copies Excalidraw's fonts next to the app so the board works offline and under the app's CSP.
// The large CJK handwriting font (Xiaolai, about 12 MB) is left out; other fonts are kept.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
const from = "node_modules/@excalidraw/excalidraw/dist/prod/fonts";
const to = "public/excalidraw-assets/fonts";
if (!existsSync(from)) process.exit(0);
rmSync("public/excalidraw-assets", { recursive: true, force: true });
mkdirSync(to, { recursive: true });
for (const d of readdirSync(from)) if (d !== "Xiaolai") cpSync(`${from}/${d}`, `${to}/${d}`, { recursive: true });
