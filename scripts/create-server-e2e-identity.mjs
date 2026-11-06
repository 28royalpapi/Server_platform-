import { randomBytes, randomUUID } from "node:crypto";

const projectUrl = process.env.SERVER_SUPABASE_URL || "https://hzuovekqsjtpvmbuybxs.supabase.co";
const publishableKey = process.env.SERVER_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_denBmNsOLdaEYPjFr4JxTA_XgElA64E";
const response = await fetch(projectUrl.replace(/\/$/, "") + "/functions/v1/server-auth", {
  method: "POST",
  headers: { "content-type": "application/json", apikey: publishableKey },
  body: JSON.stringify({
    action: "register_device",
    installation_id: randomUUID(),
    device_secret: randomBytes(32).toString("hex"),
    accepted_terms: true,
    terms_version: "server-terms-1.0",
    privacy_version: "server-privacy-1.0"
  })
});
const result = await response.json().catch(() => ({}));
if (!response.ok || result.ok !== true || !/^[0-9a-f]{64}$/.test(result.access_token || "")) {
  throw new Error("Could not provision the disposable Server guest-call test identity: " +
    (result.error || "HTTP " + response.status));
}
const expiresAt = Date.parse(result.expires_at);
const serverId = String(result.user?.server_id || "");
if (!Number.isFinite(expiresAt) || !/^SVR-[0-9A-F]{10}$/.test(serverId)) {
  throw new Error("Server test identity response was incomplete.");
}
process.stdout.write(JSON.stringify({
  access_token: result.access_token,
  access_expiry: Math.floor(expiresAt / 1000),
  server_id: serverId
}));
