/**
 * Wakes a caller-owned Server SIM Gateway over Supabase Realtime.
 *
 * The topic is derived from the gateway's SHA-256 token hash. The broadcast
 * contains no phone number, SMS body, invitation URL or job identifier.
 * The gateway must still authenticate with its original bearer token when it
 * polls the durable queue. Public-channel access is therefore only a wake hint.
 */
const FALLBACK_SUPABASE_PUBLIC_KEY = "sb_publishable_denBmNsOLdaEYPjFr4JxTA_XgElA64E";

export function serverGatewayWakeTopic(tokenHash: string): string {
  if (!/^[a-f0-9]{64}$/i.test(tokenHash)) {
    throw new Error("INVALID_GATEWAY_TOKEN_HASH");
  }
  return "server-gateway-" + tokenHash.toLowerCase();
}

export async function sendServerGatewayWake(tokenHash: string): Promise<boolean> {
  const projectUrl = (Deno.env.get("SUPABASE_URL") || "").trim().replace(/\/$/, "");
  const publishableKey = (
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
    FALLBACK_SUPABASE_PUBLIC_KEY
  ).trim();

  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(projectUrl) ||
      !publishableKey.startsWith("sb_publishable_")) {
    console.warn("SERVER_GATEWAY_REALTIME_CONFIG_INVALID");
    return false;
  }

  let topic: string;
  try {
    topic = serverGatewayWakeTopic(tokenHash);
  } catch {
    console.warn("SERVER_GATEWAY_REALTIME_TOPIC_INVALID");
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(projectUrl + "/realtime/v1/api/broadcast", {
      method: "POST",
      headers: {
        "apikey": publishableKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        messages: [{
          topic,
          event: "gateway_wake",
          payload: { wake: true }
        }]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      console.warn("SERVER_GATEWAY_REALTIME_WAKE_HTTP_" + response.status);
      return false;
    }
    return true;
  } catch {
    console.warn("SERVER_GATEWAY_REALTIME_WAKE_UNAVAILABLE");
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
