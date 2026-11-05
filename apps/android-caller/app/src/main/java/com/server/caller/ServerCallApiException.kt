package com.server.caller

import org.json.JSONObject

/** Carries a structured Server API error to the caller UI without losing its code or safe fallback fields. */
internal class ServerCallApiException(
  val httpStatus: Int,
  val payload: JSONObject,
  reason: String
) : IllegalStateException("$reason (HTTP $httpStatus)") {
  val errorCode: String get() = payload.optString("code").ifBlank { payload.optString("error") }
  val carrierFallback: JSONObject? get() = payload.optJSONObject("carrier_fallback")
}
