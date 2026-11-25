package com.server.caller

import android.Manifest
import android.app.NotificationManager
import android.app.role.RoleManager
import android.content.Context
import android.content.pm.PackageManager
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.telephony.PhoneNumberUtils
import android.telephony.TelephonyManager
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.security.MessageDigest
import java.util.Locale
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

internal data class ServerCaller(val serverId: String, val displayName: String)
internal data class PendingGuestCall(val callId: String, val invitationUrl: String)

internal object ServerReceiverRoster {
  private const val PREFS = "server_receiver_companion"
  private const val SECRET_KEY = "native_secret"
  private const val ROSTER_KEY = "caller_roster_json"
  private const val KEY_ALIAS = "server.receiver.native-secret-key"
  private const val ENDPOINT_URL = "https://hzuovekqsjtpvmbuybxs.supabase.co/functions/v1/server-receiver"
  private const val API_KEY = "sb_publishable_denBmNsOLdaEYPjFr4JxTA_XgElA64E"

  fun saveSecret(context: Context, secret: String) {
    val encrypted = encryptSecret(secret.lowercase(Locale.ROOT))
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString(SECRET_KEY, encrypted).apply()
  }

  fun secret(context: Context): String {
    val encrypted = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(SECRET_KEY, "").orEmpty()
    if (encrypted.isBlank()) return ""
    return try { decryptSecret(encrypted) } catch (_: Exception) { "" }
  }

  fun clear(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .remove(SECRET_KEY).remove(ROSTER_KEY).apply()
    try {
      val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      if (store.containsAlias(KEY_ALIAS)) store.deleteEntry(KEY_ALIAS)
    } catch (_: Exception) {
      // Removing the encrypted credential is sufficient to revoke local access.
    }
  }

  private fun encryptionKey(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .build()
    )
    return generator.generateKey()
  }

  private fun encryptSecret(value: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, encryptionKey())
    val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
    val packed = cipher.iv + encrypted
    return Base64.encodeToString(packed, Base64.NO_WRAP)
  }

  private fun decryptSecret(encoded: String): String {
    val packed = Base64.decode(encoded, Base64.NO_WRAP)
    require(packed.size > 28) { "Stored Receiver credential is invalid." }
    val iv = packed.copyOfRange(0, 12)
    val ciphertext = packed.copyOfRange(12, packed.size)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, encryptionKey(), GCMParameterSpec(128, iv))
    return String(cipher.doFinal(ciphertext), Charsets.UTF_8)
  }

  fun claimPair(code: String): String {
    val result = post(JSONObject().put("action", "native_claim").put("pair_code", code))
    return result.optString("native_secret")
  }

  fun sync(context: Context, nativeSecret: String = secret(context)): Int {
    require(nativeSecret.matches(Regex("^[0-9a-f]{64}$"))) { "Receiver pairing is missing or invalid." }
    val response = post(
      JSONObject().put("action", "native_roster")
        .put("native_secret", nativeSecret)
        .put("ready", isReady(context))
    )
    val roster = response.optJSONArray("callers") ?: JSONArray()
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString(ROSTER_KEY, roster.toString())
      .putLong("roster_synced_at", System.currentTimeMillis())
      .apply()
    return roster.length()
  }

  fun isReady(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < 29) return false
    val roles = context.getSystemService(RoleManager::class.java) ?: return false
    val screeningRole = try { roles.isRoleHeld(RoleManager.ROLE_CALL_SCREENING) } catch (_: Exception) { false }
    val contacts = context.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED
    val notificationsPermission = Build.VERSION.SDK_INT < 33 ||
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    val notificationsEnabled = try {
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).areNotificationsEnabled()
    } catch (_: Exception) { false }
    return screeningRole && contacts && notificationsPermission && notificationsEnabled
  }

  fun pendingGuestCall(
    context: Context,
    nativeSecret: String = secret(context),
    excludeCallId: String = ""
  ): PendingGuestCall? {
    require(nativeSecret.matches(Regex("^[0-9a-f]{64}$"))) { "Receiver pairing is missing or invalid." }
    require(excludeCallId.isBlank() || excludeCallId.matches(Regex("^[0-9a-fA-F-]{36}$"))) {
      "Previously opened Server call ID is invalid."
    }
    val request = JSONObject().put("action", "native_pending_call").put("native_secret", nativeSecret)
    if (excludeCallId.isNotBlank()) request.put("exclude_call_id", excludeCallId)
    val response = post(request)
    if (response.optBoolean("pending") != true) return null
    val callId = response.optString("call_id")
    val url = response.optString("invitation_url")
    require(callId.matches(Regex("^[0-9a-fA-F-]{36}$"))) { "Pending Server call ID is invalid." }
    require(Regex("^https://server-onboarding-ochre\\.vercel\\.app/guest\\.html#token=[0-9a-f]{64}$").matches(url)) {
      "Pending Server invitation URL is invalid."
    }
    val uri = Uri.parse(url)
    require(uri.scheme == "https" && uri.host == "server-onboarding-ochre.vercel.app" && uri.path == "/guest.html") {
      "Pending Server invitation host is not trusted."
    }
    return PendingGuestCall(callId, url)
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
    val connection = URL(BuildConfig.SUPABASE_URL.trimEnd('/') + "/functions/v1/server-receiver").openConnection() as HttpURLConnection
    connection.requestMethod = "POST"
    connection.connectTimeout = 12_000
    connection.readTimeout = 12_000
    connection.doOutput = true
    connection.setRequestProperty("content-type", "application/json")
    connection.setRequestProperty("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
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
