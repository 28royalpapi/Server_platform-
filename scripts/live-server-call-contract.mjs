import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

// Real deployed Server control-plane integration test.
// Creates temporary device identities only; it sends no SMS, PSTN call or push.
// Media transport is deliberately not claimed by this backend lifecycle test.
const configText = await readFile("web/config.js", "utf8");
const projectUrl = (process.env.SERVER_SUPABASE_URL ||
  configText.match(/supabaseUrl:\s*"([^"]+)"/)?.[1] || "").replace(/\/$/, "");
const publishableKey = process.env.SERVER_SUPABASE_PUBLISHABLE_KEY ||
  configText.match(/publishableKey:\s*"([^"]+)"/)?.[1] || "";
assert.ok(projectUrl && publishableKey.startsWith("sb_publishable_"),
  "Server public Supabase configuration is required.");

const identities = [];
const calls = [];
let checks = 0;

function pass(name, detail = "") {
  checks++;
  process.stdout.write("PASS " + name + (detail ? " — " + detail : "") + "\n");
}

async function request(functionName, body, token = "", expectedStatus = 200) {
  const headers = { apikey: publishableKey, "content-type": "application/json" };
  if (token) headers.authorization = "Bearer " + token;
  const response = await fetch(projectUrl + "/functions/v1/" + functionName, {
    method: "POST", headers, body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const raw = await response.text();
  let data = {};
  try { data = JSON.parse(raw); } catch {}
  assert.equal(response.status, expectedStatus,
    functionName + " action=" + String(body.action) + " expected HTTP " + expectedStatus +
    " but got " + response.status + ": " + String(data.error || raw.slice(0, 160)));
  return data;
}

async function createIdentity(existing = null) {
  const credentials = existing || {
    installation_id: randomUUID(),
    device_secret: randomBytes(32).toString("hex")
  };
  const result = await request("server-auth", {
    action: "register_device",
    ...credentials,
    accepted_terms: true,
    terms_version: "server-terms-1.0",
    privacy_version: "server-privacy-1.0"
  });
  assert.equal(result.ok, true);
  assert.match(result.access_token || "", /^[0-9a-f]{64}$/);
  assert.match(result.user?.id || "", /^[0-9a-f-]{36}$/i);
  assert.match(result.user?.server_id || "", /^SVR-[0-9A-F]{10}$/);
  const identity = { ...credentials, token: result.access_token, user: result.user };
  identities.push(identity);
  return identity;
}

async function callAction(identity, action, extra = {}, expectedStatus = 200) {
  return request("server-calls", { action, ...extra }, identity.token, expectedStatus);
}

async function cleanup() {
  for (const { id, owner } of calls) {
    try { await callAction(owner, "end", { call_id: id }); } catch {}
  }
  for (const identity of identities) {
    try { await request("server-auth", { action: "logout" }, identity.token); } catch {}
  }
}

try {
  const caller = await createIdentity();
  const onlineCallee = await createIdentity();
  const offlineCallee = await createIdentity();

  const callerPresence = await callAction(caller, "presence");
  assert.equal(callerPresence.presence, "online");
  const calleePresence = await callAction(onlineCallee, "presence");
  assert.equal(calleePresence.presence, "online");
  pass("both Server identities authenticate and establish fresh presence");

  const started = await callAction(caller, "start", {
    to_server_id: onlineCallee.user.server_id
  });
  assert.equal(started.ok, true);
  assert.equal(started.route, "server");
  assert.equal(started.call?.route, "server");
  assert.equal(started.call?.state, "ringing");
  assert.equal(started.recipient_availability?.status, "online");
  assert.ok(started.call_id);
  calls.push({ id: started.call_id, owner: caller });
  pass("online Server-to-Server route created", "callee presence was confirmed; no guest link or carrier route used");

  const realtime = await callAction(caller, "realtime_token", { call_id: started.call_id });
  if (realtime.realtime_available === true) {
    assert.ok((realtime.url || "").startsWith("wss://") || (realtime.url || "").startsWith("ws://"));
    const realtimeTokenParts = (realtime.token || "").split(".");
    assert.equal(realtimeTokenParts.length, 3);
    assert.ok(realtimeTokenParts.every(part => /^[A-Za-z0-9_-]+$/.test(part)));
    const claims = JSON.parse(Buffer.from(realtimeTokenParts[1], "base64url").toString("utf8"));
    assert.ok(Array.isArray(claims.channels));
    assert.ok(claims.channels.includes("$server-user:" + caller.user.id));
    assert.ok(claims.channels.includes("$server-call:" + started.call_id));
    pass("Centrifugo realtime token is scoped to caller identity and this call");
  } else {
    process.stdout.write("WARN CENTRIFUGO_NOT_CONFIGURED: call events still use durable HTTP reconciliation; this is not the high-concurrency realtime path.\\n");
  }

  const incoming = await callAction(onlineCallee, "incoming");
  const ringing = (incoming.calls || []).find(row => row.id === started.call_id);
  assert.ok(ringing, "the recipient's authenticated incoming list must contain the ringing call");
  assert.equal(ringing.state, "ringing");
  assert.equal(ringing.route, "server");
  assert.equal(ringing.caller_server_id, caller.user.server_id);
  pass("callee discovers the caller through the native incoming-call API");

  const accepted = await callAction(onlineCallee, "accept", { call_id: started.call_id });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.state, "connecting");
  assert.ok(Array.isArray(accepted.ice_servers) && accepted.ice_servers.length > 0);
  pass("callee accepts the incoming Server call and receives ICE configuration");

  const offerMarker = "server-to-server-offer-" + randomUUID();
  const offer = await callAction(caller, "signal", {
    call_id: started.call_id,
    kind: "offer",
    payload: { type: "offer", contract_probe: offerMarker }
  });
  assert.ok(Number(offer.seq) > 0);
  const calleeOffer = await callAction(onlineCallee, "poll", {
    call_id: started.call_id, after_seq: 0
  });
  assert.ok((calleeOffer.signals || []).some(row => row.payload?.contract_probe === offerMarker),
    "callee must receive the caller's persisted offer");
  pass("caller offer is authorised, persisted and visible to callee");

  const answerMarker = "server-to-server-answer-" + randomUUID();
  const answer = await callAction(onlineCallee, "signal", {
    call_id: started.call_id,
    kind: "answer",
    payload: { type: "answer", contract_probe: answerMarker }
  });
  assert.ok(Number(answer.seq) > Number(offer.seq));
  const callerAnswer = await callAction(caller, "poll", {
    call_id: started.call_id, after_seq: Number(offer.seq)
  });
  assert.ok((callerAnswer.signals || []).some(row => row.payload?.contract_probe === answerMarker),
    "caller must receive the callee's persisted answer");
  pass("callee answer is authorised, persisted and visible to caller");

  const activated = await callAction(caller, "set_active", { call_id: started.call_id });
  assert.equal(activated.ok, true);
  assert.equal(activated.state, "active");
  const activeAtCallee = await callAction(onlineCallee, "poll", {
    call_id: started.call_id, after_seq: Number(answer.seq)
  });
  assert.equal(activeAtCallee.call?.state, "active");
  pass("active call state is shared between the two authenticated participants");

  const ended = await callAction(caller, "end", { call_id: started.call_id });
  assert.equal(ended.ok, true);
  assert.equal(ended.state, "ended");
  const endedAtCallee = await callAction(onlineCallee, "poll", {
    call_id: started.call_id, after_seq: Number(answer.seq)
  });
  assert.equal(endedAtCallee.call?.state, "ended");
  assert.ok((endedAtCallee.signals || []).some(row => row.kind === "hangup"));
  pass("caller hang-up is persisted and visible to the callee");

  // Revoke all active sessions for this identity to create a deterministic offline user.
  await request("server-auth", { action: "logout" }, offlineCallee.token);
  const offlineStart = await request("server-calls", {
    action: "start", to_server_id: offlineCallee.user.server_id
  }, caller.token, 409);
  assert.equal(offlineStart.code, "RECIPIENT_OFFLINE");
  assert.equal(offlineStart.call_created, true);
  assert.equal(offlineStart.missed_call_saved, true);
  assert.equal(offlineStart.call?.state, "missed");
  calls.push({ id: offlineStart.call_id, owner: caller });
  pass("offline Server recipient is not falsely rung; an atomic missed-call record is saved");

  const reconnected = await createIdentity({
    installation_id: offlineCallee.installation_id,
    device_secret: offlineCallee.device_secret
  });
  assert.equal(reconnected.user.id, offlineCallee.user.id);
  assert.equal(reconnected.user.server_id, offlineCallee.user.server_id);
  const inbox = await callAction(reconnected, "incoming");
  const missed = (inbox.calls || []).find(row => row.id === offlineStart.call_id);
  assert.ok(missed, "the same Server identity must receive its missed call after reconnecting");
  assert.equal(missed.state, "missed");
  pass("offline missed call reappears in the same user's inbox after device re-authentication");

  process.stdout.write("\nLive Server-to-Server backend integration: " + checks + "/" + checks +
    " checks passed. This does not claim that a real microphone/ICE media session was established.\n");
} finally {
  await cleanup();
}
