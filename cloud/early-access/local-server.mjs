// Local stand-in for Cloudflare, for trying the form on your own computer. Not used in production.
// Usage: node cloud/early-access/local-server.mjs [port] [website-origin]
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "./worker.js";

const port = Number(process.argv[2] || 8787);
const origin = process.argv[3] || "http://localhost:8000";
const file = process.env.EA_DB || ":memory:";
const db = new DatabaseSync(file);
db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
const wrap = (sql) => ({ bind: (...a) => ({ run: async () => db.prepare(sql).run(...a), first: async () => db.prepare(sql).get(...a) ?? null }) });
const env = { DB: { prepare: wrap }, ALLOWED_ORIGIN: origin, RATE_SALT: "local-only-salt-not-for-production-use" };

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await worker.fetch(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: { ...req.headers, "cf-connecting-ip": req.socket.remoteAddress }, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log(`Early Access local server on http://localhost:${port} (allows ${origin})`));
