import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = await readFile("web/config.js", "utf8");
const url = config.match(/supabaseUrl:\s*"([^"]+)"/)?.[1];
const key = config.match(/publishableKey:\s*"([^"]+)"/)?.[1];
assert.equal(url, "https://hzuovekqsjtpvmbuybxs.supabase.co", "web config must target the dedicated Server Backend project");
assert.ok(key && key.startsWith("sb_publishable_"), "web config must use a public publishable key");

async function request(path, method = "POST", body) {
  const headers = { apikey: key };
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(url + "/functions/v1/" + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  return { response, text, data };
}

const checks = [];
const record = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  console.log((ok ? "PASS" : "FAIL") + " " + name + " — " + detail);
};

// Device-first signup must reject missing legal acceptance before touching the database.
{
  const r = await request("server-auth", "POST", {
    action: "register_device",
    installation_id: "7b5becc2-1ac4-47ef-80b6-13a61df78f26",
    device_secret: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    accepted_terms: false,
    terms_version: "server-terms-1.0",
    privacy_version: "server-privacy-1.0"
  });
  const ok = r.response.status === 400 && r.data.error === "LEGAL_ACCEPTANCE_REQUIRED";
  record("server-auth device-first consent guard", ok,
    "HTTP " + r.response.status + ", " + (r.data.error || r.text.slice(0, 100)));
}

// Invalid phone input must be rejected before any OTP is generated or queued.
{
  const r = await request("server-auth", "POST", { action: "request_otp", phone: "not-a-real-number" });
  const ok = r.response.status === 400 && r.data.error === "INVALID_PHONE_FORMAT";
  record("server-auth input validation", ok, "HTTP " + r.response.status + ", " + (r.data.error || r.text.slice(0, 100)));
}

// Never trigger a carrier SMS from CI. A malformed verification code must be rejected
// before the database is touched, regardless of whether a real SIM gateway is online.
{
  const r = await request("server-auth", "POST", {
    action: "verify_otp",
    phone: "+19995550101",
    code: "not-a-code"
  });
  const ok = r.response.status === 400 && r.data.error === "INVALID_CODE_FORMAT";
  record("server-auth rejects malformed OTP without sending SMS", ok,
    "HTTP " + r.response.status + ", " + (r.data.error || r.text.slice(0, 100)));
}

// Private call API must reject requests with no Server session token.
{
  const r = await request("server-calls", "POST", { action: "poll" });
  const ok = r.response.status === 401 && r.data.error === "SESSION_REQUIRED";
  record("server-calls session boundary", ok, "HTTP " + r.response.status + ", " + (r.data.error || r.text.slice(0, 100)));
}

// Invalid gateway pairing codes must not create a gateway device.
{
  const r = await request("server-gateway", "POST", { action: "claim", pairing_code: "INVALID0" });
  const ok = r.response.status === 400 && r.data.error === "PAIRING_CODE_INVALID";
  record("server-gateway pairing validation", ok, "HTTP " + r.response.status + ", " + (r.data.error || r.text.slice(0, 100)));
}

// Guest API must reject missing bearer invitation tokens.
{
  const r = await request("server-guest", "POST", { action: "join" });
  const ok = r.response.status === 401;
  record("server-guest token boundary", ok, "HTTP " + r.response.status + ", " + (r.data.error || r.text.slice(0, 100)));
}

// Handoff rejects malformed single-use codes without touching a session.
{
  const r = await request("server-handoff", "POST", { action: "claim", handoff_code: "invalid" });
  const ok = r.response.status === 400 && r.data.error === "HANDOFF_CODE_INVALID";
  record("server-handoff code validation", ok, "HTTP " + r.response.status + ", " + (r.data.error || r.text.slice(0, 100)));
}

// Public onboarding page must actually be served by the deployed edge function.
{
  const r = await request("server-web", "GET");
  const finalHost = (() => { try { return new URL(r.response.url).hostname; } catch { return ""; } })();
  const ok = r.response.status === 200 &&
    finalHost === "server-onboarding-ochre.vercel.app" &&
    /Server/i.test(r.text) &&
    /text\/html/i.test(r.response.headers.get("content-type") || "");
  record("server-web live page redirect and HTML", ok,
    "HTTP " + r.response.status + ", final host " + (finalHost || "missing") +
    ", content-type " + (r.response.headers.get("content-type") || "missing") +
    ", body " + r.text.length + " bytes");
}

const failed = checks.filter((x) => !x.ok);
console.log("\nLive contract tests: " + (checks.length - failed.length) + "/" + checks.length + " passed.");
if (failed.length) process.exitCode = 1;
