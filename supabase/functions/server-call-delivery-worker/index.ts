import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const SERVER_CALL_TTL_SECONDS = 180;
const MAX_BATCH = 250;
const VISIBILITY_SECONDS = 60;
const MAX_READ_ATTEMPTS = 5;
const MAX_PARALLEL_SENDS = 40;

const b64url = (value: string | Uint8Array) => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
};
const pemBytes = (pem: string) => {
  const clean = pem.replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s/g, "");
  return Uint8Array.from(atob(clean), c => c.charCodeAt(0));
};

let cachedFcmAccessToken: { token: string; expiresAt: number } | null = null;
let cachedApnsJwt: { token: string; expiresAt: number } | null = null;

async function firebaseAccessToken() {
  if (cachedFcmAccessToken && cachedFcmAccessToken.expiresAt > Date.now() + 60000) {
    return cachedFcmAccessToken.token;
  }
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") || "";
  if (!raw) return null;
  const sa = JSON.parse(raw);
  const issued = Math.floor(Date.now() / 1000);
  const input = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." + b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: issued,
    exp: issued + 3600
  }));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(String(sa.private_key || "").replace(/\\n/g, "\n")),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input)
  ));
  const assertion = input + "." + b64url(signature);
  const form = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form
  });
  if (!response.ok) throw new Error("FCM_OAUTH_" + response.status);
  const tokenBody = await response.json();
  cachedFcmAccessToken = {
    token: tokenBody.access_token,
    expiresAt: Date.now() + Math.max(60, Number(tokenBody.expires_in) || 3600) * 1000
  };
  return cachedFcmAccessToken.token;
}

async function apnsBearer() {
  if (cachedApnsJwt && cachedApnsJwt.expiresAt > Date.now() + 60000) return cachedApnsJwt.token;
  const team = Deno.env.get("APNS_TEAM_ID") || "";
  const kid = Deno.env.get("APNS_KEY_ID") || "";
  const pem = Deno.env.get("APNS_PRIVATE_KEY") || "";
  if (!team || !kid || !pem) return null;
  const issued = Math.floor(Date.now() / 1000);
  const input = b64url(JSON.stringify({ alg: "ES256", kid, typ: "JWT" })) + "." +
    b64url(JSON.stringify({ iss: team, iat: issued }));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(pem.replace(/\\n/g, "\n")),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input)
  ));
  const jwt = input + "." + b64url(signature);
  cachedApnsJwt = { token: jwt, expiresAt: Date.now() + 50 * 60 * 1000 };
  return jwt;
}

type Device = { id: string; platform: string; token: string };
type QueueMessage = {
  msg_id: number;
  read_ct: number;
  message: { call_id?: string; recipient_user_id?: string; caller_server_id?: string };
};

async function sendAndroidPush(device: Device, callId: string, callerLabel: string, accessToken: string, projectId: string) {
  const response = await fetch(
    "https://fcm.googleapis.com/v1/projects/" + encodeURIComponent(projectId) + "/messages:send",
    {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer " + accessToken },
      body: JSON.stringify({
        message: {
          token: device.token,
          data: {
            type: "server_incoming_call",
            call_id: callId,
            caller_label: callerLabel,
            expires_in: String(SERVER_CALL_TTL_SECONDS)
          },
          android: {
            priority: "HIGH",
            ttl: SERVER_CALL_TTL_SECONDS + "s",
            collapse_key: "server-live-call"
          }
        }
      })
    }
  );
  if (response.ok) return { accepted: true, invalidToken: false, transient: false };
  const body = await response.text().catch(() => "");
  const invalidToken = response.status === 404 ||
    body.includes("UNREGISTERED") ||
    body.includes("registration-token-not-registered");
  return {
    accepted: false,
    invalidToken,
    transient: !invalidToken && (response.status === 408 || response.status === 429 || response.status >= 500 || response.status === 401 || response.status === 403)
  };
}

async function sendIosVoipPush(device: Device, callId: string, callerLabel: string, jwt: string) {
  const bundle = Deno.env.get("APNS_BUNDLE_ID") || "com.server.caller";
  const response = await fetch("https://api.push.apple.com/3/device/" + encodeURIComponent(device.token), {
    method: "POST",
    headers: {
      "authorization": "bearer " + jwt,
      "apns-topic": bundle + ".voip",
      "apns-push-type": "voip",
      "apns-priority": "10",
      "apns-expiration": String(Math.floor(Date.now() / 1000) + SERVER_CALL_TTL_SECONDS)
    },
    body: JSON.stringify({
      aps: {},
      type: "server_incoming_call",
      call_id: callId,
      caller_label: callerLabel,
      expires_in: SERVER_CALL_TTL_SECONDS
    })
  });
  if (response.ok) return { accepted: true, invalidToken: false, transient: false };
  const body = await response.text().catch(() => "");
  const invalidToken = response.status === 410 || body.includes("Unregistered");
  return {
    accepted: false,
    invalidToken,
    transient: !invalidToken && (response.status === 408 || response.status === 429 || response.status >= 500 || response.status === 403)
  };
}

async function runBounded<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await fn(items[index]);
    }
  });
  await Promise.all(workers);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const dispatchToken = req.headers.get("x-server-dispatch-token") || "";
  if (!dispatchToken) return Response.json({ error: "WORKER_AUTH_REQUIRED" }, { status: 401 });

  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = (() => {
    const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed.default || Object.values(parsed)[0] || "";
      } catch { /* fall through to legacy runtime key */ }
    }
    return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
  })();
  if (!url || !key) return Response.json({ error: "WORKER_DATABASE_CONFIG_MISSING" }, { status: 500 });

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authorized, error: authError } = await db.rpc("server_validate_call_dispatch_secret", {
    p_token: dispatchToken
  });
  if (authError || authorized !== true) return Response.json({ error: "WORKER_AUTH_INVALID" }, { status: 401 });

  const { data: rawMessages, error: readError } = await db.rpc("server_call_delivery_read_batch", {
    p_quantity: MAX_BATCH,
    p_visibility_seconds: VISIBILITY_SECONDS
  });
  if (readError) return Response.json({ error: "QUEUE_READ_FAILED" }, { status: 503 });

  const messages = (rawMessages || []) as QueueMessage[];
  if (!messages.length) {
    return Response.json({ ok: true, read: 0, accepted: 0, skipped: 0, retried: 0, archived: 0 });
  }

  const callIds = [...new Set(messages.map(m => m.message?.call_id).filter((x): x is string => typeof x === "string"))];
  const recipientIds = [...new Set(messages.map(m => m.message?.recipient_user_id).filter((x): x is string => typeof x === "string"))];

  const [callsResult, devicesResult] = await Promise.all([
    callIds.length
      ? db.from("server_calls").select("id,state,expires_at").in("id", callIds)
      : Promise.resolve({ data: [], error: null }),
    recipientIds.length
      ? db.from("server_push_devices").select("id,user_id,platform,token").in("user_id", recipientIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (callsResult.error || devicesResult.error) {
    return Response.json({ error: "QUEUE_CONTEXT_LOOKUP_FAILED" }, { status: 503 });
  }

  const callMap = new Map((callsResult.data || []).map((c: any) => [c.id, c]));
  const deviceMap = new Map<string, Device[]>();
  for (const device of (devicesResult.data || []) as (Device & { user_id: string })[]) {
    const list = deviceMap.get(device.user_id) || [];
    list.push(device);
    deviceMap.set(device.user_id, list);
  }

  const ack: number[] = [];
  const archive: number[] = [];
  let accepted = 0;
  let skipped = 0;
  let transientErrors = 0;
  let invalidTokensRemoved = 0;

  // Load provider credentials once per batch, then fan out with a bounded
  // concurrency limit. Push is a wake-up signal; call state remains in Postgres.
  let fcmToken: string | null = null;
  let fcmProject = "";
  let apnsToken: string | null = null;
  let providerConfigError = false;

  const hasAndroid = messages.some(m => deviceMap.get(m.message?.recipient_user_id || "")?.some(d => d.platform === "android"));
  const hasIos = messages.some(m => deviceMap.get(m.message?.recipient_user_id || "")?.some(d => d.platform === "ios_voip"));
  if (hasAndroid) {
    try {
      const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") || "";
      if (raw) {
        const serviceAccount = JSON.parse(raw);
        fcmProject = serviceAccount.project_id || Deno.env.get("FIREBASE_PROJECT_ID") || "";
        fcmToken = await firebaseAccessToken();
      }
    } catch {
      providerConfigError = true;
    }
  }
  if (hasIos) {
    try { apnsToken = await apnsBearer(); } catch { providerConfigError = true; }
  }

  await runBounded(messages, MAX_PARALLEL_SENDS, async (job) => {
    const callId = job.message?.call_id || "";
    const recipientId = job.message?.recipient_user_id || "";
    const call = callMap.get(callId);
    if (!call || call.state !== "ringing" || !call.expires_at || Date.parse(call.expires_at) <= Date.now()) {
      ack.push(job.msg_id);
      skipped++;
      return;
    }

    const devices = deviceMap.get(recipientId) || [];
    if (!devices.length) {
      // Keep the wake job until the call expires. A device may register its
      // push endpoint shortly after call creation; retry instead of dropping
      // the alert on the first empty lookup.
      if (job.read_ct >= MAX_READ_ATTEMPTS) archive.push(job.msg_id);
      else {
        transientErrors++;
      }
      return;
    }

    let acceptedForRecipient = false;
    let transientForRecipient = providerConfigError;
    let configuredProvider = false;

    for (const device of devices) {
      try {
        let outcome: { accepted: boolean; invalidToken: boolean; transient: boolean } | null = null;
        if (device.platform === "android") {
          configuredProvider = true;
          if (!fcmToken || !fcmProject) {
            transientForRecipient = true;
            continue;
          }
          outcome = await sendAndroidPush(device, callId, job.message?.caller_server_id || "A Server user", fcmToken, fcmProject);
        } else if (device.platform === "ios_voip") {
          configuredProvider = true;
          if (!apnsToken) {
            transientForRecipient = true;
            continue;
          }
          outcome = await sendIosVoipPush(device, callId, job.message?.caller_server_id || "A Server user", apnsToken);
        }
        if (!outcome) continue;
        if (outcome.accepted) acceptedForRecipient = true;
        if (outcome.invalidToken) {
          await db.from("server_push_devices").delete().eq("id", device.id);
          invalidTokensRemoved++;
        } else if (outcome.transient) {
          transientForRecipient = true;
        }
      } catch {
        transientForRecipient = true;
      }
    }

    if (acceptedForRecipient) {
      ack.push(job.msg_id);
      accepted++;
    } else if (transientForRecipient && job.read_ct >= MAX_READ_ATTEMPTS) {
      archive.push(job.msg_id);
    } else if (transientForRecipient || configuredProvider) {
      transientErrors++;
      // Leave unacknowledged. PGMQ makes it visible again when the lease expires.
    } else {
      // No usable registered provider exists for this recipient.
      ack.push(job.msg_id);
      skipped++;
    }
  });

  const [ackedResult, archivedResult] = await Promise.all([
    ack.length ? db.rpc("server_call_delivery_ack_batch", { p_message_ids: ack, p_archive: false }) : Promise.resolve({ data: 0, error: null }),
    archive.length ? db.rpc("server_call_delivery_ack_batch", { p_message_ids: archive, p_archive: true }) : Promise.resolve({ data: 0, error: null })
  ]);
  if (ackedResult.error || archivedResult.error) {
    return Response.json({ error: "QUEUE_ACK_FAILED" }, { status: 503 });
  }

  // Schedule the next bounded batch immediately. The DB-side gate coalesces
  // repeated kicks so a burst cannot create one HTTP worker request per call.
  await db.rpc("server_call_delivery_kick_continuation");

  return Response.json({
    ok: true,
    read: messages.length,
    accepted,
    skipped,
    retried: transientErrors,
    archived: archive.length,
    invalid_tokens_removed: invalidTokensRemoved,
    acked: ack.length
  });
});
