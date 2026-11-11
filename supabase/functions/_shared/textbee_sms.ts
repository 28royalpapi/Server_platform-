/**
 * Server's hosted TextBee transport adapter.
 *
 * The API key is read only inside the Edge Function. Never pass it to the
 * Android app, web client, logs, or database. A successful HTTP response means
 * TextBee accepted/queued the SMS; carrier delivery is a separate status.
 */
export type TextBeeSendResult =
  | { outcome: "disabled" }
  | { outcome: "accepted"; smsBatchId: string | null }
  | { outcome: "rejected"; httpStatus: number }
  | { outcome: "uncertain"; httpStatus?: number };

export async function sendTextBeeSms(input: {
  recipient: string;
  message: string;
}): Promise<TextBeeSendResult> {
  const apiKey = (Deno.env.get("TEXTBEE_API_KEY") || "").trim();
  if (!apiKey) return { outcome: "disabled" };

  const configuredBase = (Deno.env.get("TEXTBEE_BASE_URL") || "https://api.textbee.dev/api/v1")
    .trim().replace(/\/+$/, "");
  let endpoint: URL;
  try {
    endpoint = new URL(configuredBase + "/gateway/send-sms");
  } catch {
    console.error("TEXTBEE_CONFIGURATION_INVALID");
    return { outcome: "rejected", httpStatus: 0 };
  }
  if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost" && endpoint.hostname !== "127.0.0.1") {
    console.error("TEXTBEE_CONFIGURATION_INVALID");
    return { outcome: "rejected", httpStatus: 0 };
  }

  const deviceId = (Deno.env.get("TEXTBEE_DEVICE_ID") || "").trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(endpoint.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify({
        recipients: [input.recipient],
        message: input.message,
        ...(deviceId ? { deviceId } : {})
      }),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => null) as any;
    if (!response.ok) {
      // A 5xx response may happen after the provider accepted the request.
      // Do not fall back and risk sending the same invitation twice.
      if (response.status >= 500) {
        console.warn("TEXTBEE_SEND_OUTCOME_UNCERTAIN_HTTP_" + response.status);
        return { outcome: "uncertain", httpStatus: response.status };
      }
      console.warn("TEXTBEE_SEND_REJECTED_HTTP_" + response.status);
      return { outcome: "rejected", httpStatus: response.status };
    }

    const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
    const batchId = [
      data?.smsBatchId,
      payload?.smsBatchId,
      payload?.batch?.smsBatchId,
      data?.batchId
    ].find((value) => typeof value === "string" && value.trim().length > 0) || null;
    const successCount = Number(data?.successCount || 0);
    const failureCount = Number(data?.failureCount || 0);

    if (data?.success === false || (failureCount > 0 && successCount === 0)) {
      console.warn("TEXTBEE_SEND_NOT_QUEUED");
      return { outcome: "rejected", httpStatus: 200 };
    }
    if (data?.success !== true && successCount < 1 && !batchId) {
      console.warn("TEXTBEE_SEND_RESPONSE_UNRECOGNIZED");
      return { outcome: "uncertain", httpStatus: 200 };
    }

    return { outcome: "accepted", smsBatchId: batchId };
  } catch {
    // A timeout/network reset cannot tell us whether TextBee accepted the SMS.
    // Leave it for status inspection rather than automatically sending twice.
    console.warn("TEXTBEE_SEND_OUTCOME_UNCERTAIN_NETWORK");
    return { outcome: "uncertain" };
  } finally {
    clearTimeout(timeout);
  }
}
