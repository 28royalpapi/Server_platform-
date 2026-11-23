package com.server.receiver

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.telephony.PhoneNumberUtils
import android.telephony.TelephonyManager
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Locale
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

internal data class ServerCaller(val serverId: String, val displayName: String)

internal object ServerReceiverRoster {
  private const val PREFS = "server_receiver_companion"
  private const val SECRET_KEY = "native_secret"
  private const val ROSTER_KEY = "caller_roster_json"
  private const val ENDPOINT_URL = "https://hzuovekqsjtpvmbuybxs.supabase.co/functions/v1/server-receiver"
  private const val API_KEY = "sb_publishable_denBmNsOLdaEYPjFr4JxTA_XgElA64E"

  fun saveSecret(context: Context, secret: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString(SECRET_KEY, secret.lowercase(Locale.ROOT)).apply()
  }

  fun secret(context: Context): String =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(SECRET_KEY, "").orEmpty()

  fun clear(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .remove(SECRET_KEY).remove(ROSTER_KEY).apply()
  }

  fun claimPair(code: String): String {
    val result = post(JSONObject().put("action", "native_claim").put("pair_code", code))
    return result.optString("native_secret")
  }

  fun sync(context: Context, nativeSecret: String = secret(context)): Int {
    require(nativeSecret.matches(Regex("^[0-9a-f]{64}$"))) { "Receiver pairing is missing or invalid." }
    val response = post(JSONObject().put("action", "native_roster").put("native_secret", nativeSecret))
    val roster = response.optJSONArray("callers") ?: JSONArray()
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString(ROSTER_KEY, roster.toString())
      .putLong("roster_synced_at", System.currentTimeMillis())
      .apply()
    return roster.length()
  }

  fun revoke(context: Context) {
    val current = secret(context)
    if (current.isNotBlank()) post(JSONObject().put("action", "native_revoke").put("native_secret", current))
    clear(context)
  }

  fun match(context: Context, incomingNumber: String?): ServerCaller? {
    val nativeSecret = secret(context)
    if (!nativeSecret.matches(Regex("^[0-9a-f]{64}$"))) return null
    val e164 = normalizeE164(context, incomingNumber ?: return null) ?: return null
    val wanted = hmac(nativeSecret, e164)
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val roster = try { JSONArray(prefs.getString(ROSTER_KEY, "[]") ?: "[]") } catch (_: Exception) { JSONArray() }
    for (i in 0 until roster.length()) {
      val row = roster.optJSONObject(i) ?: continue
      val stored = row.optString("caller_hash")
      if (stored.isNotBlank() && MessageDigest.isEqual(
          stored.toByteArray(Charsets.US_ASCII), wanted.toByteArray(Charsets.US_ASCII))) {
        return ServerCaller(
          serverId = row.optString("server_id").take(40),
          displayName = row.optString("display_name").take(80).ifBlank { "Server user" }
        )
      }
    }
    return null
  }

  fun hasInternet(context: Context): Boolean {
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
    val network = manager.activeNetwork ?: return false
    val caps = manager.getNetworkCapabilities(network) ?: return false
    return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
      caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
  }

  private fun normalizeE164(context: Context, rawNumber: String): String? {
    val raw = rawNumber.substringBefore(';').trim()
    if (raw.isBlank()) return null
    val digits = raw.filter { it.isDigit() }
    if (digits.length < 7) return null
    if (raw.startsWith("+")) return "+$digits"
    if (raw.startsWith("00")) return "+${digits.drop(2)}"
    val telephony = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
    val region = try { telephony?.simCountryIso?.takeIf { it.length == 2 } }
      catch (_: Exception) { null }
      ?: try { telephony?.networkCountryIso?.takeIf { it.length == 2 } } catch (_: Exception) { null }
      ?: return null
    return try { PhoneNumberUtils.formatNumberToE164(raw, region.uppercase(Locale.ROOT)) }
      catch (_: Exception) { null }
  }

  private fun hmac(secret: String, value: String): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
    return mac.doFinal(value.toByteArray(Charsets.UTF_8))
      .joinToString("") { "%02x".format(it) }
  }

  private fun post(body: JSONObject): JSONObject {
    val connection = URL(ENDPOINT_URL).openConnection() as HttpURLConnection
    connection.requestMethod = "POST"
    connection.connectTimeout = 12_000
    connection.readTimeout = 12_000
    connection.doOutput = true
    connection.setRequestProperty("content-type", "application/json")
    connection.setRequestProperty("apikey", API_KEY)
    connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
    val code = connection.responseCode
    val stream = if (code in 200..299) connection.inputStream else connection.errorStream
    val raw = stream?.bufferedReader()?.use { it.readText() } ?: "{}"
    connection.disconnect()
    val json = JSONObject(raw)
    if (code !in 200..299) throw IllegalStateException(
      json.optString("message", json.optString("error", "Server Receiver request failed."))
    )
    return json
  }
}
