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
  private var realtimeClient: ServerRealtimeClient? = null
  @Volatile private var realtimeConnected = false
  @Volatile private var realtimeCallId: String? = null
  private var incomingCallId: String? = null
  // Process-local by design: if Android recreates the service, active calls must be
  // re-reported to Telecom instead of being suppressed by stale persisted IDs.
  private val reportedCallIds = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
  private val reportedMissedCallIds = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
  private var activeIncomingCallId: String? = null
  private var activeIncomingCaller: String = "Server caller"
  private var activeIncomingSilent: Boolean = false
  private val prefs by lazy { getSharedPreferences("server-session", Context.MODE_PRIVATE) }

  override fun onCreate() {
    super.onCreate()
    ensureNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Android starts a foreground service with a strict startup deadline. Promote
    // it immediately, before making Telecom/session eligibility checks or network
    // calls; otherwise the OS can terminate the process with
    // ForegroundServiceDidNotStartInTimeException on a Telecom hand-off.
    when (intent?.action) {
      ACTION_SHOW_INCOMING_CALL, ACTION_SILENCE_INCOMING_CALL -> {
        val callId = intent.getStringExtra(EXTRA_CALL_ID).orEmpty()
        if (callId.isNotBlank()) {
          activeIncomingCallId = callId
          activeIncomingCaller = intent.getStringExtra(EXTRA_CALLER_ID).orEmpty().ifBlank { "Server caller" }
          activeIncomingSilent = intent.action == ACTION_SILENCE_INCOMING_CALL
        }
      }
      ACTION_CLEAR_INCOMING_CALL -> {
        val callId = intent.getStringExtra(EXTRA_CALL_ID).orEmpty()
        if (activeIncomingCallId == callId) {
          activeIncomingCallId = null
          activeIncomingCaller = "Server caller"
          activeIncomingSilent = false
        }
      }
    }

    try {
      val notification = activeIncomingCallId?.let { callId ->
        ServerCallNotifications.buildIncomingNotification(this, callId, activeIncomingCaller, activeIncomingSilent)
      } ?: buildNotification()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(FOREGROUND_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
      } else {
        startForeground(FOREGROUND_NOTIFICATION_ID, notification)
      }
    } catch (error: Exception) {
      Log.w(TAG, "Could not start Server call listener: " + error.javaClass.simpleName)
      stopSelf()
      return START_NOT_STICKY
    }

    // The service is safely foregrounded now; it can stop cleanly when the user
    // has disabled Server or when the local Server session is no longer valid.
    if (!ServerTelecomRegistry.isEnabled(this) || prefs.getString("access_token", null).isNullOrBlank()) {
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }
    if (intent?.action == ACTION_END_CALL) {
      val callId = intent.getStringExtra(EXTRA_CALL_ID).orEmpty()
      scope.launch {
        try {
          val token = freshAccessToken()
          if (!token.isNullOrBlank() && callId.isNotBlank()) {
            postJson("/functions/v1/server-calls", JSONObject().put("action", "end").put("call_id", callId), token)
          }
        } catch (error: Exception) {
          Log.w(TAG, "Could not decline Server call: " + error.javaClass.simpleName)
        } finally {
          if (callId.isNotBlank()) {
            ServerTelecomRegistry.markEnded(callId)
            ServerCallNotifications.cancel(this@ServerIncomingCallService, callId)
          }
        }
      }
      return START_STICKY
    }
    if (pollingJob?.isActive != true) {
      pollingJob = scope.launch { pollIncomingCalls() }
    }
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    pollingJob?.cancel()
    realtimeConnected = false
    realtimeCallId = null
    realtimeClient?.close()
    realtimeClient = null
    scope.cancel()
    try { (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(FOREGROUND_NOTIFICATION_ID) } catch (_: Exception) {}
    super.onDestroy()
  }

  private suspend fun pollIncomingCalls() {
    while (currentCoroutineContext().isActive) {
      try {
        if (!ServerTelecomRegistry.isEnabled(this)) {
          stopSelf()
          break
        }
        val token = freshAccessToken()
        if (token == null) { stopSelf(); break }
        if (realtimeClient == null) connectRealtime(token)
        if (!realtimeConnected) {
          val result = postJson("/functions/v1/server-calls", JSONObject().put("action", "incoming"), token)
          processIncomingResponse(result, token)
        }
      } catch (cancelled: CancellationException) {
        throw cancelled
      } catch (error: Exception) {
        val status = (error as? ServerCallApiException)?.httpStatus
          ?: Regex("HTTP (\\\\d{3})").find(error.message.orEmpty())?.groupValues?.get(1)?.toIntOrNull()
        if (status == 401) {
          try {
            ServerDeviceSessionManager.ensureFresh(
              this,
              prefs.getString("access_token", null),
              prefs.getLong("access_expiry", 0L),
              prefs,
              forceRefresh = true
            )
            Log.i(TAG, "Server incoming-call session revalidated.")
          } catch (recoveryError: Exception) {
            val recoveryStatus = (recoveryError as? ServerCallApiException)?.httpStatus
            if (recoveryStatus != null && recoveryStatus in 400..499 && recoveryStatus != 429) {
              Log.w(TAG, "Server incoming-call session recovery rejected: HTTP " + recoveryStatus)
              stopSelf()
              break
            }
            Log.w(TAG, "Server incoming-call session recovery deferred: " + recoveryError.javaClass.simpleName)
          }
        } else if (status == 403) {
          Log.w(TAG, "Server incoming-call session rejected: HTTP " + status)
          stopSelf()
          break
        } else {
          Log.w(TAG, "Server incoming-call listener failed: " + error.javaClass.simpleName)
        }
      }
      delay(if (realtimeConnected) REALTIME_IDLE_DELAY_MS else POLL_INTERVAL_MS)
    }
  }

  private fun connectRealtime(accessToken: String, callId: String? = null) {
    if (realtimeClient != null && realtimeCallId == callId) return
    try {
      val request = JSONObject().put("action", "realtime_token")
      if (!callId.isNullOrBlank()) request.put("call_id", callId)
      val credentials = postJson("/functions/v1/server-calls", request, accessToken)
      if (!credentials.optBoolean("realtime_available", false)) return
      val endpoint = credentials.optString("url")
      val realtimeToken = credentials.optString("token")
      if (!endpoint.startsWith("wss://") || realtimeToken.isBlank()) return
      realtimeClient?.close()
      realtimeConnected = false
      realtimeCallId = callId
      realtimeClient = ServerRealtimeClient(
        endpoint = endpoint,
        token = realtimeToken,
        onPublication = { publication ->
          val type = publication.optString("type")
          if (type == "incoming_call" || type == "call_state") {
            scope.launch { reconcileIncomingFromBackend() }
          }
        },
        onConnectionChanged = { connected ->
          realtimeConnected = connected
          if (connected) scope.launch { reconcileIncomingFromBackend() }
        },
        fetchFreshToken = {
          val current = freshAccessToken() ?: throw IllegalStateException("Server session is unavailable.")
          val refreshRequest = JSONObject().put("action", "realtime_token")
          if (!callId.isNullOrBlank()) refreshRequest.put("call_id", callId)
          val refreshed = postJson("/functions/v1/server-calls", refreshRequest, current)
          refreshed.optString("token").takeIf { it.isNotBlank() }
            ?: throw IllegalStateException("Server realtime token refresh returned no token.")
        }
      ).also { it.connect() }
    } catch (error: Exception) {
      realtimeConnected = false
      Log.w(TAG, "Realtime incoming-call channel unavailable: " + error.javaClass.simpleName)
    }
  }

  private suspend fun reconcileIncomingFromBackend() {
    try {
      val token = freshAccessToken() ?: return
      val result = postJson("/functions/v1/server-calls", JSONObject().put("action", "incoming"), token)
      processIncomingResponse(result, token)
    } catch (error: Exception) {
      Log.w(TAG, "Realtime incoming-call reconciliation deferred: " + error.javaClass.simpleName)
    }
  }

  private fun processIncomingResponse(result: JSONObject, accessToken: String) {
    val rows = result.optJSONArray("calls") ?: return
    val liveCallIds = mutableSetOf<String>()
    var nextCallChannel: String? = null
    for (i in 0 until rows.length()) {
      val row = rows.optJSONObject(i) ?: continue
      val callId = row.optString("id")
      if (callId.isBlank()) continue
      val callerPhone = row.optString("caller_phone_e164")
        .takeIf { it.matches(Regex("^\\\\+[1-9][0-9]{7,14}$")) }
      val caller = callerPhone?.let { ServerCallerIdentityResolver.resolve(this, it) } ?: "Server caller"
      if (row.optString("state") == "missed") {
        if (reportedMissedCallIds.add(callId)) {
          try {
            val shown = ServerCallNotifications.showMissed(this, callId, caller)
            if (!shown) reportedMissedCallIds.remove(callId)
          } catch (error: Exception) {
            reportedMissedCallIds.remove(callId)
            Log.w(TAG, "Could not show a missed Server call: " + error.javaClass.simpleName)
          }
        }
        continue
      }
      if (row.optString("state") != "ringing" && row.optString("state") != "connecting") continue
      liveCallIds.add(callId)
      if (nextCallChannel == null) nextCallChannel = callId
      if (!reportedCallIds.add(callId)) continue
      try {
        ServerTelecomRegistry.reportIncoming(this, callId, callerPhone ?: "Server caller")
      } catch (error: Exception) {
        reportedCallIds.remove(callId)
        Log.w(TAG, "Could not report an incoming Server call: " + error.javaClass.simpleName)
      }
    }
    ServerTelecomRegistry.reconcileIncoming(liveCallIds)
    if (realtimeClient != null && nextCallChannel != realtimeCallId) {
      connectRealtime(accessToken, nextCallChannel)
    }
  }

  private fun freshAccessToken(): String? {
    val current = prefs.getString("access_token", null)?.takeIf { it.matches(Regex("^[0-9a-f]{64}$")) } ?: return null
    val expires = prefs.getLong("access_expiry", 0L)
    if (expires > System.currentTimeMillis() / 1000 + 120) return current
    return try {
      ServerDeviceSessionManager.ensureFresh(this, current, expires, prefs).accessToken
    } catch (error: Exception) {
      val status = (error as? ServerCallApiException)?.httpStatus
      // Authentication/other permanent 4xx errors stop the listener only after
      // device-identity recovery has also failed. Network and server failures retry.
      if (status != null && status in 400..499 && status != 429) {
        Log.w(TAG, "Server session recovery rejected: HTTP " + status)
        null
      } else {
        Log.w(TAG, "Server session recovery deferred: " + error.javaClass.simpleName)
        current
      }
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
      if (status !in 200..299) {
        val reason = parsed.optString("message")
          .ifBlank { parsed.optString("error") }
          .ifBlank { "Server call polling HTTP " + status }
        throw ServerCallApiException(status, parsed, reason)
      }
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
    internal const val FOREGROUND_NOTIFICATION_ID = 7338
    private const val POLL_INTERVAL_MS = 2200L
    private const val REALTIME_IDLE_DELAY_MS = 15000L
    private const val ACTION_SHOW_INCOMING_CALL = "com.server.caller.action.FGS_SHOW_INCOMING"
    private const val ACTION_SILENCE_INCOMING_CALL = "com.server.caller.action.FGS_SILENCE_INCOMING"
    private const val ACTION_CLEAR_INCOMING_CALL = "com.server.caller.action.FGS_CLEAR_INCOMING"
    private const val ACTION_END_CALL = "com.server.caller.action.FGS_END_CALL"
    private const val EXTRA_CALL_ID = "server_call_id"
    private const val EXTRA_CALLER_ID = "server_caller_id"

    private fun dispatch(context: Context, action: String, callId: String, caller: String = "") {
      if (callId.isBlank()) return
      val serviceIntent = Intent(context, ServerIncomingCallService::class.java).apply {
        this.action = action
        putExtra(EXTRA_CALL_ID, callId)
        if (caller.isNotBlank()) putExtra(EXTRA_CALLER_ID, caller.take(80))
      }
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(serviceIntent)
        else context.startService(serviceIntent)
      } catch (error: Exception) {
        Log.w(TAG, "Could not update Server call notification: " + error.javaClass.simpleName)
      }
    }

    fun showIncomingCall(context: Context, callId: String, caller: String, silent: Boolean = false) {
      dispatch(context, if (silent) ACTION_SILENCE_INCOMING_CALL else ACTION_SHOW_INCOMING_CALL, callId, caller)
    }

    fun silenceIncomingCall(context: Context, callId: String, caller: String) {
      dispatch(context, ACTION_SILENCE_INCOMING_CALL, callId, caller)
    }

    fun clearIncomingCall(context: Context, callId: String) {
      dispatch(context, ACTION_CLEAR_INCOMING_CALL, callId)
    }

    fun endCall(context: Context, callId: String) {
      dispatch(context, ACTION_END_CALL, callId)
    }

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
