package com.server.caller

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Authenticated HTTP access to the first-party Server SMS gateway endpoint. */
internal object ServerSmsGatewayApi {
  private fun post(
    context: Context,
    body: JSONObject,
    sessionToken: String? = null,
    gatewayToken: String? = null
  ): JSONObject {
    val base = BuildConfig.SUPABASE_URL.trimEnd('/')
    val connection = (URL("$base/functions/v1/server-gateway").openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      connectTimeout = 12000
      readTimeout = 15000
      doOutput = true
      setRequestProperty("content-type", "application/json")
      setRequestProperty("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
      if (!sessionToken.isNullOrBlank()) setRequestProperty("x-server-session-token", sessionToken)
      if (!gatewayToken.isNullOrBlank()) setRequestProperty("x-server-gateway-token", gatewayToken)
    }
    return try {
      connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
      val status = connection.responseCode
      val stream = if (status in 200..299) connection.inputStream else connection.errorStream
      val raw = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
      val result = try { JSONObject(raw) } catch (_: Exception) { JSONObject() }
      if (status !in 200..299) {
        if (result.optString("error").isBlank()) result.put("error", "HTTP_$status")
        result.put("ok", false)
      }
      result.put("http_status", status)
    } finally {
      connection.disconnect()
    }
  }

  fun registerDevice(
    context: Context,
    sessionToken: String,
    subscriptionId: Int,
    slotIndex: Int,
    carrier: String
  ): JSONObject {
    val safeCarrier = carrier.trim().take(80).ifBlank { "Mobile network" }
    return post(
      context,
      JSONObject()
        .put("action", "register_device")
        .put("subscription_id", subscriptionId)
        .put("sim_slot_index", slotIndex)
        .put("carrier_label", safeCarrier)
        .put("device_label", "SIM ${slotIndex + 1} · $safeCarrier"),
      sessionToken = sessionToken
    )
  }

  /**
   * Claims a Server-operated SMS handset using its one-time operator pairing code.
   * No customer Server session is accepted or required for platform-owned hardware.
   */
  fun claimPlatformDevice(
    context: Context,
    pairingCode: String,
    subscriptionId: Int,
    slotIndex: Int,
    carrier: String
  ): JSONObject {
    val safeCarrier = carrier.trim().take(80).ifBlank { "Mobile network" }
    return post(
      context,
      JSONObject()
        .put("action", "claim_platform_device")
        .put("pairing_code", pairingCode.trim().lowercase())
        .put("subscription_id", subscriptionId)
        .put("sim_slot_index", slotIndex)
        .put("carrier_label", safeCarrier)
    )
  }

  fun disconnect(context: Context, sessionToken: String, deviceId: String): JSONObject =
    post(context, JSONObject().put("action", "disconnect").put("device_id", deviceId), sessionToken = sessionToken)

  fun status(context: Context): JSONObject {
    val token = ServerSmsGatewaySecureStore.token(context)
      ?: return JSONObject().put("ok", false).put("error", "GATEWAY_NOT_REGISTERED")
    return post(context, JSONObject().put("action", "status"), gatewayToken = token)
  }

  fun postGateway(context: Context, body: JSONObject): JSONObject {
    val token = ServerSmsGatewaySecureStore.token(context)
      ?: throw IllegalStateException("SMS gateway is not connected")
    val response = post(context, body, gatewayToken = token)
    if (!response.optBoolean("ok", response.optInt("http_status") in 200..299)) {
      throw IllegalStateException(response.optString("error", "GATEWAY_REQUEST_FAILED"))
    }
    return response
  }
}
