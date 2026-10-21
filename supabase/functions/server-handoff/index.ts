import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};
const out = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: cors });
const sha = async (value: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
    .map((x) => x.toString(16).padStart(2, "0")).join("");
const randomHex = (size = 32) =>
  Array.from(crypto.getRandomValues(new Uint8Array(size)))
    .map((x) => x.toString(16).padStart(2, "0")).join("");

function client() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
  if (!key) {
    try {
      const values = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
      key = values.default || Object.values(values)[0] || "";
    } catch { /* missing/invalid key is handled below */ }
  }
  if (!url || !key) throw new Error("SERVER_NOT_CONFIGURED");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
const phonePattern = /^\+[1-9][0-9]{7,14}$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return out({ error: "METHOD_NOT_ALLOWED" }, 405);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || Array.isArray(body) || typeof body !== "object") throw new Error("bad object");
  } catch { return out({ error: "INVALID_JSON" }, 400); }

  let db;
  try { db = client(); } catch { return out({ error: "SERVER_NOT_CONFIGURED" }, 503); }
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "claim") {
    const code = typeof body.handoff_code === "string" ? body.handoff_code.trim() : "";
    if (!/^[0-9a-f]{64}$/.test(code)) return out({ error: "HANDOFF_CODE_INVALID" }, 400);
    const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") ||
      (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim() || "unknown").slice(0, 160);
    const ipKey = await sha("server-handoff-claim:" + ip);
    const { data: allowed, error: rateError } = await db.rpc("server_rate_limit_allow", {
      p_scope: "app_handoff_claim_ip", p_key_hash: ipKey, p_window_seconds: 60, p_max_hits: 60
    });
    if (rateError || allowed !== true) return out({ error: "HANDOFF_RATE_LIMITED" }, 429);

    const now = new Date().toISOString();
    const { data: match, error: lookupError } = await db.from("server_app_handoffs")
      .select("id,user_id,expires_at")
      .eq("token_hash", await sha(code))
      .is("claimed_at", null)
      .gt("expires_at", now)
      .maybeSingle();
    if (lookupError || !match) return out({ error: "HANDOFF_EXPIRED_OR_ALREADY_USED" }, 401);

    const { data: claimed, error: claimError } = await db.from("server_app_handoffs")
      .update({ claimed_at: now })
      .eq("id", match.id)
      .is("claimed_at", null)
      .gt("expires_at", now)
      .select("id,user_id")
      .maybeSingle();
    if (claimError || !claimed) return out({ error: "HANDOFF_EXPIRED_OR_ALREADY_USED" }, 409);

    const { data: profile, error: profileError } = await db.from("server_profiles")
      .select("user_id,phone_e164,phone_verified_at,accepted_terms_version,accepted_privacy_version")
      .eq("user_id", claimed.user_id)
      .maybeSingle();
    if (profileError || !profile || !profile.phone_verified_at || !phonePattern.test(profile.phone_e164 || "")) {
      return out({ error: "VERIFIED_PROFILE_REQUIRED" }, 401);
    }

    const accessToken = randomHex(32);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { error: sessionError } = await db.from("server_sessions").insert({
      user_id: profile.user_id,
      token_hash: await sha(accessToken),
      expires_at: expiresAt,
      user_agent: (req.headers.get("user-agent") || "Server native client").slice(0, 300)
    });
    if (sessionError) return out({ error: "HANDOFF_SESSION_CREATE_FAILED" }, 503);
    return out({
      ok: true,
      access_token: accessToken,
      token_type: "Bearer",
      expires_at: expiresAt,
      user: {
        id: profile.user_id,
        phone: profile.phone_e164,
        phone_verified_at: profile.phone_verified_at,
        accepted_terms_version: profile.accepted_terms_version,
        accepted_privacy_version: profile.accepted_privacy_version
      }
    });
  }

  if (action !== "create") return out({ error: "UNKNOWN_ACTION" }, 400);
  const bearer = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!/^[0-9a-f]{64}$/.test(bearer)) return out({ error: "SESSION_REQUIRED" }, 401);
  const now = new Date().toISOString();
  const { data: session, error: sessionError } = await db.from("server_sessions")
    .select("id,user_id")
    .eq("token_hash", await sha(bearer))
    .is("revoked_at", null)
    .gt("expires_at", now)
    .maybeSingle();
  if (sessionError || !session) return out({ error: "SESSION_REQUIRED" }, 401);

  const { data: profile, error: profileError } = await db.from("server_profiles")
    .select("user_id,phone_e164,phone_verified_at,accepted_terms_version,accepted_privacy_version")
    .eq("user_id", session.user_id).maybeSingle();
  if (profileError || !profile || !profile.phone_verified_at || !phonePattern.test(profile.phone_e164 || "")) {
    return out({ error: "VERIFIED_PROFILE_REQUIRED" }, 401);
  }
  if (!profile.accepted_terms_version || !profile.accepted_privacy_version) {
    return out({ error: "LEGAL_ACCEPTANCE_REQUIRED" }, 403);
  }

  const { data: allowed, error: rateError } = await db.rpc("server_rate_limit_allow", {
    p_scope: "app_handoff_create_user",
    p_key_hash: await sha(profile.user_id),
    p_window_seconds: 3600,
    p_max_hits: 10
  });
  if (rateError || allowed !== true) return out({ error: "HANDOFF_RATE_LIMITED" }, 429);

  const code = randomHex(32);
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  const { error: insertError } = await db.from("server_app_handoffs").insert({
    user_id: profile.user_id,
    token_hash: await sha(code),
    expires_at: expiresAt,
    created_user_agent: (req.headers.get("user-agent") || "").slice(0, 300) || null
  });
  if (insertError) return out({ error: "HANDOFF_CREATE_FAILED" }, 503);
  return out({
    ok: true,
    handoff_code: code,
    expires_at: expiresAt,
    app_link: "server://setup?handoff=" + code
  });
});