import { randomBytes, randomInt, randomUUID } from "node:crypto";

const projectUrl = process.env.SERVER_SUPABASE_URL || "https://hzuovekqsjtpvmbuybxs.supabase.co";
const publishableKey = process.env.SERVER_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_denBmNsOLdaEYPjFr4JxTA_XgElA64E";
const response = await fetch(projectUrl.replace(/\/$/, "") + "/functions/v1/server-auth", {
  method: "POST",
  headers: { "content-type": "application/json", apikey: publishableKey },
  body: JSON.stringify({
    action: "register_device",
    installation_id: randomUUID(),
    device_secret: randomBytes(32).toString("hex"),
    display_name: "Server E2E " + randomUUID().slice(0, 8),
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

// Exercise the deployed authenticated availability preflight without creating
// a call or sending SMS/push. Pick an unused number from the NANP fictional
// 555-0100..0199 range so old browser subscriptions from prior CI runs cannot
// redirect a test notification to a previously enrolled endpoint.
const startIndex = randomInt(100);
let testPhone = "";
let lastPreflightStatus = "no candidate checked";
for (let offset = 0; offset < 25; offset++) {
  const candidateIndex = (startIndex + offset) % 100;
  const candidatePhone = "+120255501" + String(candidateIndex).padStart(2, "0");
  const availabilityResponse = await fetch(projectUrl.replace(/\/$/, "") + "/functions/v1/server-calls", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: publishableKey,
      "x-server-session-token": result.access_token
    },
    body: JSON.stringify({ action: "availability", to_phone: candidatePhone })
  });
  const availability = await availabilityResponse.json().catch(() => ({}));
  if (!availabilityResponse.ok || availability.ok !== true) {
    lastPreflightStatus = availability.error || "HTTP " + availabilityResponse.status;
    break;
  }
  const status = availability.recipient_availability?.status;
  if (status === "unknown_guest" && availability.recipient_availability?.internet_status === "unknown") {
    testPhone = candidatePhone;
    lastPreflightStatus = "unknown_guest";
    break;
  }
  if (status === "online" || status === "background_reachable") {
    lastPreflightStatus = status + " for " + candidatePhone;
    continue;
  }
  lastPreflightStatus = status || "missing recipient availability status";
  break;
}
if (!testPhone) {
  throw new Error(
    "The deployed Server availability preflight could not find a fresh fictional guest number: " +
    lastPreflightStatus
  );
}

process.stdout.write(JSON.stringify({
  access_token: result.access_token,
  access_expiry: Math.floor(expiresAt / 1000),
  server_id: serverId,
  test_phone: testPhone,
  availability_preflight: "passed"
}));
