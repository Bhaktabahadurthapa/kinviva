import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker, { validate, matchOrigin } from "./worker.js";

// A real SQLite database stands in for D1, with the same prepare/bind/run/first shape.
function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  const wrap = (sql) => ({
    bind: (...args) => ({ run: async () => db.prepare(sql).run(...args), first: async () => db.prepare(sql).get(...args) ?? null }),
  });
  return { prepare: wrap, raw: db };
}
const ORIGIN = "https://bhaktathapa.com.np";
const good = { name: "Sam Lee", email: "sam@example.com", use_case: "technical", company: "Acme", consent: true };
const send = (env, body, over = {}) =>
  worker.fetch(new Request("https://api.example/api/early-access", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": "203.0.113.9", ...over.headers }, body: typeof body === "string" ? body : JSON.stringify(body) }), env);
const envOf = () => ({ DB: makeDb(), ALLOWED_ORIGIN: ORIGIN, RATE_SALT: "test-salt-0123456789-abcdef" });

test("validates fields and requires consent", () => {
  assert.equal(validate(good).ok, true);
  assert.equal(validate({ ...good, consent: false }).ok, false);
  assert.equal(validate({ ...good, consent: "yes" }).ok, false);
  assert.equal(validate({ ...good, email: "not-an-email" }).ok, false);
  assert.equal(validate({ ...good, name: "  " }).ok, false);
  assert.equal(validate({ ...good, use_case: "spam" }).ok, false);
  const v = validate({ ...good, name: "A\u0007  B", company: "" });
  assert.equal(v.value.name, "A B");
  assert.equal(v.value.company, null);
});

test("stores a signup with consent time and version, and confirms", async () => {
  const env = envOf();
  const r = await send(env, good);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
  const row = env.DB.raw.prepare("SELECT * FROM signups").get();
  assert.equal(row.email_lower, "sam@example.com");
  assert.equal(row.consent_version, "ea-2026-11-v1");
  assert.ok(row.consent_at.endsWith("Z"));
});

test("a repeated email (any capitalisation) is stored once and gets the same answer", async () => {
  const env = envOf();
  const a = await send(env, good, { headers: { "cf-connecting-ip": "198.51.100.1" } });
  const b = await send(env, { ...good, email: "SAM@Example.com", name: "Other" }, { headers: { "cf-connecting-ip": "198.51.100.2" } });
  assert.deepEqual(await a.json(), await b.json());
  assert.equal(env.DB.raw.prepare("SELECT count(*) AS n FROM signups").get().n, 1);
});

test("rate limits a client after five attempts in an hour and stores only a hash", async () => {
  const env = envOf();
  for (let i = 0; i < 5; i++) assert.equal((await send(env, { ...good, email: `u${i}@example.com` })).status, 200);
  assert.equal((await send(env, { ...good, email: "u6@example.com" })).status, 429);
  const key = env.DB.raw.prepare("SELECT key FROM rate").get().key;
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.ok(!key.includes("203.0.113.9"));
});

test("honeypot, wrong origin, wrong type, oversized and invalid bodies are refused without storing", async () => {
  const env = envOf();
  assert.equal((await send(env, { ...good, website: "http://spam" })).status, 200);
  assert.equal(env.DB.raw.prepare("SELECT count(*) AS n FROM signups").get().n, 0);
  assert.equal((await send(env, good, { headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await send(env, good, { headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await send(env, JSON.stringify({ ...good, company: "x".repeat(5000) }))).status, 413);
  assert.equal((await send(env, "{not json")).status, 400);
  assert.equal((await send(env, { ...good, consent: false })).status, 422);
  assert.equal(env.DB.raw.prepare("SELECT count(*) AS n FROM signups").get().n, 0);
});

test("preflight only allows the website origin, other paths are not found", async () => {
  const env = envOf();
  const ok = await worker.fetch(new Request("https://api.example/api/early-access", { method: "OPTIONS", headers: { origin: ORIGIN } }), env);
  assert.equal(ok.status, 204);
  const bad = await worker.fetch(new Request("https://api.example/api/early-access", { method: "OPTIONS", headers: { origin: "https://evil.example" } }), env);
  assert.equal(bad.status, 403);
  assert.equal((await worker.fetch(new Request("https://api.example/other"), env)).status, 404);
});

test("health check reports configuration and database without revealing data", async () => {
  const env = envOf();
  const r = await worker.fetch(new Request("https://api.example/health"), env);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, configured: true, database: true });
  const bad = await worker.fetch(new Request("https://api.example/health"), { ...env, RATE_SALT: "" });
  assert.equal(bad.status, 503);
  const text = JSON.stringify(await bad.json());
  assert.ok(!text.includes("sam@"));
});

test("a missing secret salt or a database failure gives a safe 503 and stores nothing", async () => {
  const env = envOf();
  const noSalt = await send({ ...env, RATE_SALT: undefined }, good);
  assert.equal(noSalt.status, 503);
  const broken = { ...env, DB: { prepare: () => { throw new Error("db down: secret detail"); } } };
  const r = await send(broken, good);
  assert.equal(r.status, 503);
  assert.ok(!(await r.text()).includes("secret detail"));
  assert.equal(env.DB.raw.prepare("SELECT count(*) AS n FROM signups").get().n, 0);
});

test("bad requests count toward the rate limit, and only the agreed fields are stored", async () => {
  const env = envOf();
  for (let i = 0; i < 5; i++) await send(env, { ...good, consent: false });
  assert.equal((await send(env, good)).status, 429);
  const env2 = envOf();
  await send(env2, { ...good, transcript: "private words", recording: "x", extra: 1 });
  const cols = Object.keys(env2.DB.raw.prepare("SELECT * FROM signups").get()).sort();
  assert.deepEqual(cols, ["company", "consent_at", "consent_version", "email", "email_lower", "id", "name", "use_case"]);
  assert.ok(!JSON.stringify(env2.DB.raw.prepare("SELECT * FROM signups").all()).includes("private words"));
});

test("several website origins can be allowed, and only those", async () => {
  const list = "https://kinviva.tech, https://www.kinviva.tech,https://bhaktathapa.com.np";
  assert.equal(matchOrigin(list, "https://kinviva.tech"), "https://kinviva.tech");
  assert.equal(matchOrigin(list, "https://www.kinviva.tech"), "https://www.kinviva.tech");
  assert.equal(matchOrigin(list, "https://kinviva.tech.evil.example"), null);
  assert.equal(matchOrigin(list, null), null);
  const env = { ...envOf(), ALLOWED_ORIGIN: list };
  const r = await send(env, good, { headers: { origin: "https://kinviva.tech" } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "https://kinviva.tech");
  assert.equal((await send(env, good, { headers: { origin: "https://evil.example" } })).status, 403);
});
