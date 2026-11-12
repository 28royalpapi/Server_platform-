import { randomBytes } from "node:crypto";

const projectUrl = "https://hzuovekqsjtpvmbuybxs.supabase.co";
const publishableKey = "sb_publishable_denBmNsOLdaEYPjFr4JxTA_XgElA64E";
const topic = "server-gateway-smoke-" + randomBytes(12).toString("hex");
const wireTopic = "realtime:" + topic;
const eventName = "gateway_wake";

async function smoke() {
  await new Promise((resolve, reject) => {
    const wsUrl = new URL(projectUrl + "/realtime/v1/websocket");
    wsUrl.searchParams.set("apikey", publishableKey);
    wsUrl.searchParams.set("vsn", "1.0.0");

    const socket = new WebSocket(wsUrl);
    let joinAccepted = false;
    let broadcastSent = false;
    let finished = false;
    let lastFrame = "no-frame";
    let restStatus = null;

    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { socket.close(1000, "Realtime smoke complete"); } catch {}
      if (error) reject(error);
      else resolve();
    };

    const timer = setTimeout(() => {
      finish(new Error("Realtime timeout: joinAccepted=" + joinAccepted + ", broadcastSent=" + broadcastSent + ", restStatus=" + restStatus + ", lastFrame=" + lastFrame));
    }, 12_000);

    socket.addEventListener("open", () => {
      lastFrame = "websocket-open";
      socket.send(JSON.stringify({
        topic: wireTopic,
        event: "phx_join",
        payload: {
          config: {
            broadcast: { ack: true, self: true },
            presence: { enabled: false },
            private: false
          }
        },
        ref: "1",
        join_ref: "1"
      }));
    });

    socket.addEventListener("message", async (frame) => {
      let message;
      try { message = JSON.parse(String(frame.data)); } catch { lastFrame = "non-json-frame"; return; }
      lastFrame = "event=" + String(message.event) + ",topic=" + String(message.topic) + ",payloadStatus=" + String(message.payload?.status || "");

      if (message.event === "phx_reply" &&
          message.topic === wireTopic &&
          message.payload?.status === "ok" &&
          !joinAccepted) {
        joinAccepted = true;
        try {
          await new Promise((resolve) => setTimeout(resolve, 250));
          const response = await fetch(projectUrl + "/realtime/v1/api/broadcast/" + encodeURIComponent(topic) + "/events/" + eventName + "?private=false", {
            method: "POST",
            headers: {
              "apikey": publishableKey,
              "content-type": "application/json"
            },
            body: JSON.stringify({ wake: true })
          });
          restStatus = response.status;
          if (!response.ok) {
            const body = (await response.text()).slice(0, 240);
            finish(new Error("Realtime REST broadcast returned HTTP " + response.status + ": " + body));
          } else {
            broadcastSent = true;
            lastFrame = "broadcast-http-" + response.status;
          }
        } catch (error) {
          finish(error instanceof Error ? error : new Error("Realtime REST broadcast failed"));
        }
        return;
      }

      const payload = message.payload;
      if (message.event === "broadcast" &&
          message.topic === wireTopic &&
          payload?.event === eventName &&
          payload?.payload?.wake === true &&
          broadcastSent) {
        finish();
      }
    });

    socket.addEventListener("error", () => {
      finish(new Error("Realtime WebSocket connection failed"));
    });
  });

  process.stdout.write("PASS: Supabase Realtime accepted and delivered a wake-only broadcast over WebSocket. No SMS was sent.\n");
}

smoke().catch((error) => {
  process.stderr.write("FAIL: " + (error?.message || "Realtime smoke failed") + "\n");
  process.exitCode = 1;
});
