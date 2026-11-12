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

    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { socket.close(1000, "Realtime smoke complete"); } catch {}
      if (error) reject(error);
      else resolve();
    };

    const timer = setTimeout(() => {
      finish(new Error("Realtime wake broadcast was not received within 12 seconds"));
    }, 12_000);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        topic: wireTopic,
        event: "phx_join",
        payload: {
          config: {
            broadcast: { ack: false, self: false },
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
      try { message = JSON.parse(String(frame.data)); } catch { return; }

      if (message.event === "phx_reply" &&
          message.topic === wireTopic &&
          message.payload?.status === "ok" &&
          !joinAccepted) {
        joinAccepted = true;
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
                event: eventName,
                payload: { wake: true }
              }]
            })
          });
          if (!response.ok) {
            const body = (await response.text()).slice(0, 240);
            finish(new Error("Realtime REST broadcast returned HTTP " + response.status + ": " + body));
          } else {
            broadcastSent = true;
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
