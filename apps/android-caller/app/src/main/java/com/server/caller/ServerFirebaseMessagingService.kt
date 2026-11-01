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
    val callId = message.data["call_id"].orEmpty()
    if (callId.isBlank()) return
    getSharedPreferences("server-session", MODE_PRIVATE).edit().putString("fcm_last_wake_call_id", callId).apply()
    Log.i("ServerFirebase", "Incoming-call wake received; checking authoritative Server call state.")
    ServerIncomingCallService.start(this)
  }
}

internal object ServerPushRegistration {
  fun syncFcmToken(context: Context) {
    if (!ServerFirebase.initialize(context)) return
    val saved = context.getSharedPreferences("server-session", Context.MODE_PRIVATE).getString("fcm_registration_token", null)
    if (!saved.isNullOrBlank()) { register(context, saved); return }
    try {
      FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
        if (token.isNullOrBlank()) return@addOnSuccessListener
        context.getSharedPreferences("server-session", Context.MODE_PRIVATE).edit().putString("fcm_registration_token", token).apply()
        register(context, token)
      }.addOnFailureListener { error ->
        Log.w("ServerFirebase", "Could not obtain FCM token: " + error.javaClass.simpleName)
      }
    } catch (error: Exception) {
      Log.w("ServerFirebase", "FCM token retrieval unavailable: " + error.javaClass.simpleName)
    }
  }

  fun register(context: Context, token: String) {
    val prefs = context.getSharedPreferences("server-session", Context.MODE_PRIVATE)
    val accessToken = prefs.getString("access_token", null) ?: return
    if (!accessToken.matches(Regex("^[0-9a-f]{64}$"))) return
    Thread {
      var connection: HttpURLConnection? = null
      try {
        connection = (URL(BuildConfig.SUPABASE_URL.trimEnd('/') + "/functions/v1/server-calls").openConnection() as HttpURLConnection).apply {
          requestMethod = "POST"; connectTimeout = 10000; readTimeout = 10000; doOutput = true
          setRequestProperty("content-type", "application/json")
          setRequestProperty("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
          setRequestProperty("authorization", "Bearer " + accessToken)
        }
        val body = JSONObject().put("action", "register_push_token").put("platform", "android").put("push_token", token)
        connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        val status = connection.responseCode
        if (status !in 200..299) Log.w("ServerFirebase", "Push-token registration returned HTTP " + status)
        else {
          prefs.edit().putString("fcm_registered_token", token).apply()
          Log.i("ServerFirebase", "Android push token registered with Server.")
        }
      } catch (error: Exception) {
        Log.w("ServerFirebase", "Push-token registration deferred: " + error.javaClass.simpleName)
      } finally { connection?.disconnect() }
    }.start()
  }
}
