package com.server.caller

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant

internal data class ServerDeviceSession(
  val accessToken: String,
  val expiresAtEpochSeconds: Long,
  val serverId: String?
)

internal data class ServerAuthResponse(val status: Int, val body: JSONObject)

/**
 * Keeps a device's Server identity recoverable across long offline periods.
 *
 * The device secret is created at first consented onboarding and stored locally.
 * A normal refresh is always attempted first. Only an explicit HTTP 401 from
 * refresh may use the persisted device identity to obtain a new session.
 * Network errors, rate limits, and server errors never trigger re-registration.
 */
internal object ServerDeviceSessionManager {
  private const val PREFS_NAME = "server-session"
  private const val TOKEN_PATTERN = "^[0-9a-f]{64}$"
  private const val SERVER_ID_PATTERN = "^SVR-[0-9A-F]{10}$"

  @Synchronized
  fun ensureFresh(
    context: Context,
    currentToken: String?,
    currentExpiry: Long,
    preferences: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE),
    forceRefresh: Boolean = false,
    onSessionRestored: () -> Unit = { ServerPushRegistration.syncFcmToken(context) },
    request: ((JSONObject, String?) -> ServerAuthResponse)? = null
  ): ServerDeviceSession {
    val storedToken = preferences.getString("access_token", null)
    val token = storedToken?.takeIf { it.matches(Regex(TOKEN_PATTERN)) }
      ?: currentToken?.takeIf { it.matches(Regex(TOKEN_PATTERN)) }
      ?: throw IllegalStateException("Finish Server ID setup on this phone first.")
    val expiry = maxOf(currentExpiry, preferences.getLong("access_expiry", 0L))
    val now = System.currentTimeMillis() / 1000L

    if (!forceRefresh && expiry > now + 90L) {
      return ServerDeviceSession(
        token,
        expiry,
        preferences.getString("server_id", null)
      )
    }

    val send = request ?: { body: JSONObject, bearer: String? -> postAuth(context, body, bearer) }
    val refreshed = send(JSONObject().put("action", "refresh"), token)
    if (refreshed.status in 200..299) {
      return persistSession(preferences, refreshed.body, preferences.getString("server_id", null), expiry)
    }
    if (refreshed.status != 401) {
      throw apiError(refreshed, "Server session refresh failed")
    }

    // Refresh tokens are deliberately not valid forever. When a device has been
    // offline beyond the server's grace window, recover the same identity with
    // its locally-held installation credentials rather than creating a new user.
    val installationId = preferences.getString("installation_id", null).orEmpty()
    val deviceSecret = preferences.getString("device_secret", null).orEmpty()
    if (!installationId.matches(Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")) ||
      !deviceSecret.matches(Regex(TOKEN_PATTERN))) {
      throw IllegalStateException("Your Server session expired and this installation has no recoverable device identity. Reopen Server setup.")
    }

    val registration = JSONObject()
      .put("action", "register_device")
      .put("display_name", preferences.getString("display_name", "").orEmpty())
      .put("installation_id", installationId)
      .put("device_secret", deviceSecret)
      .put("accepted_terms", true)
      .put("terms_version", "server-terms-1.0")
      .put("privacy_version", "server-privacy-1.0")
    val recovered = send(registration, null)
    if (recovered.status !in 200..299) {
      throw apiError(recovered, "Server could not restore this device session")
    }
    val session = persistSession(preferences, recovered.body, preferences.getString("server_id", null), expiry)
    onSessionRestored()
    return session
  }

  internal fun persistSession(
    preferences: SharedPreferences,
    body: JSONObject,
    previousServerId: String?,
    previousExpiry: Long
  ): ServerDeviceSession {
    val access = body.optString("access_token")
    if (!access.matches(Regex(TOKEN_PATTERN))) {
      throw IllegalStateException("Server returned an invalid session token.")
    }
    val returnedServerId = body.optJSONObject("user")?.optString("server_id").orEmpty()
    val serverId = returnedServerId.takeIf { it.matches(Regex(SERVER_ID_PATTERN)) } ?: previousServerId
    val expiresAt = try {
      Instant.parse(body.optString("expires_at")).epochSecond
    } catch (_: Exception) {
      previousExpiry.takeIf { it > System.currentTimeMillis() / 1000L }
        ?: System.currentTimeMillis() / 1000L + 30L * 24L * 60L * 60L
    }
    preferences.edit()
      .putString("access_token", access)
      .putLong("access_expiry", expiresAt)
      .apply()
    if (serverId != null) preferences.edit().putString("server_id", serverId).apply()
    return ServerDeviceSession(access, expiresAt, serverId)
  }

  private fun postAuth(context: Context, body: JSONObject, bearer: String?): ServerAuthResponse {
    val connection = (URL(BuildConfig.SUPABASE_URL.trimEnd('/') + "/functions/v1/server-auth")
      .openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      connectTimeout = 12000
      readTimeout = 15000
      doOutput = true
      setRequestProperty("content-type", "application/json")
      setRequestProperty("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
      if (!bearer.isNullOrBlank()) setRequestProperty("authorization", "Bearer " + bearer)
    }
    try {
      connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
      val status = connection.responseCode
      val stream = if (status in 200..299) connection.inputStream else connection.errorStream
      val text = stream?.use { it.readBytes().toString(Charsets.UTF_8) }.orEmpty()
      val parsed = try { JSONObject(text) } catch (_: Exception) { JSONObject() }
      return ServerAuthResponse(status, parsed)
    } finally {
      connection.disconnect()
    }
  }

  private fun apiError(response: ServerAuthResponse, fallback: String): ServerCallApiException {
    val reason = response.body.optString("message")
      .ifBlank { response.body.optString("error") }
      .ifBlank { fallback }
    return ServerCallApiException(response.status, response.body, reason)
  }
}
