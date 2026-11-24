import assert from "node:assert/strict";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

// Disposable test identity + reserved fictional NANP destination.
// This contract test sends no SMS, creates no push job and starts no PSTN call.
const configText = await readFile("web/config.js", "utf8");
const projectUrl = (process.env.SERVER_SUPABASE_URL ||
  configText.match(/supabaseUrl:\s*"([^"]+)"/)?.[1] || "").replace(/\/$/, "");
const publishableKey = process.env.SERVER_SUPABASE_PUBLISHABLE_KEY ||
  configText.match(/publishableKey:\s*"([^"]+)"/)?.[1] || "";
assert.ok(projectUrl && publishableKey.startsWith("sb_publishable_"), "Server public Supabase config is required.");

let destination = "";
const baseHeaders = { apikey: publishableKey };
const createdCallIds = new Set();
const createdCallTokens = new Map();
const secondaryAccessTokens = [];
let testNativeReceiver = null;
let accessToken = "";
const callerName = "Server Test " + randomUUID().slice(0, 8);
let activeGuestToken = "";
let testPushEndpoint = "";
let checks = 0;

function pass(name, detail = "") {
  checks++;
  process.stdout.write("PASS " + name + (detail ? " — " + detail : "") + "\n");
}

async function request(functionName, body, { token = accessToken, timeout = 15000 } = {}) {
  const headers = { ...baseHeaders, "content-type": "application/json" };
  if (token) headers["x-server-session-token"] = token;
  const response = await fetch(projectUrl + "/functions/v1/" + functionName, {
    method: "POST", headers, body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  if (!response.ok) {
    const error = new Error(functionName + " returned HTTP " + response.status + " (" +
      String(data.error || text.slice(0, 120)) + ")");
    error.status = response.status;
    error.code = data.error || "HTTP_ERROR";
    throw error;
  }
  return data;
}

function guestTokenFrom(urlValue) {
  const inviteUrl = new URL(urlValue);
  const token = inviteUrl.searchParams.get("token") ||
    inviteUrl.pathname.match(/\/c\/([0-9a-f]{64})$/i)?.[1] || "";
  assert.match(token, /^[0-9a-f]{64}$/i, "guest preview must carry a 256-bit hex invitation token");
  return token;
}

async function guest(token, action, extra = {}) {
  return request("server-guest", { token, action, ...extra }, { token: "" });
}

async function receiver(action, extra = {}) {
  return request("server-receiver", { action, ...extra });
}

function guestTokenFromReceiverUrl(value) {
  const inviteUrl = new URL(value);
  const token = new URLSearchParams(inviteUrl.hash.replace(/^#/, "")).get("token") || "";
  assert.match(token, /^[0-9a-f]{64}$/i, "native Receiver recovery URL must carry a one-use guest token");
  return token;
}

async function enrolTestNativeReceiver() {
  const created = await receiver("create_invites", { recipients: [destination] });
  assert.equal(created.ok, true);
  assert.equal(created.invitation_count, 1);
  const setupUrl = new URL(created.results[0].invitation_url);
  const setupToken = new URLSearchParams(setupUrl.hash.replace(/^#/, "")).get("token");
  assert.match(setupToken || "", /^[0-9a-f]{64}$/i);
  const deviceSecret = randomBytes(32).toString("hex");
  const endpoint = "https://fcm.googleapis.com/fcm/send/server-native-contract-" + randomUUID();
  const subscription = {
    endpoint, expirationTime: null,
    keys: { p256dh: randomBytes(65).toString("base64url"), auth: randomBytes(16).toString("base64url") }
  };
  const claimed = await receiver("claim", {
    token: setupToken, consent: true, device_secret: deviceSecret, subscription
  });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.registered, true);
  const pair = await receiver("native_pair", { device_secret: deviceSecret });
  assert.equal(pair.ok, true);
  assert.match(pair.pair_code || "", /^[0-9a-f]{32}$/i);
  const native = await receiver("native_claim", { pair_code: pair.pair_code });
  assert.equal(native.ok, true);
  assert.match(native.native_secret || "", /^[0-9a-f]{64}$/i);
  testNativeReceiver = { endpoint, deviceSecret, nativeSecret: native.native_secret };
  const roster = await receiver("native_roster", { native_secret: native.native_secret, ready: true });
  assert.equal(roster.ok, true);
  pass("synthetic Android Receiver enrolled and paired", "one-time setup link, native secret and ready caller roster");
  return testNativeReceiver;
}

async function chooseFreshGuestNumber() {
  const startIndex = randomInt(100);
  let lastStatus = "no candidate checked";
  for (let offset = 0; offset < 25; offset++) {
    const candidate = "+120255501" + String((startIndex + offset) % 100).padStart(2, "0");
    const availability = await request("server-calls", {
      action: "availability", to_phone: candidate
    });
    const status = availability.recipient_availability?.status;
    if (availability.ok === true && status === "unknown_guest" &&
        availability.recipient_availability?.internet_status === "unknown") {
      destination = candidate;
      return destination;
    }
    lastStatus = status || availability.error || "missing recipient status";
  }
  throw new Error("No unused fictional guest number was found for this run: " + lastStatus);
}

async function chooseFreshGuestNumbers(count) {
  const startIndex = randomInt(100);
  const chosen = [];
  for (let offset = 0; offset < 100 && chosen.length < count; offset++) {
    const candidate = "+120255501" + String((startIndex + offset) % 100).padStart(2, "0");
    const availability = await request("server-calls", {
      action: "availability", to_phone: candidate
    });
    if (availability.ok === true &&
        availability.recipient_availability?.status === "unknown_guest" &&
        availability.recipient_availability?.internet_status === "unknown") {
      chosen.push(candidate);
    }
  }
  assert.equal(chosen.length, count, "must find " + count + " unused, unregistered fictional guest numbers");
  return chosen;
}

async function startGuestCall() {
  const created = await request("server-calls", { action: "start", to_phone: destination });
  assert.equal(created.ok, true);
  assert.equal(created.route, "guest");
  assert.ok(created.call_id);
  assert.equal(created.call?.state, "ringing");
  assert.ok(created.guest_invite_url);
  assert.ok((created.invitation_text || "").startsWith("SERVER CALL\n"),"the guest invitation text is branded");
  assert.ok((created.invitation_text || "").includes("Expires in 5 minutes"),"the guest invitation advertises its five-minute Receiver reconnect window");
  assert.ok((created.guest_invite_url || "").includes("/c/"),"the invitation ends with the caller-preview URL");
  const inviteExpiryMs = Date.parse(created.invite_expires_at || "") - Date.now();
  assert.ok(inviteExpiryMs > 0 && inviteExpiryMs <= 305000,
    "the actual guest invitation token must expire within five minutes for offline Receiver recovery");
  createdCallIds.add(created.call_id);
  createdCallTokens.set(created.call_id, accessToken);
  return { created, token: guestTokenFrom(created.guest_invite_url) };
}

async function inspect(token) { return guest(token, "inspect"); }
async function callerPoll(callId, afterSeq = 0) {
  return request("server-calls", { action: "poll", call_id: callId, after_seq: afterSeq });
}
async function assertCallState(token, state) {
  const result = await inspect(token);
  assert.equal(result.call?.state, state, "guest inspection must report the persisted call state");
  return result;
}

async function cleanup() {
  if (activeGuestToken && testPushEndpoint) {
    try { await guest(activeGuestToken, "push_unsubscribe", { endpoint: testPushEndpoint }); } catch {}
  }
  for (const callId of createdCallIds) {
    try {
      await request("server-calls", { action: "end", call_id: callId }, {
        token: createdCallTokens.get(callId) || accessToken
      });
    } catch {}
  }
  if (testNativeReceiver) {
    try {
      await receiver("revoke", {
        endpoint: testNativeReceiver.endpoint,
        device_secret: testNativeReceiver.deviceSecret
      });
    } catch {}
  }
  for (const token of [accessToken, ...secondaryAccessTokens].filter(Boolean)) {
    try { await request("server-auth", { action: "logout" }, { token }); } catch {}
  }
}

try {
  // Device-first auth bootstrap: no OTP, verified phone, or carrier SMS.
  const registered = await request("server-auth", {
    action: "register_device",
    installation_id: randomUUID(),
    device_secret: randomBytes(32).toString("hex"),
    display_name: callerName,
    accepted_terms: true,
    terms_version: "server-terms-1.0",
    privacy_version: "server-privacy-1.0"
  }, { token: "" });
  assert.equal(registered.ok, true);
  assert.match(registered.access_token || "", /^[0-9a-f]{64}$/);
  assert.match(registered.user?.server_id || "", /^SVR-[0-9A-F]{10}$/);
  accessToken = registered.access_token;
  pass("disposable authenticated Server identity", "device-first registration; no OTP or SMS");

  // Select an unused fictional number before any call creation. This prevents
  // a prior Web Push subscription from receiving a test invitation.
  await chooseFreshGuestNumber();
  pass("fresh fictional guest destination selected", destination);

  // First call: check the deployed OG document/image and guest signalling lifecycle.
  const first = await startGuestCall();
  const { created, token } = first;
  pass("guest call created atomically", "call_id=" + created.call_id);

  // Exercise the server side of offline recovery without placing an actual
  // carrier call: a synthetic enrolled Receiver obtains a fresh link for the
  // original still-live call, then a second Server identity must be able to
  // recover its own new call while excluding the first call ID.
  const nativeReceiver = await enrolTestNativeReceiver();
  const pendingA = await receiver("native_pending_call", {
    native_secret: nativeReceiver.nativeSecret
  });
  assert.equal(pendingA.ok, true);
  assert.equal(pendingA.pending, true);
  assert.equal(pendingA.call_id, created.call_id);
  const recoveredAToken = guestTokenFromReceiverUrl(pendingA.invitation_url);
  const recoveredA = await inspect(recoveredAToken);
  assert.equal(recoveredA.call_id, created.call_id);
  assert.equal(recoveredA.call?.state, "ringing");
  assert.equal(recoveredA.caller_label, callerName);
  pass("offline Receiver recovers caller A's original live call", "fresh one-use WebRTC invite points to the existing call ID");

  const secondCallerName = "Server Test C " + randomUUID().slice(0, 8);
  const secondCaller = await request("server-auth", {
    action: "register_device",
    installation_id: randomUUID(),
    device_secret: randomBytes(32).toString("hex"),
    display_name: secondCallerName,
    accepted_terms: true,
    terms_version: "server-terms-1.0",
    privacy_version: "server-privacy-1.0"
  }, { token: "" });
  assert.equal(secondCaller.ok, true);
  assert.match(secondCaller.access_token || "", /^[0-9a-f]{64}$/);
  secondaryAccessTokens.push(secondCaller.access_token);
  const originalAccessToken = accessToken;
  accessToken = secondCaller.access_token;
  const secondCall = await startGuestCall();
  accessToken = originalAccessToken;
  const pendingC = await receiver("native_pending_call", {
    native_secret: nativeReceiver.nativeSecret,
    exclude_call_id: created.call_id
  });
  assert.equal(pendingC.ok, true);
  assert.equal(pendingC.pending, true);
  assert.equal(pendingC.call_id, secondCall.created.call_id);
  const recoveredCToken = guestTokenFromReceiverUrl(pendingC.invitation_url);
  const recoveredC = await inspect(recoveredCToken);
  assert.equal(recoveredC.call_id, secondCall.created.call_id);
  assert.equal(recoveredC.caller_label, secondCallerName);
  pass("the same Receiver recovers a different Server caller C", "A's opened call is excluded; C's independent call is returned");


  const previewResponse = await fetch(created.guest_invite_url, {
    redirect: "manual", signal: AbortSignal.timeout(15000)
  });
  assert.equal(previewResponse.status, 200, "preview endpoint must render OG HTML");
  const previewHtml = await previewResponse.text();
  assert.match(previewHtml, /property="og:title"/);
  assert.match(previewHtml, /property="og:image"/);
  assert.ok(previewHtml.includes(callerName), "Open Graph title must show the caller's chosen display name");
  const imageHref = previewHtml.match(/property="og:image" content="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
  assert.ok(imageHref, "OG image URL must be present");
  const imageResponse = await fetch(new URL(imageHref, created.guest_invite_url), {
    signal: AbortSignal.timeout(15000)
  });
  assert.equal(imageResponse.status, 200);
  assert.match(imageResponse.headers.get("content-type") || "", /image\/png/i);
  const png = Buffer.from(await imageResponse.arrayBuffer());
  assert.ok(png.length > 256 && png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
  assert.ok(png.includes(Buffer.from("Caller=" + callerName)));
  pass("live Open Graph preview and per-invitation PNG", "the caller-chosen display name matches in HTML and image metadata");

  const initial = await inspect(token);
  assert.equal(initial.call_id, created.call_id);
  assert.equal(initial.call?.state, "ringing");
  assert.equal(initial.joined, false);
  assert.equal(initial.caller_label, callerName);
  assert.equal(initial.caller_display_name, callerName);
  pass("guest invite inspection returns the caller-chosen display name");

  // Enrol a synthetic browser receiver. The endpoint is deliberately never sent a
  // push notification; this only proves subscription, key provisioning and presence.
  const pushConfig = await guest(token, "push_config");
  assert.match(pushConfig.vapid_public_key || "", /^[A-Za-z0-9_-]{80,100}$/);
  pass("server-side VAPID keypair provisioned; only the public key is returned");

  const fakeSubscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/server-contract-" + randomUUID(),
    expirationTime: null,
    keys: {
      p256dh: randomBytes(65).toString("base64url"),
      auth: randomBytes(16).toString("base64url")
    }
  };
  activeGuestToken = token;
  testPushEndpoint = fakeSubscription.endpoint;
  const subscribed = await guest(token, "push_subscribe", {
    consent: true, subscription: fakeSubscription
  });
  assert.equal(subscribed.ok, true);
  assert.equal(subscribed.subscribed, true);
  const presence = await guest(token, "push_presence", { endpoint: fakeSubscription.endpoint });
  assert.equal(presence.ok, true);
  assert.equal(presence.online, true);
  const available = await request("server-calls", {
    action: "availability", to_phone: destination
  });
  assert.equal(available.recipient_availability?.status, "online");
  assert.equal(available.recipient_availability?.background_wake_possible, true);
  pass("a number-bound browser heartbeat changes guest reachability from unknown to online");

  const unsubscribed = await guest(token, "push_unsubscribe", { endpoint: fakeSubscription.endpoint });
  assert.equal(unsubscribed.ok, true);
  assert.equal(unsubscribed.subscribed, false);
  activeGuestToken = "";
  testPushEndpoint = "";
  pass("guest browser subscription can be revoked without an account or SMS");

  const joinAttempts = await Promise.allSettled([
    guest(token, "join"),
    guest(token, "join")
  ]);
  const successfulJoins = joinAttempts.filter(result => result.status === "fulfilled");
  const rejectedJoins = joinAttempts.filter(result => result.status === "rejected");
  assert.equal(successfulJoins.length, 1, "only one browser session may claim a guest invitation");
  assert.equal(rejectedJoins.length, 1);
  assert.match(String(rejectedJoins[0].reason?.message || ""), /HTTP 409.*GUEST_ALREADY_JOINED/);
  const joined = successfulJoins[0].value;
  assert.equal(joined.ok, true);
  assert.equal(joined.call?.state, "connecting");
  const connectedSetupWindow = Date.parse(joined.call?.expires_at || "") - Date.now();
  assert.ok(connectedSetupWindow >= 9 * 60 * 1000,
    "joining within the five-minute invitation window extends the call setup session to at least ten minutes");
  const realtime = await guest(token, "realtime_token");
  if (realtime.realtime_available === true) {
    assert.ok((realtime.url || "").startsWith("wss://"));
    const realtimeTokenParts = (realtime.token || "").split(".");
    assert.equal(realtimeTokenParts.length, 3);
    assert.ok(realtimeTokenParts.every(part => /^[A-Za-z0-9_-]+$/.test(part)));
    const claims = JSON.parse(Buffer.from(realtimeTokenParts[1], "base64url").toString("utf8"));
    assert.ok(Array.isArray(claims.channels));
    assert.ok(claims.channels.includes("$server-call:" + created.call_id));
    pass("guest Centrifugo token is scoped to its answered call");
  } else {
    process.stdout.write("WARN CENTRIFUGO_NOT_CONFIGURED: guest browser must use compatibility HTTP polling; this is not the high-concurrency realtime path.\n");
  }
  const claimed = await inspect(token);
  assert.equal(claimed.joined, true);
  pass("one-time guest join claim serialized", "one browser joins; the competing session receives HTTP 409");
  await assert.rejects(() => guest(token, "decline"), /HTTP 409.*GUEST_ALREADY_JOINED/,
    "a second browser must not decline an invitation after it has been answered");
  pass("answered invitation protected from remote decline");
  assert.ok(Array.isArray(joined.ice_servers) && joined.ice_servers.length > 0);
  assert.ok(["cloudflare-turn", "coturn-turn", "stun-only"].includes(joined.ice_server_mode));
  const hasTurn = joined.ice_servers.some(row => {
    const urls = Array.isArray(row.urls) ? row.urls : [row.urls];
    return urls.some(url => typeof url === "string" && /^turns?:/i.test(url));
  });
  pass("guest answer/join transition and ICE configuration",
    "mode=" + joined.ice_server_mode + ", TURN URLs=" + (hasTurn ? "present" : "not configured"));
  if (!hasTurn) {
    process.stdout.write("WARN TURN_NOT_CONFIGURED: STUN-only config was returned; this is not proof of TURN relay connectivity.\n");
  }

  const offerMarker = "server-live-contract-offer-" + randomUUID();
  const offer = await request("server-calls", {
    action: "signal", call_id: created.call_id, kind: "offer",
    payload: { type: "offer", contract_probe: offerMarker }
  });
  assert.ok(Number(offer.seq) > 0);
  const guestSawOffer = await guest(token, "poll", { after_seq: 0 });
  const deliveredOffer = (guestSawOffer.signals || []).find(row => row.payload?.contract_probe === offerMarker);
  assert.ok(deliveredOffer, "guest polling must receive the caller's committed offer signal");
  assert.equal(guestSawOffer.call?.state, "connecting");
  pass("caller-to-guest signalling persistence and poll");

  const answerMarker = "server-live-contract-answer-" + randomUUID();
  const answer = await guest(token, "signal", {
    call_id: created.call_id, kind: "answer",
    payload: { type: "answer", contract_probe: answerMarker }
  });
  assert.ok(Number(answer.seq) > Number(offer.seq));
  const callerSawAnswer = await callerPoll(created.call_id, Number(offer.seq));
  const deliveredAnswer = (callerSawAnswer.signals || []).find(row => row.payload?.contract_probe === answerMarker);
  assert.ok(deliveredAnswer, "caller polling must receive the guest's committed answer signal");
  pass("guest-to-caller signalling persistence and poll");

  const active = await request("server-calls", { action: "set_active", call_id: created.call_id });
  assert.equal(active.ok, true);
  assert.equal(active.state, "active");
  await assertCallState(token, "active");
  pass("active call-state transition visible to guest");

  const left = await guest(token, "leave");
  assert.equal(left.ok, true);
  assert.equal(left.state, "ended");
  const ended = await assertCallState(token, "ended");
  assert.equal(ended.call?.id, created.call_id);
  const endedForCaller = await callerPoll(created.call_id, Number(answer.seq));
  assert.equal(endedForCaller.call?.state, "ended");
  const repeatedEnd = await request("server-calls", { action: "end", call_id: created.call_id });
  assert.equal(repeatedEnd.ok, true);
  assert.equal(repeatedEnd.already_ended, true);
  pass("guest leave, caller end-state visibility and idempotent hangup");

  // Separate pre-answer decline path.
  const second = await startGuestCall();
  const decline = await guest(second.token, "decline");
  assert.equal(decline.ok, true);
  assert.equal(decline.state, "ended");
  const declined = await assertCallState(second.token, "ended");
  assert.equal(declined.call?.id, second.created.call_id);
  const declinedForCaller = await callerPoll(second.created.call_id, 0);
  assert.equal(declinedForCaller.call?.state, "ended");
  assert.ok((declinedForCaller.signals || []).some(row => row.kind === "hangup"));
  pass("guest decline and caller notification through persisted hangup signal");

  // Race two terminal requests against the same invitation. Row locking must
  // allow one state-changing decline and persist exactly one signalling row.
  const raced = await startGuestCall();
  const outcomes = await Promise.allSettled([
    guest(raced.token, "decline"),
    guest(raced.token, "decline")
  ]);
  const fulfilled = outcomes.filter(result => result.status === "fulfilled");
  const rejected = outcomes.filter(result => result.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one concurrent decline should transition the call");
  assert.equal(rejected.length, 1, "the racing decline must observe the already-ended state");
  assert.equal(rejected[0].reason.status, 409, "the losing decline must return HTTP 409, not a server error");
  const racedForCaller = await callerPoll(raced.created.call_id, 0);
  assert.equal(racedForCaller.call?.state, "ended");
  const declinedSignals = (racedForCaller.signals || []).filter(row =>
    row.kind === "hangup" && row.payload?.reason === "declined");
  assert.equal(declinedSignals.length, 1, "exactly one decline signal must be persisted");
  pass("concurrent decline serialization", "one success, one HTTP 409, exactly one hang-up signal");

  // Ten-recipient guest batch: each destination must receive a separate,
  // single-use link and atomic call/invitation record. The destinations are
  // reserved fictional NANP numbers, so no real person, carrier SMS or push
  // subscription is contacted by this test.
  const batchDestinations = await chooseFreshGuestNumbers(10);
  const batch = await request("server-calls", {
    action: "start_guest_batch",
    recipients: batchDestinations
  });
  assert.equal(batch.ok, true);
  assert.equal(batch.requested_count, 10);
  assert.equal(batch.created_count, 10);
  assert.equal(batch.failed_count, 0);
  assert.equal(batch.results?.length, 10);
  assert.equal(batch.carrier_sms_used, false);
  assert.equal(batch.carrier_charges_possible, false);
  const batchCallIds = batch.results.map(item => item.call_id);
  const batchUrls = batch.results.map(item => item.guest_invite_url);
  const batchTokens = batchUrls.map(guestTokenFrom);
  assert.equal(new Set(batchCallIds).size, 10, "every recipient must have a distinct call record");
  assert.equal(new Set(batchUrls).size, 10, "every recipient must have a distinct preview URL");
  assert.equal(new Set(batchTokens).size, 10, "every recipient must have a distinct one-time token");
  const batchInspections = await Promise.all(batch.results.map(item =>
    inspect(guestTokenFrom(item.guest_invite_url))
  ));
  for (let i = 0; i < batch.results.length; i++) {
    const item = batch.results[i];
    assert.equal(item.ok, true);
    assert.equal(item.recipient_e164, batchDestinations[i]);
    assert.ok(item.invite_id);
    assert.ok(item.invitation_text.includes(callerName));
    assert.equal(item.delivery?.mode, "manual_share",
      "fictional destinations without an enrolled receiver must receive a shareable link, never carrier SMS");
    assert.equal(item.delivery?.device_delivery_confirmed, false);
    assert.equal(item.delivery?.first_contact_requires_user_share, true);
    assert.equal(batchInspections[i].call_id, item.call_id,
      "each returned bearer token must inspect to its own call record");
    assert.equal(batchInspections[i].call?.state, "ringing");
    assert.equal(batchInspections[i].caller_label, callerName);
    createdCallIds.add(item.call_id);
  }
  pass("ten-recipient batch created ten independent guest invitations",
    "10 unique call IDs, 10 unique preview links and 10 unique invitation tokens");
  pass("ten-recipient batch stayed on free internet/manual-share transport",
    "carrier_sms_used=false; carrier_charges_possible=false; no carrier queue");

  process.stdout.write("\nLive guest transition integration: " + checks + "/" + checks + " checks passed.\n");
} finally {
  await cleanup();
}
