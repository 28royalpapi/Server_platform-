const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function jsonBase64Url(value: unknown): string {
  return base64Url(encoder.encode(JSON.stringify(value)));
}

function env(name: string): string {
  return (Deno.env.get(name) || "").trim();
}

export function realtimePublicUrl(): string {
  const value = env("CENTRIFUGO_PUBLIC_URL");
  return /^wss?:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[^\s]*)?$/i.test(value) ? value : "";
}

/**
 * Issues a short-lived Centrifugo connection JWT. Its channels claim creates
 * server-side subscriptions, not client-side publish permissions. The caller
 * must authorize every requested channel before invoking this helper.
 */
export async function issueRealtimeToken(
  subject: string,
  channels: string[],
  ttlSeconds = 900
): Promise<{ url: string; token: string } | null> {
  const publicUrl = realtimePublicUrl();
  const secret = env("CENTRIFUGO_TOKEN_HMAC_SECRET_KEY");
  if (!publicUrl || secret.length < 32 || !subject || !channels.length) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = jsonBase64Url({ alg: "HS256", typ: "JWT" });
  const claims = jsonBase64Url({
    sub: subject,
    iat: now,
    exp: now + Math.max(60, Math.min(1800, ttlSeconds)),
    channels: [...new Set(channels)]
  });
  const input = header + "." + claims;
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(input))
  );
  return { url: publicUrl, token: input + "." + base64Url(signature) };
}

/**
 * Publish only after the authoritative DB transition committed. Centrifugo is
 * a low-latency notification plane; Postgres remains the durable source of truth.
 * A missing/unavailable realtime service must never roll back a saved call.
 */
export async function publishRealtime(
  channel: string,
  data: Record<string, unknown>,
  idempotencyKey?: string
): Promise<boolean> {
  const apiUrl = env("CENTRIFUGO_API_URL");
  const apiKey = env("CENTRIFUGO_API_KEY");
  if (!apiUrl || !apiKey || !/^https?:\/\//i.test(apiUrl) || !channel.startsWith("$")) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(apiUrl.replace(/\/$/, "") + "/publish", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        channel,
        data,
        ...(idempotencyKey ? { idempotency_key: idempotencyKey.slice(0, 128) } : {})
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      console.error("CENTRIFUGO_PUBLISH_HTTP_" + response.status);
      return false;
    }
    const payload = await response.json().catch(() => null) as {
      error?: { code?: number; message?: string };
      result?: unknown;
    } | null;
    if (!payload || payload.error || !("result" in payload)) {
      console.error("CENTRIFUGO_PUBLISH_REJECTED_" + String(payload?.error?.code || "INVALID_RESPONSE"));
      return false;
    }
    return true;
  } catch {
    console.error("CENTRIFUGO_PUBLISH_UNAVAILABLE");
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export const userRealtimeChannel = (userId: string) => "$server-user:" + userId;
export const callRealtimeChannel = (callId: string) => "$server-call:" + callId;

/** Keep best-effort realtime delivery out of the call-setup/ICE response path. */
export function deferRealtime(task: Promise<unknown>): void {
  try {
    const runtime = (globalThis as unknown as {
      EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void }
    }).EdgeRuntime;
    if (runtime?.waitUntil) {
      runtime.waitUntil(task.catch(() => undefined));
      return;
    }
  } catch {
    // A local Deno test process may not expose the Supabase EdgeRuntime global.
  }
  void task.catch(() => undefined);
}
