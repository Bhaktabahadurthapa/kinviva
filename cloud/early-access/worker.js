// Kinviva Early Access service: a small serverless worker (Cloudflare Workers + D1 SQL).
// Not deployed. See README.md. Uses only Web APIs, so it also runs under Node for tests.

export const CONSENT_VERSION = "ea-2026-11-v1";
export const USE_CASES = ["meetings", "interviews", "learning", "technical", "team", "other"];
const MAX_BODY = 4096;
const HOURLY_LIMIT = 5;

const MESSAGE = "Thanks for joining Early Access. We'll contact selected participants as access becomes available.";

const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;

/** Checks and cleans the form. Returns { ok: true, value } or { ok: false, error }. */
export function validate(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "Send the form as JSON." };
  const name = clean(body.name, 100);
  const email = clean(body.email, 254);
  const useCase = clean(body.use_case, 40).toLowerCase();
  const company = clean(body.company, 100);
  if (name.length < 1) return { ok: false, error: "Please enter your name." };
  if (!EMAIL.test(email)) return { ok: false, error: "Please enter a valid email address." };
  if (!USE_CASES.includes(useCase)) return { ok: false, error: "Please choose a use case." };
  if (body.consent !== true) return { ok: false, error: "Please tick the consent box to join." };
  return { ok: true, value: { name, email, emailLower: email.toLowerCase(), useCase, company: company || null } };
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function reply(status, payload, origin) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
    },
  });
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch {
      // Never reveal internals or echo the submission. The visitor can simply try again.
      return reply(503, { ok: false, message: "Sign-up is temporarily unavailable. Please try again later." }, env.ALLOWED_ORIGIN || null);
    }
  },
};

async function handle(request, env) {
    const allowed = env.ALLOWED_ORIGIN;
    const origin = request.headers.get("origin");
    const url = new URL(request.url);

    // Health check: confirms the service is configured and the database answers. Reveals no counts or data.
    if (url.pathname === "/health" && request.method === "GET") {
      const configured = Boolean(allowed && env.RATE_SALT && env.RATE_SALT.length >= 16 && env.DB);
      let database = false;
      try { database = Boolean(env.DB && (await env.DB.prepare("SELECT 1 AS ok").bind().first())); } catch { database = false; }
      const ok = configured && database;
      return reply(ok ? 200 : 503, { ok, configured, database });
    }

    if (request.method === "OPTIONS") {
      if (!allowed || origin !== allowed) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: { "access-control-allow-origin": allowed, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "600", vary: "Origin" } });
    }
    if (url.pathname !== "/api/early-access") return reply(404, { ok: false, message: "Not found." });
    if (request.method !== "POST") return reply(405, { ok: false, message: "Use POST." });
    if (!allowed || origin !== allowed) return reply(403, { ok: false, message: "This form can only be sent from the Kinviva website." });
    if (!(request.headers.get("content-type") || "").includes("application/json")) return reply(415, { ok: false, message: "Send the form as JSON." }, allowed);

    const text = await request.text();
    if (text.length > MAX_BODY) return reply(413, { ok: false, message: "That is too much data." }, allowed);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return reply(400, { ok: false, message: "Send the form as JSON." }, allowed);
    }

    // Refuse to run without a real secret salt, so stored rate keys cannot be reversed by guessing addresses.
    if (!env.RATE_SALT || env.RATE_SALT.length < 16) return reply(503, { ok: false, message: "Sign-up is temporarily unavailable. Please try again later." }, allowed);

    // A hidden field that only automated senders fill in: pretend to succeed, store nothing.
    if (body && typeof body === "object" && clean(body.website, 200)) return reply(200, { ok: true, message: MESSAGE }, allowed);

    // Rate limit by a salted hash of the client address, per hour. Counted before validation so bad requests also count.
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const key = await sha256Hex(`${env.RATE_SALT}:${ip}`);
    const window = Math.floor(Date.now() / 3_600_000);
    await env.DB.prepare("INSERT INTO rate(key, window, count) VALUES (?1, ?2, 1) ON CONFLICT(key, window) DO UPDATE SET count = count + 1").bind(key, window).run();
    const row = await env.DB.prepare("SELECT count FROM rate WHERE key = ?1 AND window = ?2").bind(key, window).first();
    if (row && row.count > HOURLY_LIMIT) return reply(429, { ok: false, message: "Too many attempts. Please try again in an hour." }, allowed);
    await env.DB.prepare("DELETE FROM rate WHERE window < ?1").bind(window - 24).run();

    const checked = validate(body);
    if (!checked.ok) return reply(422, { ok: false, message: checked.error }, allowed);
    const v = checked.value;

    // A repeated email changes nothing and gets the same answer, so the form does not reveal who is on the list.
    await env.DB.prepare("INSERT INTO signups(email, email_lower, name, use_case, company, consent_version, consent_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(email_lower) DO NOTHING")
      .bind(v.email, v.emailLower, v.name, v.useCase, v.company, CONSENT_VERSION, new Date().toISOString())
      .run();
    return reply(200, { ok: true, message: MESSAGE }, allowed);
}
