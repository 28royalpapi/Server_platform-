package com.server.caller

import android.app.Application
import android.content.Context
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Firebase client configuration is public app configuration injected at build time. */
class ServerApplication : Application() {
  override fun onCreate() {
    super.onCreate()
    ServerFirebase.initialize(this)
  }
}

internal object ServerFirebase {
  fun initialize(context: Context): Boolean {
    if (FirebaseApp.getApps(context).isNotEmpty()) return true
    val apiKey = BuildConfig.FIREBASE_API_KEY
    val appId = BuildConfig.FIREBASE_APP_ID
    val projectId = BuildConfig.FIREBASE_PROJECT_ID
    val senderId = BuildConfig.FIREBASE_SENDER_ID
    if (apiKey.isBlank() || appId.isBlank() || projectId.isBlank() || senderId.isBlank()) {
      Log.i("ServerFirebase", "FCM is not configured in this build; backend polling remains the compatibility path.")
      return false
    }
    return try {
      FirebaseApp.initializeApp(context, FirebaseOptions.Builder()
        .setApiKey(apiKey).setApplicationId(appId).setProjectId(projectId).setGcmSenderId(senderId).build()) != null
    } catch (error: Exception) {
      Log.w("ServerFirebase", "Firebase initialization failed: " + error.javaClass.simpleName)
      false
    }
  }
}

/** FCM is a wake-up signal only. The backend remains authoritative for live call state. */
class ServerFirebaseMessagingService : FirebaseMessagingService() {
  override fun onNewToken(token: String) {
    super.onNewToken(token)
    getSharedPreferences("server-session", MODE_PRIVATE).edit().putString("fcm_registration_token", token).apply()
    ServerPushRegistration.register(this, token)
  }

  override fun onMessageReceived(message: RemoteMessage) {
    super.onMessageReceived(message)
    if (message.data["type"] != "server_incoming_call") return
    // A data push must not be counted as a usable background receiver if Android
    // will not allow Server to display the incoming-call notification.
    if (!ServerCallNotifications.canPostNotifications(this)) {
      ServerPushRegistration.unregister(this)
      Log.i("ServerFirebase", "Incoming-call push received while notifications are disabled; removing this background receiver.")
      return
    }
    val callId = message.data["call_id"].orEmpty()
    if (callId.isBlank()) return
    getSharedPreferences("server-session", MODE_PRIVATE).edit().putString("fcm_last_wake_call_id", callId).apply()
    Log.i("ServerFirebase", "Incoming-call wake received; checking authoritative Server call state.")
    ServerIncomingCallService.start(this)
  }
}

internal object ServerPushRegistration {
  private val registeringTokens = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

  fun syncFcmToken(context: Context) {
    if (!ServerFirebase.initialize(context)) return
    if (!ServerCallNotifications.canPostNotifications(context)) {
      unregister(context)
      return
    }
    val prefs = context.getSharedPreferences("server-session", Context.MODE_PRIVATE)
    val saved = prefs.getString("fcm_registration_token", null)
    if (!saved.isNullOrBlank()) { register(context, saved); return }
    try {
      FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
        if (token.isNullOrBlank()) return@addOnSuccessListener
        prefs.edit().putString("fcm_registration_token", token).apply()
        register(context, token)
      }.addOnFailureListener { error ->
        Log.w("ServerFirebase", "Could not obtain FCM token: " + error.javaClass.simpleName)
      }
    } catch (error: Exception) {
      Log.w("ServerFirebase", "FCM token retrieval unavailable: " + error.javaClass.simpleName)
    }
  }

  /**
   * Register the FCM endpoint with the currently authenticated Server session.
   * Transient network, rate-limit and 5xx errors are retried. Permanent 4xx errors
   * are not retried because they require a valid session or a corrected request.
   */
  fun register(context: Context, token: String) {
    if (!ServerCallNotifications.canPostNotifications(context)) {
      unregister(context)
      return
    }
    val cleanToken = token.trim()
    if (cleanToken.length !in 40..4096) return
    val prefs = context.getSharedPreferences("server-session", Context.MODE_PRIVATE)
    if (prefs.getString("access_token", null).isNullOrBlank()) return
    val serverId = prefs.getString("server_id", "").orEmpty()
    if (serverId.isNotBlank() &&
        prefs.getString("fcm_registered_token", null) == cleanToken &&
        prefs.getString("fcm_registered_server_id", null) == serverId) return
    if (!registeringTokens.add(cleanToken)) return

    Thread({
      try {
        val maxAttempts = 4
        for (attempt in 0 until maxAttempts) {
          val accessToken = prefs.getString("access_token", null)
          if (accessToken.isNullOrBlank() || !accessToken.matches(Regex("^[0-9a-f]{64}$"))) {
            Log.i("ServerFirebase", "Push registration deferred until Server sign-in.")
            return@Thread
          }

          var connection: HttpURLConnection? = null
          var shouldRetry = false
          try {
            connection = (URL(BuildConfig.SUPABASE_URL.trimEnd('/') + "/functions/v1/server-calls").openConnection() as HttpURLConnection).apply {
              requestMethod = "POST"
              connectTimeout = 10000
              readTimeout = 10000
              doOutput = true
              setRequestProperty("content-type", "application/json")
              setRequestProperty("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
              setRequestProperty("x-server-session-token", accessToken)
            }
            val body = JSONObject()
              .put("action", "register_push_token")
              .put("platform", "android")
              .put("push_token", cleanToken)
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            if (status in 200..299) {
              prefs.edit().putString("fcm_registered_token", cleanToken)
                .putString("fcm_registered_server_id", prefs.getString("server_id", "").orEmpty()).apply()
              Log.i("ServerFirebase", "Android push token registered with Server.")
              return@Thread
            }

            // A 401/403 requires the application to refresh or re-establish its
            // authenticated session. A 429 or 5xx can recover without user action.
            if (status == 429 || status >= 500 || status == 408) {
              shouldRetry = true
              Log.w("ServerFirebase", "Push-token registration temporarily unavailable (HTTP " + status + ").")
            } else {
              Log.w("ServerFirebase", "Push-token registration requires session or request correction (HTTP " + status + ").")
              return@Thread
            }
          } catch (error: Exception) {
            shouldRetry = true
            Log.w("ServerFirebase", "Push-token registration attempt failed: " + error.javaClass.simpleName)
          } finally {
            connection?.disconnect()
          }

          if (shouldRetry && attempt < maxAttempts - 1) {
            try { Thread.sleep(1500L * (1L shl attempt)) }
            catch (_: InterruptedException) { Thread.currentThread().interrupt(); return@Thread }
          }
        }
        Log.w("ServerFirebase", "Push-token registration remains pending; it will retry when Server next opens.")
      } finally {
        registeringTokens.remove(cleanToken)
      }
    }, "server-fcm-token-register").apply {
      isDaemon = true
      start()
    }
  }

  /** Remove this device's push endpoint before a user signs out, where network permits. */
  fun unregister(context: Context) {
    val prefs = context.getSharedPreferences("server-session", Context.MODE_PRIVATE)
    val token = prefs.getString("fcm_registered_token", null) ?: return
    val accessToken = prefs.getString("access_token", null) ?: return
    if (!accessToken.matches(Regex("^[0-9a-f]{64}$"))) return

    Thread({
      var connection: HttpURLConnection? = null
      try {
        connection = (URL(BuildConfig.SUPABASE_URL.trimEnd('/') + "/functions/v1/server-calls").openConnection() as HttpURLConnection).apply {
          requestMethod = "POST"
          connectTimeout = 8000
          readTimeout = 8000
          doOutput = true
          setRequestProperty("content-type", "application/json")
          setRequestProperty("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
          setRequestProperty("x-server-session-token", accessToken)
        }
        val body = JSONObject().put("action", "remove_push_token").put("push_token", token)
        connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        if (connection.responseCode in 200..299) {
          prefs.edit().remove("fcm_registered_token").remove("fcm_registered_server_id").apply()
          Log.i("ServerFirebase", "Android push endpoint removed on sign-out.")
        }
      } catch (error: Exception) {
        Log.w("ServerFirebase", "Push endpoint sign-out cleanup deferred: " + error.javaClass.simpleName)
      } finally {
        connection?.disconnect()
      }
    }, "server-fcm-token-remove").apply {
      isDaemon = true
      start()
    }
  }
}
