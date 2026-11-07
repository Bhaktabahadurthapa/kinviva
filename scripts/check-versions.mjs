// Fails when the app version differs between package.json, tauri.conf.json, Cargo.toml (and the git tag, when run on a tag).
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8")).version;
const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
const cargo = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync("src-tauri/Cargo.toml", "utf8"))?.[1];
const lock = JSON.parse(readFileSync("package-lock.json", "utf8")).version;
const found = { "package.json": pkg, "tauri.conf.json": tauri, "Cargo.toml": cargo, "package-lock.json": lock };
const tag = process.env.GITHUB_REF_NAME;
if (tag && /^v\d/.test(tag)) found[`git tag ${tag}`] = tag.slice(1);

const versions = new Set(Object.values(found));
for (const [k, v] of Object.entries(found)) console.log(`${k.padEnd(20)} ${v}`);
if (versions.size !== 1) {
  console.error("Version mismatch: make every file use the same version before releasing.");
  process.exit(1);
}
console.log("Versions agree.");
