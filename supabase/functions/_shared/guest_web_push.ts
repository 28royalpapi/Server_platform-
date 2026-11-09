import { buildPushPayload } from "npm:@block65/webcrypto-web-push@2.0.0";

const encoder = new TextEncoder();
const VAPID_SUBJECT = "https://server-onboarding-ochre.vercel.app";
const FRESH_GUEST_SECONDS = 35;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\\+/g, "-").replace(/\\//g, "_");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "fcm.googleapis.com" ||
      host === "push.services.mozilla.com" ||
      host.endsWith(".push.services.mozilla.com") ||
      host === "web.push.apple.com" ||
      host === "push.apple.com" ||
      host.endsWith(".push.apple.com");
  } catch {
    return false;
  }
}

export async function getGuestPushVapidKeys(db: any): Promise<{
  subject: string;
  publicKey: string;
  privateKey: string;
} | null> {
  try {
    const read = () => db.from("server_guest_push_config")
      .select("subject,public_key,private_key").eq("id", 1).maybeSingle();
    const existing = await read();
    if (existing.error) return null;
    if (existing.data?.public_key && existing.data?.private_key) {
      return {
        subject: existing.data.subject,
        publicKey: existing.data.public_key,
        privateKey: existing.data.private_key
      };
    }

    // Generate a standards-based VAPID P-256 keypair on first use. Only the public
    // half is sent to browsers; the private half stays in the service-role table.
    const pair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    );
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    if (!jwk.x || !jwk.y || !jwk.d) return null;
    const publicBytes = new Uint8Array([
      4,
      ...fromBase64Url(jwk.x),
      ...fromBase64Url(jwk.y)
    ]);
    const row = {
      id: 1,
      subject: VAPID_SUBJECT,
      public_key: base64Url(publicBytes),
      private_key: jwk.d,
      updated_at: new Date().toISOString()
    };
    const { error: saveError } = await db.from("server_guest_push_config")
      .upsert(row, { onConflict: "id", ignoreDuplicates: true });
    if (saveError) return null;
    const saved = await read();
    if (saved.error || !saved.data?.public_key || !saved.data?.private_key) return null;
    return {
      subject: saved.data.subject,
      publicKey: saved.data.public_key,
      privateKey: saved.data.private_key
    };
  } catch {
    return null;
  }
}

export async function sendGuestBrowserPush(
  db: any,
  phoneE164: string,
  notification: {
    call_id: string;
    caller_label: string;
    title: string;
    body: string;
    url: string;
  }
): Promise<{
  registered: number;
  recent_online: number;
  accepted: number;
  failed: number;
  configured: boolean;
}> {
  const { data: devices, error } = await db.from("server_guest_push_devices")
    .select("id,endpoint,p256dh,auth,expiration_at,last_seen_at")
    .eq("phone_e164", phoneE164)
    .is("revoked_at", null)
    .order("last_seen_at", { ascending: false })
    .limit(12);
  if (error || !devices?.length) {
    return { registered: 0, recent_online: 0, accepted: 0, failed: 0, configured: !error };
  }

  const keys = await getGuestPushVapidKeys(db);
  if (!keys) {
    return { registered: devices.length, recent_online: 0, accepted: 0, failed: devices.length, configured: false };
  }

  const now = Date.now();
  const recentOnline = devices.filter((device: any) =>
    Number.isFinite(Date.parse(device.last_seen_at || "")) &&
    now - Date.parse(device.last_seen_at) <= FRESH_GUEST_SECONDS * 1000
  ).length;

  let accepted = 0;
  let failed = 0;
  await Promise.all(devices.map(async (device: any) => {
    if (!validPushEndpoint(device.endpoint) || !device.p256dh || !device.auth) {
      failed++;
      return;
    }
    if (device.expiration_at && Date.parse(device.expiration_at) <= now) {
      await db.from("server_guest_push_devices")
        .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", device.id);
      failed++;
      return;
    }
    const subscription = {
      endpoint: device.endpoint,
      expirationTime: device.expiration_at ? Date.parse(device.expiration_at) : null,
      keys: { p256dh: device.p256dh, auth: device.auth }
    };
    const pushMessage = {
      data: JSON.stringify({
        type: "server_guest_incoming_call",
        call_id: notification.call_id,
        caller_label: notification.caller_label,
        title: notification.title,
        body: notification.body,
        url: notification.url
      }),
      options: { ttl: 120, urgency: "high" }
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const request = await buildPushPayload(pushMessage as any, subscription as any, {
        subject: keys.subject,
        publicKey: keys.publicKey,
        privateKey: keys.privateKey
      });
      const response = await fetch(device.endpoint, { ...request, signal: controller.signal });
      if (response.status === 201 || response.status === 202) {
        accepted++;
      } else {
        failed++;
        if (response.status === 404 || response.status === 410) {
          await db.from("server_guest_push_devices")
            .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", device.id);
        }
      }
    } catch {
      failed++;
    } finally {
      clearTimeout(timeout);
    }
  }));

  return {
    registered: devices.length,
    recent_online: recentOnline,
    accepted,
    failed,
    configured: true
  };
}
