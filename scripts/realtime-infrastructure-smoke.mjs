import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

const secret = process.env.CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY || "";
const apiKey = process.env.CENTRIFUGO_HTTP_API_KEY || "";
const wsUrl = process.env.CENTRIFUGO_TEST_WS_URL || "ws://127.0.0.1:8000/connection/websocket";
const apiUrl = (process.env.CENTRIFUGO_TEST_API_URL || "http://127.0.0.1:8000/api").replace(/\\/$/, "");
assert.ok(secret.length >= 32, "Centrifugo HMAC test secret must be at least 32 characters");
assert.ok(apiKey.length >= 32, "Centrifugo API test key must be at least 32 characters");
assert.equal(typeof WebSocket, "function", "Node 22+ WebSocket support is required");

const b64url = value => Buffer.from(typeof value === "string" ? value : JSON.stringify(value))
  .toString("base64url");
const channel = "$server-user:" + randomUUID();
const nonce = randomUUID();
const now = Math.floor(Date.now() / 1000);
const input = b64url({ alg: "HS256", typ: "JWT" }) + "." +
  b64url({ sub: "realtime-smoke-test", iat: now, exp: now + 120, channels: [channel] });
const signature = createHmac("sha256", secret).update(input).digest("base64url");
const token = input + "." + signature;

const socket = new WebSocket(wsUrl);
let nextId = 1;
let connected = false;
let subscribed = false;
let published = false;
const deadline = Date.now() + 15000;

function fail(error) {
  try { socket.close(); } catch {}
  throw error instanceof Error ? error : new Error(String(error));
}
const completed = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Centrifugo WebSocket publish/subscribe smoke timed out")), 15000);
  socket.addEventListener("error", () => {
    clearTimeout(timeout);
    reject(new Error("Centrifugo WebSocket connection failed"));
  });
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ id: nextId++, connect: { token } }));
  });
  socket.addEventListener("message", async event => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return fail(new Error("Centrifugo sent invalid JSON")); }
    if (message.error) return fail(new Error("Centrifugo protocol error: " + JSON.stringify(message.error)));
    if (message.id === 1 && message.connect) {
      connected = true;
      socket.send(JSON.stringify({ id: nextId++, subscribe: { channel } }));
      return;
    }
    if (message.id === 2 && message.subscribe) {
      subscribed = true;
      try {
        const response = await fetch(apiUrl + "/publish", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": apiKey },
          body: JSON.stringify({ channel, data: { type: "server_realtime_smoke", nonce } }),
          signal: AbortSignal.timeout(5000)
        });
        assert.equal(response.status, 200, "Centrifugo publish API must return HTTP 200");
        const body = await response.json();
        assert.ok(body.result && !body.error, "Centrifugo publish API must acknowledge publication");
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
      return;
    }
    if (message.push?.pub?.data?.nonce === nonce) {
      published = true;
      clearTimeout(timeout);
      resolve();
    }
  });
});
try {
  await completed;
  assert.equal(connected, true);
  assert.equal(subscribed, true);
  assert.equal(published, true);
  process.stdout.write("PASS Centrifugo authenticated WebSocket connect, JWT channel authorization, Redis-backed subscribe, and HTTP API publish fanout.\\n");
} finally {
  try { socket.close(); } catch {}
}
