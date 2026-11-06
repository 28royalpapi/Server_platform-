import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const headers = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY"
};
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c] as string));
const sha = async (value: string) => Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))
).map(x => x.toString(16).padStart(2,"0")).join("");

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return new Response("Method not allowed", {status:405,headers});
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  if (token.length < 48 || token.length > 256) return new Response("Invalid call invitation", {status:404,headers});
  const projectUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = (() => { const raw = Deno.env.get("SUPABASE_SECRET_KEYS") || ""; if (raw) { try { const parsed = JSON.parse(raw); if (parsed && typeof parsed === "object") return parsed.default || Object.values(parsed)[0] || ""; } catch {} } return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || ""; })();
  if (!projectUrl || !serviceKey) return new Response("Server call preview unavailable", {status:503,headers});
  const db = createClient(projectUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data: invite,error: inviteError} = await db.from("server_guest_invites")
    .select("id,call_id,expires_at,revoked_at").eq("token_hash",await sha(token))
    .is("revoked_at",null).gt("expires_at",new Date().toISOString()).maybeSingle();
  if (inviteError || !invite) return new Response("This Server call invitation has expired.",{status:410,headers});
  const {data: call,error: callError} = await db.from("server_calls")
    .select("state,expires_at,caller_user_id").eq("id",invite.call_id).maybeSingle();
  if (callError || !call || !["ringing","connecting"].includes(call.state) ||
      (call.expires_at && Date.parse(call.expires_at) <= Date.now())) {
    return new Response("This Server call is no longer ringing.",{status:410,headers});
  }
  const {data: profile} = await db.from("server_profiles")
    .select("server_id,phone_e164,phone_verified_at").eq("user_id",call.caller_user_id).maybeSingle();
  const caller = profile?.phone_verified_at && typeof profile.phone_e164 === "string"
    ? profile.phone_e164
    : (profile?.server_id || "A Server user");
  const title = caller + " is calling you through Server";
  const description = "INCOMING SERVER CALL. Open to view the full-screen call screen and answer securely. No Server installation or account is required.";
  const guestUrl = "https://server-onboarding-ochre.vercel.app/guest.html#token=" + encodeURIComponent(token);
  const imageUrl = "https://raw.githubusercontent.com/28royalpapi/Server_platform-/android-finish/web/images/server-incoming-call-preview.svg";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#101b2a">
<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="SERVER">
<meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${imageUrl}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${imageUrl}">
</head><body style="margin:0;min-height:100vh;background:#101b2a;color:white;font:600 18px system-ui;display:grid;place-items:center;text-align:center">
<main style="padding:28px;max-width:560px"><div style="color:#9ff0c4;letter-spacing:.2em;font-weight:900">SERVER · INCOMING CALL</div>
<h1 style="font-size:clamp(32px,7vw,54px);line-height:1.05">${escapeHtml(caller)} is calling you</h1>
<p>Opening your secure full-screen call screen…</p><a href="${guestUrl}" style="display:inline-block;padding:18px 32px;border-radius:40px;background:#20ad59;color:white;text-decoration:none">Open incoming call</a></main>
<script>location.replace(${JSON.stringify(guestUrl)});</script></body></html>`;
  return new Response(html,{status:200,headers});
});
