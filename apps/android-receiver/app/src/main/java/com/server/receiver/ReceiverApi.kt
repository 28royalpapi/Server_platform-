package com.server.receiver

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

internal object ReceiverApi {
  private val endpoint = BuildConfig.SUPABASE_URL.trimEnd('/') + "/functions/v1/server-receiver"

  fun post(action: String, token: String, values: JSONObject = JSONObject()): JSONObject {
    require(endpoint.startsWith("https://")) { "Receiver backend must use HTTPS." }
    val body = JSONObject(values.toString())
      .put("action", action)
      .put("token", token)
    val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      connectTimeout = 12_000
      readTimeout = 12_000
      doOutput = true
      setRequestProperty("content-type", "application/json")
      setRequestProperty("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
      setRequestProperty("cache-control", "no-store")
    }
    try {
      connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
      val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
      val response = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
      val json = JSONObject(response.ifBlank { "{}" })
      if (connection.responseCode !in 200..299) {
        throw IllegalStateException(json.optString("message", json.optString("error", "Receiver setup failed.")))
      }
      return json
    } finally {
      connection.disconnect()
    }
  }
}
