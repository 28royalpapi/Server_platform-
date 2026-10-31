package com.server.caller

import android.Manifest
import android.content.Context
import android.content.Intent
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.widget.Toast
import android.net.Uri
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import android.app.AlertDialog
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.audio.JavaAudioDeviceModule
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

/** Native Server client. Auth and signalling are genuine Supabase endpoints; no demo OTP is generated here. */
class MainActivity : ComponentActivity(), PeerConnection.Observer {
  private val prefs by lazy { getSharedPreferences("server-session", Context.MODE_PRIVATE) }
  private var accessToken: String? = null
  private var refreshToken: String? = null
  private var accessExpiry: Long = 0
  private var currentPhone = ""

  private var currentServerId = ""
  private var callId: String? = null
  private var callStartedAt = 0L
  private var carrierFallbackPhone: String? = null
  private var carrierFallbackOfferedFor: String? = null
  private var activeStateSyncedFor: String? = null
  private var pendingDialedNumber: String? = null
  private var currentRoute = "server"
  private var lastSeq = 0L
  private var peer: PeerConnection? = null
  private var peerFactory: PeerConnectionFactory? = null
  private var audioSource: AudioSource? = null
  private var audioTrack: AudioTrack? = null
  private var audioModule: JavaAudioDeviceModule? = null
  private var pollingJob: Job? = null
  private var incomingJob: Job? = null
  private val shownIncoming = mutableSetOf<String>()
  private var callIceServers = JSONArray()
  private val pendingIce = mutableListOf<IceCandidate>()

  private lateinit var root: LinearLayout
  private lateinit var targetInput: EditText
  private lateinit var statusText: TextView
  private lateinit var authPanel: LinearLayout
  private lateinit var callPanel: LinearLayout
  private lateinit var callButton: Button
  private lateinit var hangupButton: Button

  private val askMic = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    if (!granted) {
      setStatus("Microphone permission is required to place or answer calls.", true)
    } else if (::targetInput.isInitialized && targetInput.text.toString().isNotBlank() && callId == null) {
      // Continue the call action that triggered the permission prompt instead of
      // forcing the user to tap Call a second time after granting microphone access.
      lifecycleScope.launch { delay(150); startCall() }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    accessToken = prefs.getString("access_token", null)
    refreshToken = prefs.getString("refresh_token", null)
    accessExpiry = prefs.getLong("access_expiry", 0L)
    currentPhone = prefs.getString("phone", "") ?: ""
    currentServerId = prefs.getString("server_id", "") ?: ""
    buildUi()
    if (!configured()) setStatus("Add the Server Supabase URL and publishable key to the build configuration.", true)
    else if (!accessToken.isNullOrBlank()) showSignedIn()
    else showSetupRequired()
    handleTelecomIntent(intent)
    handleAppLink(intent)
    // When Android's Phone app launches us as a Telecom call provider, process the
    // call command and immediately yield the visible surface back to the system dialer.
    // The native caller must not replace the user's normal phone/call UI.
    yieldToSystemPhoneUi(intent)
  }

  private fun configured(): Boolean = BuildConfig.SUPABASE_URL.startsWith("https://") &&
    !BuildConfig.SUPABASE_URL.contains("YOUR_PROJECT") && BuildConfig.SUPABASE_PUBLISHABLE_KEY.length > 20 &&
    !BuildConfig.SUPABASE_PUBLISHABLE_KEY.contains("YOUR_")

  private fun buildUi() {
    val scroll = ScrollView(this)
    root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(22), dp(22), dp(22), dp(26))
      setBackgroundColor(0xFF08111D.toInt())
    }
    scroll.addView(root)
    setContentView(scroll)
    root.addView(TextView(this).apply { text = "SERVER"; textSize = 12f; setTextColor(0xFF18C879.toInt()); letterSpacing = .18f })
    root.addView(TextView(this).apply { text = "Calling, made natural"; textSize = 30f; setTextColor(0xFFF3F7FB.toInt()); setPadding(0, dp(6), 0, dp(4)) })
    root.addView(TextView(this).apply {
      text = "Server works with your phone’s calling system. Your existing SIMs and mobile data remain yours."
      textSize = 14f; setTextColor(0xFF9AABBC.toInt()); setPadding(0, 0, 0, dp(20))
    })

    statusText = TextView(this).apply { textSize = 13f; setTextColor(0xFFFFDFA3.toInt()); setPadding(dp(13), dp(12), dp(13), dp(12)); visibility = View.GONE }
    root.addView(statusText, matchWrap())

    authPanel = panel()
    root.addView(authPanel, matchWrap())
    authPanel.addView(label("Complete setup on the Server website"))
    authPanel.addView(TextView(this).apply {
      text = "Create your Server ID on the website. SIM selection and SMS verification are not required. Open this screen only when Android needs to hand a call to Server."
      textSize = 13f; setTextColor(0xFF9AABBC.toInt()); setPadding(0, 0, 0, dp(12))
    }, matchWrap())
    authPanel.addView(button("Open Server setup") {
      startActivity(Intent(this, ServerSetupWebActivity::class.java))
    }, matchWrap())

    callPanel = panel().apply { visibility = View.GONE }
    root.addView(callPanel, matchWrap())
    callPanel.addView(label("Server call engine"))
    targetInput = field("Server ID or phone number", "", false).apply { id = R.id.server_target }
    callPanel.addView(targetInput, matchWrap())
    callButton = button("Call with Server") { startCall() }.apply { id = R.id.server_start_call }
    callPanel.addView(callButton, matchWrap())
    hangupButton = button("End call") { endCall() }.apply { id = R.id.server_end_call; visibility = View.GONE }
    callPanel.addView(hangupButton, matchWrap())
    callPanel.addView(button("Enable Server in phone settings") { enableCallingAccount() }, matchWrap())
    callPanel.addView(button("Sign out") { signOut() }, matchWrap())
    callPanel.addView(TextView(this).apply {
      text = "Server-to-Server calls use your Server ID. Calls to people outside Server require an invitation or an available paid carrier route. Server is an internet-calling account, not a SIM/eSIM."
      textSize = 12f; setTextColor(0xFF9AABBC.toInt()); setPadding(0, dp(14), 0, 0)
    })
  }

  // Avoid relying on a UI framework; all UI widgets are native Android views.
  private fun panel() = LinearLayout(this).apply {
    orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(18), dp(16), dp(18))
    setBackgroundColor(0xFF101F30.toInt())
  }
  private fun label(value: String) = TextView(this).apply { text = value; textSize = 19f; setTextColor(0xFFF3F7FB.toInt()); setPadding(0, 0, 0, dp(12)) }
  private fun field(hintText: String, value: String, numeric: Boolean) = EditText(this).apply {
    hint = hintText; setText(value); textSize = 16f; setSingleLine(true); setTextColor(0xFFF3F7FB.toInt()); setHintTextColor(0xFF718096.toInt())
    setPadding(dp(12), dp(9), dp(12), dp(9)); setBackgroundColor(0xFF1A2B3E.toInt())
    if (numeric) inputType = android.text.InputType.TYPE_CLASS_NUMBER
    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)).apply { bottomMargin = dp(10) }
  }
  private fun button(caption: String, action: () -> Unit) = Button(this).apply {
    text = caption; isAllCaps = false; setTextColor(0xFF041E15.toInt()); setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xFF18C879.toInt()))
    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)).apply { bottomMargin = dp(10) }
    setOnClickListener { action() }
  }
  private fun matchWrap() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(12) }
  private fun dp(x: Int) = (x * resources.displayMetrics.density).toInt()

  private fun setStatus(message: String, error: Boolean = false) {
    runOnUiThread {
      statusText.text = message
      statusText.setTextColor(if (error) 0xFFFFDFA3.toInt() else 0xFF8DE9B9.toInt())
      statusText.setBackgroundColor(if (error) 0xFF2B2415.toInt() else 0xFF102A26.toInt())
      statusText.visibility = View.VISIBLE
    }
  }

  private fun showSetupRequired() {
    authPanel.visibility = View.VISIBLE
    callPanel.visibility = View.GONE
    setStatus("This phone has no active Server session yet. Finish identity setup on the Server website; no SIM selection or SMS OTP is required.", true)
  }

  private fun showSignedIn() {
    authPanel.visibility = View.GONE
    callPanel.visibility = View.VISIBLE
    targetInput.setText("")
    if (ServerTelecomRegistry.isEnabled(this)) {
      ServerIncomingCallService.start(this)
    } else if (incomingJob?.isActive != true) {
      incomingJob = lifecycleScope.launch { incomingLoop() }
    }
    val id = currentServerId.ifBlank { "Server ID loading" }
    setStatus("Your Server ID is $id. This is your internet-calling identity; your existing mobile subscriptions remain unchanged.")
    lifecycleScope.launch {
      try {
        val result = api("me")
        val profile = result.optJSONObject("user") ?: result.optJSONObject("profile")
        val serverId = profile?.optString("server_id").orEmpty()
        if (serverId.matches(Regex("^SVR-[0-9A-F]{10}$"))) {
          currentServerId = serverId
          prefs.edit().putString("server_id", serverId).apply()
          setStatus("Your Server ID is $serverId. Registering Server with Android Telecom.")
        }
      } catch (_: Exception) {}
      try { ServerTelecomRegistry.register(this@MainActivity) } catch (_: Exception) {}
      if (ServerTelecomRegistry.isEnabled(this@MainActivity)) ServerIncomingCallService.start(this@MainActivity)
    }
    pendingDialedNumber?.let { number ->
      pendingDialedNumber = null
      targetInput.setText(number)
      lifecycleScope.launch { delay(350); startCall() }
    }
  }

  private fun enableCallingAccount() {
    try {
      ServerTelecomRegistry.register(this)
      setStatus("Server internet-calling account registered. Android may show it as a calling option after you enable it in calling-account settings; it is not a SIM/eSIM.")
      startActivity(Intent("android.telecom.action.CHANGE_PHONE_ACCOUNTS"))
    } catch (e: Exception) { setStatus("Could not register the Server calling account: ${e.message}", true) }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleTelecomIntent(intent)
    handleAppLink(intent)
    if (ServerTelecomRegistry.isEnabled(this)) {
      incomingJob?.cancel()
      incomingJob = null
      ServerIncomingCallService.start(this)
    }
    yieldToSystemPhoneUi(intent)
  }

  private fun yieldToSystemPhoneUi(incoming: Intent?) {
    // A call selected inside Server's own dialer must leave the call engine visible.
    // Only calls launched from Android's external Telecom UI should background this activity.
    if (incoming?.getBooleanExtra("sava_dialer_launch", false) == true) return
    val action = incoming?.getStringExtra("server_action") ?: return
    if (action !in setOf("dial", "incoming", "answer", "decline", "hangup")) return
    // The system-owned call UI is already foreground. For an outgoing dial request,
    // give the queued engine coroutine time to reload the session and enter startCall
    // before backgrounding this Activity; immediate task-backgrounding can race the
    // Telecom handoff on Android 14 and OEM task schedulers.
    val delayMillis = if (action == "dial") 1_500L else 300L
    root.postDelayed({
      if (!isFinishing && !isDestroyed) moveTaskToBack(true)
    }, delayMillis)
  }

  private fun handleAppLink(incoming: Intent?) {
    val uri = incoming?.data ?: return
    if (uri.scheme != "server") return
    if (uri.host != "setup") return
    val code = uri.getQueryParameter("handoff").orEmpty()
    if (!Regex("^[0-9a-f]{64}$").matches(code)) {
      setStatus("The setup link is invalid or expired. Return to the website and open Server again.", true)
      return
    }
    if (!configured()) {
      setStatus("This Server app build is not connected to the live backend.", true)
      return
    }
    lifecycleScope.launch {
      setStatus("Transferring your verified setup securely…")
      try {
        val result = authRequest("/functions/v1/server-handoff", JSONObject().put("action", "claim").put("handoff_code", code), false)
        val token = result.optString("access_token").takeIf { it.isNotBlank() }
          ?: throw IllegalStateException("The setup handoff did not return an app session.")
        val user = result.optJSONObject("user")
        val phone = user?.optString("phone")?.takeIf { !it.isNullOrBlank() && it != "null" }
          ?: throw IllegalStateException("The setup handoff did not return a verified phone number.")
        val expiry = try { java.time.Instant.parse(result.optString("expires_at")).epochSecond }
          catch (_: Exception) { System.currentTimeMillis() / 1000 + 30L * 24 * 60 * 60 }
        accessToken = token
        refreshToken = null
        accessExpiry = expiry
        currentPhone = phone
        prefs.edit().putString("access_token", token).remove("refresh_token")
          .putLong("access_expiry", expiry).putString("phone", phone).apply()
        showSignedIn()
        setStatus("Setup transferred. Tap ‘Enable Server in phone app’ to register the Server internet-calling account. This is not a SIM/eSIM.")
      } catch (e: Exception) {
        setStatus(e.message ?: "Could not transfer setup to the Server app.", true)
      }
    }
  }

  private fun recordTelecomDebugStage(stage: String) {
    if (!BuildConfig.DEBUG) return
    // Diagnostic stages deliberately exclude numbers, tokens, and other user data.
    prefs.edit()
      .putString("debug_last_telecom_stage", stage)
      .putLong("debug_last_telecom_stage_at", System.currentTimeMillis())
      .apply()
  }

  private fun handleTelecomIntent(intent: Intent?) {
    if (intent == null) return
    when (intent.getStringExtra("server_action")) {
      "dial" -> {
        recordTelecomDebugStage("dial_intent_received")
        val target = intent.getStringExtra("server_dialed_number").orEmpty()
        if (target.isNotBlank()) {
          pendingDialedNumber = target
          // Telecom can re-use a background Activity. Reload the current session before
          // scheduling a call rather than trusting fields from an earlier Activity instance.
          accessToken = prefs.getString("access_token", accessToken)
          refreshToken = prefs.getString("refresh_token", refreshToken)
          accessExpiry = prefs.getLong("access_expiry", accessExpiry)
          if (!accessToken.isNullOrBlank()) {
            pendingDialedNumber = null
            targetInput.setText(target)
            recordTelecomDebugStage("dial_call_scheduled")
            lifecycleScope.launch { delay(150); startCall() }
          } else {
            recordTelecomDebugStage("dial_waiting_for_sign_in")
          }
        } else {
          recordTelecomDebugStage("dial_target_missing")
        }
      }
      "incoming" -> {
        val id = intent.getStringExtra("server_call_id").orEmpty()
        val phone = intent.getStringExtra("server_remote_phone")
          ?: intent.getStringExtra("server_caller_id") ?: "Server caller"
        if (id.isNotBlank()) { shownIncoming.add(id); setStatus("Incoming Server from ${mask(phone)}. Answer or decline using the phone app's calling UI.") }
      }
      "answer" -> {
        val id = intent.getStringExtra("server_call_id").orEmpty()
        if (id.isNotBlank()) lifecycleScope.launch { acceptCall(id) }
      }
      "decline" -> {
        val id = intent.getStringExtra("server_call_id").orEmpty()
        if (id.isNotBlank()) lifecycleScope.launch { declineCall(id) }
      }
      "hangup" -> lifecycleScope.launch { endCall() }
    }
  }

  private fun mask(value: String) = if (value.length > 6) value.take(4) + "••••" + value.takeLast(3) else value

  private suspend fun authRequest(path: String, body: JSONObject, bearer: Boolean = false): JSONObject = http(path, body, bearer)
  private suspend fun api(action: String, payload: JSONObject = JSONObject()): JSONObject {
    ensureFreshSession()
    return http("/functions/v1/server-calls", payload.put("action", action), true)
  }
  private suspend fun http(path: String, body: JSONObject, bearer: Boolean): JSONObject = withContext(Dispatchers.IO) {
    val project = BuildConfig.SUPABASE_URL.trimEnd('/')
    val connection = (URL(project + path).openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"; connectTimeout = 15000; readTimeout = 20000; doOutput = true
      setRequestProperty("content-type", "application/json")
      setRequestProperty("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
      if (bearer && !accessToken.isNullOrBlank()) setRequestProperty("authorization", "Bearer $accessToken")
    }
    try {
      connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
      val code = connection.responseCode
      val stream = if (code in 200..299) connection.inputStream else connection.errorStream
      val text = stream?.use { input -> BufferedReader(InputStreamReader(input)).readText() }.orEmpty()
      val result = try { JSONObject(text) } catch (_: Exception) { JSONObject() }
      if (code !in 200..299) {
        val reason = result.optString("msg", result.optString("message", result.optString("error", "HTTP $code")))
        throw IllegalStateException("$reason (HTTP $code)")
      }
      result
    } finally { connection.disconnect() }
  }

  private suspend fun ensureFreshSession() {
    if (accessToken.isNullOrBlank()) throw IllegalStateException("Finish Server ID setup on the website first.")
    if (accessExpiry > System.currentTimeMillis() / 1000 + 90) return
    val res = http("/functions/v1/server-auth", JSONObject().put("action", "refresh"), true)
    accessToken = res.optString("access_token")
    refreshToken = null
    accessExpiry = try { java.time.Instant.parse(res.optString("expires_at")).epochSecond } catch (_: Exception) { System.currentTimeMillis() / 1000 + 30L * 24 * 60 * 60 }
    prefs.edit().putString("access_token", accessToken).putString("refresh_token", refreshToken).putLong("access_expiry", accessExpiry).apply()
  }

  private fun normalizePhoneForServer(raw: String): String? {
    val value = raw.trim()
    val digits = value.filter { it.isDigit() }
    val candidate = when {
      value.startsWith("+") -> "+$digits"
      value.startsWith("00") -> "+" + digits.drop(2)
      digits.startsWith("234") && digits.length == 13 -> "+$digits"
      digits.length == 11 && digits.startsWith("0") -> "+234" + digits.drop(1)
      digits.length == 10 && digits.firstOrNull() in '7'..'9' -> "+234$digits"
      else -> return null
    }
    return candidate.takeIf { Regex("^\\+[1-9][0-9]{7,14}$").matches(it) }
  }

  /** Opens the user's SMS composer; Server never sends a paid or unsolicited SMS silently. */
  private fun openGuestInviteComposer(number: String, body: String) {
    val smsIntent = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:$number")).apply {
      putExtra("sms_body", body)
    }
    try {
      startActivity(smsIntent)
      setStatus("Guest invitation prepared in your SMS app. Tap Send there; then return to the call. The recipient must open it with internet and microphone access.")
    } catch (_: Exception) {
      try {
        val share = Intent(Intent.ACTION_SEND).apply {
          type = "text/plain"
          putExtra(Intent.EXTRA_TEXT, body)
        }
        startActivity(Intent.createChooser(share, "Share Server guest-call invitation"))
        setStatus("Choose Messages or another app to share the invitation. The recipient needs internet and microphone access.")
      } catch (e: Exception) {
        setStatus("The guest invitation is ready, but no messaging app could open it. Copy and share this link manually: " + body, true)
      }
    }
  }

  /** Presents a user-confirmed route into the normal carrier dialer; it never silently places a paid call. */
  private fun notifyCarrierFallback(number: String, reason: String) {
    if (!Regex("^\\+[1-9][0-9]{7,14}$").matches(number)) return
    try {
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val channelId = "server-carrier-fallback"
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        manager.createNotificationChannel(NotificationChannel(
          channelId, "Server carrier-call fallback", NotificationManager.IMPORTANCE_HIGH
        ).apply { description = "Lets you switch to a normal carrier call when Server cannot reach a user." })
      }
      val dialIntent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:$number")).apply {
        // Let Android and the user choose their normal carrier account, if needed.
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      val pending = PendingIntent.getActivity(
        this, number.hashCode(), dialIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      val notification = Notification.Builder(this, channelId)
        .setSmallIcon(android.R.drawable.sym_action_call)
        .setContentTitle("Try a normal carrier call")
        .setContentText(reason)
        .setStyle(Notification.BigTextStyle().bigText("$reason Tap to open the phone dialer and place a regular call. Your mobile operator may charge you."))
        .setCategory(Notification.CATEGORY_CALL)
        .setAutoCancel(true)
        .setContentIntent(pending)
        .build()
      manager.notify(7341, notification)
    } catch (_: Exception) {
      Toast.makeText(this, "$reason Open your normal phone dialer to place a carrier call; charges may apply.", Toast.LENGTH_LONG).show()
    }
  }

  private fun startCall(): Job = lifecycleScope.launch {
    recordTelecomDebugStage("start_call_entered")
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      recordTelecomDebugStage("start_call_microphone_permission_missing")
      askMic.launch(Manifest.permission.RECORD_AUDIO)
      setStatus("Allow microphone access and tap Call with Server again.", true)
      return@launch
    }
    val typedTarget = targetInput.text.toString().trim()
    val serverId = typedTarget.uppercase()
    val isServerId = Regex("^SVR-[0-9A-F]{10}$").matches(serverId)
    val normalizedPhone = if (isServerId) null else normalizePhoneForServer(typedTarget)
    if (!isServerId && normalizedPhone == null) {
      recordTelecomDebugStage("start_call_target_invalid")
      setStatus("Enter a Server ID (SVR- plus 10 characters) or a valid phone number, e.g. 08012345678 or +2348012345678.", true)
      return@launch
    }
    // Debug builds record that Telecom's system-originated tel: request reached
    // the actual call engine. Instrumentation uses a deliberately invalid token,
    // so this check does not create a backend call or send SMS.
    if (BuildConfig.DEBUG) {
      recordTelecomDebugStage("call_engine_reached")
      prefs.edit()
        .putLong("debug_last_call_engine_entered_at", System.currentTimeMillis())
        .putString("debug_last_call_target_kind", if (isServerId) "server_id" else "phone")
        .apply()
    }
    val payload = JSONObject()
    if (isServerId) payload.put("to_server_id", serverId) else payload.put("to_phone", normalizedPhone)
    callButton.isEnabled = false
    try {
      val started = api("start", payload)
      callId = started.getString("call_id"); ServerTelecomRegistry.setCurrentCallId(callId)
      activeStateSyncedFor = null; currentRoute = started.optString("route", "server"); lastSeq = 0
      callStartedAt = System.currentTimeMillis()
      carrierFallbackOfferedFor = null
      val mappedPhone = started.optJSONObject("call")?.optString("callee_phone_e164").orEmpty()
      carrierFallbackPhone = (normalizedPhone ?: mappedPhone).takeIf { Regex("^\\+[1-9][0-9]{7,14}$").matches(it) }
      callIceServers = started.optJSONArray("ice_servers") ?: JSONArray()
      preparePeer(callIceServers)
      val offer = createLocalDescription(true)
      api("signal", JSONObject().put("call_id", callId).put("kind", "offer").put("payload", offer))
      callButton.visibility = View.GONE; hangupButton.visibility = View.VISIBLE
      beginCallPolling()
      val deliveryMode = started.optString("delivery_mode", "")
      val invitationBody = started.optString("sms_body", "")
      if (currentRoute == "guest" && deliveryMode == "manual_sms" && invitationBody.isNotBlank() && normalizedPhone != null) {
        openGuestInviteComposer(normalizedPhone, invitationBody)
      } else {
        setStatus(if (currentRoute == "guest") "Guest invitation queued for SMS delivery. The recipient must open it with internet and microphone access." else "Calling another Server user… waiting for answer.")
      }
    } catch (e: Exception) {
      recordTelecomDebugStage("call_backend_start_failed")
      // If Telecom launched this engine, tell the system dialer that the internet
      // route failed instead of leaving an endless "Dialing via Server" call.
      ServerTelecomRegistry.markEnded(callId)
      val fallbackPhone = normalizedPhone
      cleanPeer(); callId = null; carrierFallbackPhone = null
      setStatus(e.message ?: "Could not start call.", true)
      if (fallbackPhone != null) notifyCarrierFallback(fallbackPhone, "Server could not reach its call service.")
    } finally { callButton.isEnabled = true }
  }
  private suspend fun incomingLoop() {
    while (lifecycleScope.coroutineContext.isActive && !accessToken.isNullOrBlank()) {
      try {
        val result = api("incoming")
        val calls = result.optJSONArray("calls") ?: JSONArray()
        for (i in 0 until calls.length()) {
          val call = calls.optJSONObject(i) ?: continue
          val id = call.optString("id")
          if (id.isNotBlank() && id !in shownIncoming && id != callId) {
            shownIncoming.add(id)
            val caller = call.optString("caller_server_id").takeIf { it.isNotBlank() }
              ?: call.optString("caller_phone_e164", "Server caller")
            if (ServerTelecomRegistry.isEnabled(this)) {
              try { ServerTelecomRegistry.reportIncoming(this, id, caller) }
              catch (_: Exception) { runOnUiThread { showIncomingDialog(id, caller) } }
            } else runOnUiThread { showIncomingDialog(id, caller) }
          }
        }
      } catch (_: Exception) { /* retry on next poll; do not log session secrets */ }
      delay(2200)
    }
  }

  private fun showIncomingDialog(id: String, from: String) {
    if (isFinishing || callId != null) return
    AlertDialog.Builder(this)
      .setTitle("Incoming Server call")
      .setMessage("Call from ${mask(from)}")
      .setPositiveButton("Answer") { _, _ -> lifecycleScope.launch { acceptCall(id) } }
      .setNegativeButton("Decline") { _, _ -> lifecycleScope.launch { declineCall(id) } }
      .setOnCancelListener { shownIncoming.remove(id) }
      .show()
  }

  private suspend fun acceptCall(id: String) {
    try {
      callId = id; activeStateSyncedFor = null; currentRoute = "server"; lastSeq = 0
      carrierFallbackPhone = null
      val accepted = api("accept", JSONObject().put("call_id", id))
      callIceServers = accepted.optJSONArray("ice_servers") ?: JSONArray()
      preparePeer(callIceServers)
      callButton.visibility = View.GONE; hangupButton.visibility = View.VISIBLE
      setStatus("Incoming call accepted. Connecting audio…")
      beginCallPolling()
    } catch (e: Exception) { callId = null; cleanPeer(); setStatus(e.message ?: "Could not answer call.", true) }
  }

  private suspend fun declineCall(id: String) {
    try { api("signal", JSONObject().put("call_id", id).put("kind", "hangup").put("payload", JSONObject())) } catch (_: Exception) {}
    shownIncoming.remove(id)
  }

  private suspend fun preparePeer(serversJson: JSONArray) {
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) throw IllegalStateException("Microphone permission is required.")
    if (peer != null) cleanPeer()
    val init = PeerConnectionFactory.InitializationOptions.builder(applicationContext).createInitializationOptions()
    PeerConnectionFactory.initialize(init)
    audioModule = JavaAudioDeviceModule.builder(applicationContext).createAudioDeviceModule()
    peerFactory = PeerConnectionFactory.builder().setAudioDeviceModule(audioModule).createPeerConnectionFactory()
    val servers = mutableListOf<PeerConnection.IceServer>()
    for (i in 0 until serversJson.length()) {
      val row = serversJson.optJSONObject(i) ?: continue
      val urlsValue = row.opt("urls")
      val urls = if (urlsValue is JSONArray) (0 until urlsValue.length()).mapNotNull { urlsValue.optString(it).takeIf(String::isNotBlank) } else listOfNotNull(urlsValue?.toString()?.takeIf(String::isNotBlank))
      if (urls.isEmpty()) continue
      val builder = PeerConnection.IceServer.builder(urls)
      if (row.has("username")) builder.setUsername(row.optString("username"))
      if (row.has("credential")) builder.setPassword(row.optString("credential"))
      servers.add(builder.createIceServer())
    }
    if (servers.isEmpty()) servers.add(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer())
    val cfg = PeerConnection.RTCConfiguration(servers).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN }
    peer = peerFactory?.createPeerConnection(cfg, this) ?: throw IllegalStateException("WebRTC peer could not be created.")
    audioSource = peerFactory?.createAudioSource(MediaConstraints())
    audioTrack = peerFactory?.createAudioTrack("server-audio", audioSource)
    audioTrack?.setEnabled(true)
    audioTrack?.let { peer?.addTrack(it, listOf("server-audio-stream")) }
    val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    am.mode = AudioManager.MODE_IN_COMMUNICATION
    am.isSpeakerphoneOn = true
  }

  private suspend fun createLocalDescription(offer: Boolean): JSONObject = suspendCancellableCoroutine { cont ->
    val activePeer = peer
    if (activePeer == null) { cont.resumeWithException(IllegalStateException("WebRTC is not ready.")); return@suspendCancellableCoroutine }
    val observer = object : SdpObserver {
      override fun onCreateSuccess(desc: SessionDescription) {
        activePeer.setLocalDescription(object : SdpObserver {
          override fun onCreateSuccess(p0: SessionDescription?) {}
          override fun onSetSuccess() {
            if (cont.isActive) cont.resume(JSONObject().put("type", if (offer) "offer" else "answer").put("sdp", desc.description))
          }
          override fun onCreateFailure(error: String) { if (cont.isActive) cont.resumeWithException(IllegalStateException(error)) }
          override fun onSetFailure(error: String) { if (cont.isActive) cont.resumeWithException(IllegalStateException(error)) }
        }, desc)
      }
      override fun onSetSuccess() {}
      override fun onCreateFailure(error: String) { if (cont.isActive) cont.resumeWithException(IllegalStateException(error)) }
      override fun onSetFailure(error: String) { if (cont.isActive) cont.resumeWithException(IllegalStateException(error)) }
    }
    if (offer) activePeer.createOffer(observer, MediaConstraints()) else activePeer.createAnswer(observer, MediaConstraints())
    cont.invokeOnCancellation { /* WebRTC callbacks may still arrive; cont.isActive protects them. */ }
  }

  private suspend fun setRemoteDescription(descJson: JSONObject) = suspendCancellableCoroutine<Unit> { cont ->
    val activePeer = peer
    if (activePeer == null) { cont.resumeWithException(IllegalStateException("WebRTC is not ready.")); return@suspendCancellableCoroutine }
    val type = if (descJson.optString("type") == "offer") SessionDescription.Type.OFFER else SessionDescription.Type.ANSWER
    activePeer.setRemoteDescription(object : SdpObserver {
      override fun onCreateSuccess(p0: SessionDescription?) {}
      override fun onSetSuccess() { if (cont.isActive) cont.resume(Unit) }
      override fun onCreateFailure(error: String) { if (cont.isActive) cont.resumeWithException(IllegalStateException(error)) }
      override fun onSetFailure(error: String) { if (cont.isActive) cont.resumeWithException(IllegalStateException(error)) }
    }, SessionDescription(type, descJson.optString("sdp")))
  }

  private suspend fun handleSignal(signal: JSONObject) {
    when (signal.optString("kind")) {
      "offer" -> {
        if (peer == null) preparePeer(callIceServers)
        setRemoteDescription(signal.optJSONObject("payload") ?: JSONObject())
        pendingIce.toList().forEach { peer?.addIceCandidate(it) }; pendingIce.clear()
        val answer = createLocalDescription(false)
        val id = callId ?: return
        api("signal", JSONObject().put("call_id", id).put("kind", "answer").put("payload", answer))
        setStatus("Answer sent. Establishing the WebRTC audio connection…")
      }
      "answer" -> {
        setRemoteDescription(signal.optJSONObject("payload") ?: JSONObject())
        pendingIce.toList().forEach { peer?.addIceCandidate(it) }; pendingIce.clear()
        setStatus("Call answered. Negotiating audio…")
      }
      "ice" -> {
        val payload = signal.optJSONObject("payload") ?: return
        val candidate = payload.optString("candidate")
        if (candidate.isNotBlank()) {
          val ice = IceCandidate(payload.optString("sdpMid"), payload.optInt("sdpMLineIndex"), candidate)
          if (peer?.remoteDescription != null) peer?.addIceCandidate(ice) else pendingIce.add(ice)
        }
      }
      "hangup" -> { cleanPeer(); callId = null; setStatus("The other person ended the call."); showCallIdle() }
      "state" -> if (signal.optJSONObject("payload")?.optString("state") == "active") setStatus("Call active.")
    }
  }

  private fun beginCallPolling() {
    pollingJob?.cancel()
    pollingJob = lifecycleScope.launch {
      while (isActive && callId != null) {
        try {
          val id = callId ?: break
          val result = api("poll", JSONObject().put("call_id", id).put("after_seq", lastSeq))
          val signals = result.optJSONArray("signals") ?: JSONArray()
          for (i in 0 until signals.length()) {
            val signal = signals.optJSONObject(i) ?: continue
            lastSeq = maxOf(lastSeq, signal.optLong("seq", 0L))
            handleSignal(signal)
          }
          lastSeq = maxOf(lastSeq, result.optLong("next_after_seq", lastSeq))
          val state = result.optJSONObject("call")?.optString("state") ?: ""
          val fallbackPhone = carrierFallbackPhone
          // A non-Server recipient cannot receive WebRTC while offline. If the
          // call remains in ringing state, offer a user-confirmed carrier fallback
          // for both Server users and guest invitees; never place it automatically.
          if (state == "ringing" && fallbackPhone != null &&
              System.currentTimeMillis() - callStartedAt >= 30_000 && carrierFallbackOfferedFor != id) {
            carrierFallbackOfferedFor = id
            val guestRecipient = currentRoute == "guest"
            val reason = if (guestRecipient) {
              "The guest recipient has not joined the internet call."
            } else {
              "The Server user has not connected. They may be offline."
            }
            notifyCarrierFallback(fallbackPhone, reason)
            try { api("end", JSONObject().put("call_id", id)) } catch (_: Exception) {}
            callId = null
            cleanPeer()
            showCallIdle()
            setStatus(
              if (guestRecipient) {
                "Guest has not joined. A notification offers a regular carrier call instead; no carrier call was placed automatically."
              } else {
                "Server did not connect. A notification offers a regular carrier call instead; no carrier call was placed automatically."
              },
              true
            )
            break
          }
          if (state in listOf("ended", "failed", "missed")) { cleanPeer(); callId = null; carrierFallbackPhone = null; showCallIdle(); setStatus("Call ended."); break }
        } catch (e: Exception) { setStatus(e.message ?: "Call connection interrupted.", true) }
        delay(700)
      }
    }
  }

  private fun endCall() = lifecycleScope.launch {
    val id = callId
    if (id != null) try { api("end", JSONObject().put("call_id", id)) } catch (_: Exception) {}
    cleanPeer(); callId = null; carrierFallbackPhone = null; showCallIdle(); setStatus("Call ended.")
  }
  private fun showCallIdle() { runOnUiThread { callButton.visibility = View.VISIBLE; hangupButton.visibility = View.GONE } }
  private fun cleanPeer() {
    pollingJob?.cancel(); pollingJob = null
    activeStateSyncedFor = null
    try { peer?.close() } catch (_: Exception) {}
    peer = null; audioTrack = null; pendingIce.clear()
    ServerTelecomRegistry.markEnded(callId)
    try { audioSource?.dispose() } catch (_: Exception) {}
    audioSource = null
    try { peerFactory?.dispose() } catch (_: Exception) {}
    peerFactory = null
    try { audioModule?.release() } catch (_: Exception) {}
    audioModule = null
    val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    am.isSpeakerphoneOn = false; am.mode = AudioManager.MODE_NORMAL
  }
  private fun signOut() {
    cleanPeer(); callId = null; incomingJob?.cancel(); incomingJob = null
    accessToken = null; refreshToken = null; accessExpiry = 0
    prefs.edit().remove("access_token").remove("refresh_token").remove("access_expiry").apply()
    authPanel.visibility = View.VISIBLE; callPanel.visibility = View.GONE
    showSetupRequired()
    setStatus("Server session cleared on this device.")
  }

  override fun onDestroy() { cleanPeer(); incomingJob?.cancel(); super.onDestroy() }

  // PeerConnection.Observer
  override fun onSignalingChange(state: PeerConnection.SignalingState) {}
  override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
    runOnUiThread {
      when (state) {
        PeerConnection.IceConnectionState.CONNECTED, PeerConnection.IceConnectionState.COMPLETED -> {
          ServerTelecomRegistry.markConnected(callId)
          setStatus("Audio connection established.")
          val connectedId = callId
          if (connectedId != null && activeStateSyncedFor != connectedId) {
            activeStateSyncedFor = connectedId
            lifecycleScope.launch {
              try {
                api("set_active", JSONObject().put("call_id", connectedId))
              } catch (_: Exception) {
                if (callId == connectedId) {
                  setStatus("Audio is connected, but the server could not sync the call state.", true)
                }
              }
            }
          }
        }
        PeerConnection.IceConnectionState.FAILED -> setStatus("ICE failed. A TURN relay may be required on this network.", true)
        PeerConnection.IceConnectionState.DISCONNECTED -> setStatus("Connection lost. Trying to recover…", true)
        else -> Unit
      }
    }
  }
  override fun onIceConnectionReceivingChange(receiving: Boolean) {}
  override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {}
  override fun onIceCandidate(candidate: IceCandidate) {
    lifecycleScope.launch {
      val id = callId ?: return@launch
      try {
        api("signal", JSONObject().put("call_id", id).put("kind", "ice").put("payload", JSONObject()
          .put("candidate", candidate.sdp).put("sdpMid", candidate.sdpMid).put("sdpMLineIndex", candidate.sdpMLineIndex)))
      } catch (_: Exception) { /* next poll/status exposes signalling issues without logging secrets */ }
    }
  }
  override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
  override fun onAddStream(stream: org.webrtc.MediaStream) {}
  override fun onRemoveStream(stream: org.webrtc.MediaStream) {}
  override fun onDataChannel(dataChannel: org.webrtc.DataChannel) {}
  override fun onRenegotiationNeeded() {}
  override fun onAddTrack(receiver: RtpReceiver, mediaStreams: Array<out org.webrtc.MediaStream>) {
    (receiver.track() as? AudioTrack)?.setEnabled(true)
  }
}
