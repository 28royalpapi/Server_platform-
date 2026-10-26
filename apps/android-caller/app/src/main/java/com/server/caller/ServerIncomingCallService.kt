package com.server.caller

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant

/**
 * Keeps Server internet calling reachable after the user returns to Android's
 * normal Phone app. This reports calls from the Server backend to Android Telecom;
 * it does not intercept, replace, or clone carrier SIM calls.
 */
class ServerIncomingCallService : Service() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private var pollingJob: Job? = null
  private val prefs by lazy { getSharedPreferences("server-session", Context.MODE_PRIVATE) }

  override fun onCreate() {
    super.onCreate()
    ensureNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!ServerTelecomRegistry.isEnabled(this) || prefs.getString("access_token", null).isNullOrBlank()) {
      stopSelf()
      return START_NOT_STICKY
    }
    try {
      val notification = buildNotification()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (error: Exception) {
      Log.w(TAG, "Could not start Server call listener: " + error.javaClass.simpleName)
      stopSelf()
      return START_NOT_STICKY
    }
    if (pollingJob?.isActive != true) {
      pollingJob = scope.launch { pollIncomingCalls() }
    }
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    pollingJob?.cancel()
    scope.cancel()
    try { (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTIFICATION_ID) } catch (_: Exception) {}
    super.onDestroy()
  }

  private suspend fun pollIncomingCalls() {
    while (currentCoroutineContext().isActive) {
      try {
        if (!ServerTelecomRegistry.isEnabled(this)) {
          stopSelf()
          break
        }
        val token = freshAccessToken() ?: run { stopSelf(); break }
        val result = postJson("/functions/v1/server-calls", JSONObject().put("action", "incoming"), token)
        val rows = result.optJSONArray("calls")
        if (rows != null) {
          for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            val callId = row.optString("id")
            if (callId.isBlank()) continue
            val reported = prefs.getStringSet(KEY_REPORTED_IDS, emptySet()).orEmpty()
            if (callId in reported) continue

            val caller = row.optString("caller_server_id").takeIf { it.isNotBlank() }
              ?: row.optString("caller_phone_e164").takeIf { it.isNotBlank() }
              ?: "Server caller"
            try {
              ServerTelecomRegistry.reportIncoming(this, callId, caller)
              val bounded = (reported + callId).toList().takeLast(MAX_REPORTED_IDS).toSet()
              prefs.edit().putStringSet(KEY_REPORTED_IDS, bounded).apply()
            } catch (error: Exception) {
              Log.w(TAG, "Could not report an incoming Server call: " + error.javaClass.simpleName)
            }
          }
        }
      } catch (cancelled: CancellationException) {
        throw cancelled
      } catch (error: Exception) {
        Log.w(TAG, "Server incoming-call poll failed: " + error.javaClass.simpleName)
      }
      delay(POLL_INTERVAL_MS)
    }
  }

  private fun freshAccessToken(): String? {
    val current = prefs.getString("access_token", null)?.takeIf { it.matches(Regex("^[0-9a-f]{64}$")) } ?: return null
    val expires = prefs.getLong("access_expiry", 0L)
    if (expires > System.currentTimeMillis() / 1000 + 120) return current
    return try {
      val refreshed = postJson("/functions/v1/server-auth", JSONObject().put("action", "refresh"), current)
      val token = refreshed.optString("access_token")
      if (!token.matches(Regex("^[0-9a-f]{64}$"))) return null
      val expiry = try { Instant.parse(refreshed.optString("expires_at")).epochSecond }
        catch (_: Exception) { System.currentTimeMillis() / 1000 + 30L * 24 * 60 * 60 }
      prefs.edit().putString("access_token", token).putLong("access_expiry", expiry).apply()
      token
    } catch (_: Exception) {
      null
    }
  }

  private fun postJson(path: String, body: JSONObject, token: String): JSONObject {
    val url = BuildConfig.SUPABASE_URL.trimEnd('/') + path
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      connectTimeout = 10000
      readTimeout = 10000
      doOutput = true
      setRequestProperty("content-type", "application/json")
      setRequestProperty("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
      setRequestProperty("authorization", "Bearer " + token)
    }
    try {
      connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
      val status = connection.responseCode
      val stream = if (status in 200..299) connection.inputStream else connection.errorStream
      val content = stream?.use { it.readBytes().toString(Charsets.UTF_8) }.orEmpty()
      val parsed = try { JSONObject(content) } catch (_: Exception) { JSONObject() }
      if (status !in 200..299) throw IllegalStateException("Server call polling HTTP " + status)
      return parsed
    } finally {
      connection.disconnect()
    }
  }

  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, "Server internet calling", NotificationManager.IMPORTANCE_LOW)
        .apply {
          description = "Keeps Server-to-Server internet calls available while the normal Phone app is in use."
          setShowBadge(false)
        }
      (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
    }
  }

  private fun buildNotification(): Notification {
    val pendingIntent = PendingIntent.getActivity(
      this, 0, Intent(Intent.ACTION_DIAL).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID) else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    return builder.setSmallIcon(android.R.drawable.sym_action_call)
      .setContentTitle("Server calling is available")
      .setContentText("Incoming Server internet calls can ring in your normal Phone app.")
      .setCategory(Notification.CATEGORY_SERVICE)
      .setOngoing(true)
      .setContentIntent(pendingIntent)
      .build()
  }

  companion object {
    private const val TAG = "ServerIncomingCalls"
    private const val CHANNEL_ID = "server-incoming-calls"
    private const val NOTIFICATION_ID = 7338
    private const val KEY_REPORTED_IDS = "server_reported_incoming_call_ids"
    private const val MAX_REPORTED_IDS = 300
    private const val POLL_INTERVAL_MS = 2200L

    fun start(context: Context) {
      val serviceIntent = Intent(context, ServerIncomingCallService::class.java)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(serviceIntent)
        else context.startService(serviceIntent)
      } catch (error: Exception) {
        Log.w(TAG, "Could not start Server incoming-call service: " + error.javaClass.simpleName)
      }
    }

    fun stop(context: Context) {
      try { context.stopService(Intent(context, ServerIncomingCallService::class.java)) } catch (_: Exception) {}
    }
  }
}
