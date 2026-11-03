package com.server.caller

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.telecom.Connection
import android.util.Log
import androidx.core.app.NotificationCompat
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
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.audio.JavaAudioDeviceModule
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * The call engine is owned by Android Telecom's bound ConnectionService, not by
 * an Activity. Telecom keeps the service bound for the life of its Connection.
 * This avoids Android's background-activity-start restriction entirely.
 */
internal class ServerTelecomCallEngine(
  private val owner: ServerConnectionService,
  private val connection: ServerTelecomConnection
) : PeerConnection.Observer {
  private val context = owner.applicationContext
  private val prefs by lazy { context.getSharedPreferences("server-session", Context.MODE_PRIVATE) }
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private var accessToken: String? = null
  private var accessExpiry = 0L
  private var callId: String? = null
  private var route = "server"
  private var lastSeq = 0L
  private var activeStateSyncedFor: String? = null
  private var peer: PeerConnection? = null
  private var peerFactory: PeerConnectionFactory? = null
  private var audioSource: AudioSource? = null
  private var audioTrack: AudioTrack? = null
  private var audioModule: JavaAudioDeviceModule? = null
  private var iceServers = JSONArray()
  private val pendingIce = mutableListOf<IceCandidate>()
  private var actionJob: Job? = null
  private var pollingJob: Job? = null
  private var disposed = false
  @Volatile private var hangupRequested = false

  init {
    accessToken = prefs.getString("access_token", null)
    accessExpiry = prefs.getLong("access_expiry", 0L)
  }

  fun startOutgoing(rawTarget: String) {
    actionJob = scope.launch { placeOutgoing(rawTarget) }
  }

  fun answerIncoming(id: String) {
    if (id.isBlank()) return
    actionJob = scope.launch { acceptIncoming(id) }
  }

  fun declineIncoming(id: String) {
    actionJob = scope.launch { finishCall(id, "declined") }
  }

  fun hangup() {
    hangupRequested = true
    if (actionJob?.isActive != true) {
      val id = callId ?: ServerTelecomRegistry.currentCallId()
      actionJob = scope.launch { finishCall(id.orEmpty(), "local") }
    }
  }

  private suspend fun placeOutgoing(rawTarget: String) {
    recordStage("call_engine_service_started")
    try {
      val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      val capabilities = connectivity.activeNetwork?.let { connectivity.getNetworkCapabilities(it) }
      if (capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) != true) {
        throw IllegalStateException("Server needs mobile data or Wi-Fi to place an internet call.")
      }
      if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        throw IllegalStateException("Microphone permission is missing. Reopen Server setup and allow microphone access.")
      }
      val target = normalizePhone(rawTarget)
        ?: throw IllegalStateException("The number from Android Phone could not be read as a Nigerian or international number.")
      if (BuildConfig.DEBUG) {
        prefs.edit()
          .putLong("debug_last_call_engine_entered_at", System.currentTimeMillis())
          .putString("debug_last_call_target_kind", "phone")
          .putBoolean("debug_call_engine_service_started", true)
          .apply()
      }
      recordStage("backend_start_requested")
      val started = api("start", JSONObject().put("to_phone", target))
      callId = started.optString("call_id").takeIf { it.isNotBlank() }
        ?: throw IllegalStateException("Server did not return a call ID.")
      ServerTelecomRegistry.setCurrentCallId(callId)
      if (hangupRequested) {
        finishCall(callId.orEmpty(), "local")
        return
      }
      route = started.optString("route", "guest")
      lastSeq = 0
      iceServers = started.optJSONArray("ice_servers") ?: JSONArray()
      recordStage("backend_call_created")
      preparePeer(iceServers)
      if (hangupRequested) {
        finishCall(callId.orEmpty(), "local")
        return
      }
      val offer = createLocalDescription(offer = true)
      api("signal", JSONObject().put("call_id", callId).put("kind", "offer").put("payload", offer))
      recordStage("call_offer_submitted")
      if (route == "guest") {
        val invite = started.optString("invitation_text", started.optString("sms_body", ""))
        if (invite.isNotBlank()) {
          ServerGuestInviteNotifications.show(context, callId.orEmpty(), target, invite)
        } else {
          throw IllegalStateException("Server created the guest route but did not return an invitation link.")
        }
      } else {
        val acceptedPush = started.optJSONObject("push_delivery")?.optInt("sent", 0) ?: 0
        if (acceptedPush == 0) {
          Log.w(TAG, "No push provider accepted a wake alert; recipient must have the Server listener active.")
        }
      }
      beginPolling()
    } catch (error: Exception) {
      failCall(error.message ?: "Unknown call-start error")
    }
  }

  private suspend fun acceptIncoming(id: String) {
    callId = id
    route = "server"
    lastSeq = 0
    try {
      recordStage("incoming_answer_requested")
      val accepted = api("accept", JSONObject().put("call_id", id))
      if (hangupRequested) {
        finishCall(id, "local")
        return
      }
      iceServers = accepted.optJSONArray("ice_servers") ?: JSONArray()
      preparePeer(iceServers)
      connection.markConnecting()
      beginPolling()
    } catch (error: Exception) {
      failCall(error.message ?: "Could not answer the incoming Server call.")
    }
  }

  private suspend fun finishCall(id: String, cause: String) {
    val target = id.ifBlank { callId.orEmpty() }
    try {
      if (target.isNotBlank() && !accessToken.isNullOrBlank()) {
        api("end", JSONObject().put("call_id", target))
      }
    } catch (error: Exception) {
      Log.w(TAG, "Server call-end request failed: " + error.javaClass.simpleName)
    } finally {
      // Telecom's onReject/onDisconnect already moved the native Connection to
      // DISCONNECTED. Only remote hangup and engine failures change its state here.
      cleanupPeer()
      release()
    }
  }

  private suspend fun failCall(message: String) {
    recordStage("call_setup_failed")
    if (BuildConfig.DEBUG) prefs.edit().putString("debug_last_call_failure", message.take(240)).apply()
    val id = callId
    if (!id.isNullOrBlank()) {
      try { api("end", JSONObject().put("call_id", id)) } catch (_: Exception) {}
    }
    connection.markEnded()
    cleanupPeer()
    ServerCallNotifications.cancel(context, id.orEmpty())
    ServerCallEngineStatusNotifications.showFailure(context, message)
    release()
  }

  private fun beginPolling() {
    if (pollingJob?.isActive == true) return
    pollingJob = scope.launch {
      while (currentCoroutineContext().isActive && !disposed && !callId.isNullOrBlank()) {
        try {
          val id = callId ?: break
          val response = api("poll", JSONObject().put("call_id", id).put("after_seq", lastSeq))
          val signals = response.optJSONArray("signals") ?: JSONArray()
          for (index in 0 until signals.length()) {
            val signal = signals.optJSONObject(index) ?: continue
            lastSeq = maxOf(lastSeq, signal.optLong("seq", 0L))
            handleSignal(signal)
          }
          lastSeq = maxOf(lastSeq, response.optLong("next_after_seq", lastSeq))
          val state = response.optJSONObject("call")?.optString("state").orEmpty()
          if (state in listOf("ended", "failed", "missed")) {
            val endedId = callId
            if (!endedId.isNullOrBlank()) {
              ServerCallNotifications.cancel(context, endedId)
              connection.markRemoteEnded()
            }
            cleanupPeer()
            release()
            break
          }
        } catch (cancelled: CancellationException) {
          throw cancelled
        } catch (error: Exception) {
          Log.w(TAG, "Server call poll retry: " + error.javaClass.simpleName)
        }
        delay(700)
      }
    }
  }

  private suspend fun handleSignal(signal: JSONObject) {
    when (signal.optString("kind")) {
      "offer" -> {
        if (peer == null) preparePeer(iceServers)
        setRemoteDescription(signal.optJSONObject("payload") ?: JSONObject())
        pendingIce.toList().forEach { peer?.addIceCandidate(it) }
        pendingIce.clear()
        val answer = createLocalDescription(offer = false)
        val id = callId ?: return
        api("signal", JSONObject().put("call_id", id).put("kind", "answer").put("payload", answer))
      }
      "answer" -> {
        setRemoteDescription(signal.optJSONObject("payload") ?: JSONObject())
        pendingIce.toList().forEach { peer?.addIceCandidate(it) }
        pendingIce.clear()
      }
      "ice" -> {
        val payload = signal.optJSONObject("payload") ?: return
        val candidate = payload.optString("candidate")
        if (candidate.isNotBlank()) {
          val ice = IceCandidate(payload.optString("sdpMid"), payload.optInt("sdpMLineIndex"), candidate)
          if (peer?.remoteDescription != null) peer?.addIceCandidate(ice) else pendingIce.add(ice)
        }
      }
      "hangup" -> {
        val id = callId
        if (!id.isNullOrBlank()) {
          ServerCallNotifications.cancel(context, id)
          connection.markRemoteEnded()
        }
        cleanupPeer()
        release()
      }
      "state" -> Unit
    }
  }

  private suspend fun preparePeer(serversJson: JSONArray) {
    if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      throw IllegalStateException("Microphone permission is required for Server calls.")
    }
    if (peer != null) cleanupPeer()
    val init = PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions()
    PeerConnectionFactory.initialize(init)
    audioModule = JavaAudioDeviceModule.builder(context).createAudioDeviceModule()
    peerFactory = PeerConnectionFactory.builder().setAudioDeviceModule(audioModule).createPeerConnectionFactory()
    val servers = mutableListOf<PeerConnection.IceServer>()
    for (index in 0 until serversJson.length()) {
      val row = serversJson.optJSONObject(index) ?: continue
      val urlsValue = row.opt("urls")
      val urls = if (urlsValue is JSONArray) {
        (0 until urlsValue.length()).mapNotNull { urlsValue.optString(it).takeIf(String::isNotBlank) }
      } else listOfNotNull(urlsValue?.toString()?.takeIf(String::isNotBlank))
      if (urls.isEmpty()) continue
      val builder = PeerConnection.IceServer.builder(urls)
      if (row.has("username")) builder.setUsername(row.optString("username"))
      if (row.has("credential")) builder.setPassword(row.optString("credential"))
      servers.add(builder.createIceServer())
    }
    if (servers.isEmpty()) servers.add(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer())
    val config = PeerConnection.RTCConfiguration(servers).apply {
      sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
    }
    peer = peerFactory?.createPeerConnection(config, this)
      ?: throw IllegalStateException("WebRTC peer could not be created.")
    audioSource = peerFactory?.createAudioSource(MediaConstraints())
    audioTrack = peerFactory?.createAudioTrack("server-audio", audioSource)
    audioTrack?.setEnabled(true)
    audioTrack?.let { peer?.addTrack(it, listOf("server-audio-stream")) }
    (context.getSystemService(Context.AUDIO_SERVICE) as AudioManager).mode = AudioManager.MODE_IN_COMMUNICATION
  }

  private suspend fun createLocalDescription(offer: Boolean): JSONObject =
    suspendCancellableCoroutine { continuation ->
      val activePeer = peer
      if (activePeer == null) {
        continuation.resumeWithException(IllegalStateException("WebRTC is not ready."))
        return@suspendCancellableCoroutine
      }
      val observer = object : SdpObserver {
        override fun onCreateSuccess(description: SessionDescription) {
          activePeer.setLocalDescription(object : SdpObserver {
            override fun onCreateSuccess(p0: SessionDescription?) {}
            override fun onSetSuccess() {
              if (continuation.isActive) continuation.resume(
                JSONObject().put("type", if (offer) "offer" else "answer").put("sdp", description.description)
              )
            }
            override fun onCreateFailure(error: String) {
              if (continuation.isActive) continuation.resumeWithException(IllegalStateException(error))
            }
            override fun onSetFailure(error: String) {
              if (continuation.isActive) continuation.resumeWithException(IllegalStateException(error))
            }
          }, description)
        }
        override fun onSetSuccess() {}
        override fun onCreateFailure(error: String) {
          if (continuation.isActive) continuation.resumeWithException(IllegalStateException(error))
        }
        override fun onSetFailure(error: String) {
          if (continuation.isActive) continuation.resumeWithException(IllegalStateException(error))
        }
      }
      if (offer) activePeer.createOffer(observer, MediaConstraints())
      else activePeer.createAnswer(observer, MediaConstraints())
    }

  private suspend fun setRemoteDescription(value: JSONObject) =
    suspendCancellableCoroutine<Unit> { continuation ->
      val activePeer = peer
      if (activePeer == null) {
        continuation.resumeWithException(IllegalStateException("WebRTC is not ready."))
        return@suspendCancellableCoroutine
      }
      val type = if (value.optString("type") == "offer") SessionDescription.Type.OFFER
        else SessionDescription.Type.ANSWER
      activePeer.setRemoteDescription(object : SdpObserver {
        override fun onCreateSuccess(p0: SessionDescription?) {}
        override fun onSetSuccess() { if (continuation.isActive) continuation.resume(Unit) }
        override fun onCreateFailure(error: String) {
          if (continuation.isActive) continuation.resumeWithException(IllegalStateException(error))
        }
        override fun onSetFailure(error: String) {
          if (continuation.isActive) continuation.resumeWithException(IllegalStateException(error))
        }
      }, SessionDescription(type, value.optString("sdp")))
    }

  private suspend fun ensureFreshSession() {
    if (accessToken.isNullOrBlank()) throw IllegalStateException("Finish Server ID setup on this phone first.")
    if (accessExpiry > System.currentTimeMillis() / 1000 + 90) return
    val refreshed = postFunction("/functions/v1/server-auth", JSONObject().put("action", "refresh"), accessToken)
    accessToken = refreshed.optString("access_token").takeIf { it.matches(Regex("^[0-9a-f]{64}$")) }
      ?: throw IllegalStateException("Your Server session expired. Reopen Server setup.")
    accessExpiry = try {
      java.time.Instant.parse(refreshed.optString("expires_at")).epochSecond
    } catch (_: Exception) {
      System.currentTimeMillis() / 1000 + 30L * 24 * 60 * 60
    }
    prefs.edit().putString("access_token", accessToken).putLong("access_expiry", accessExpiry).apply()
  }

  private suspend fun api(action: String, payload: JSONObject = JSONObject()): JSONObject {
    ensureFreshSession()
    return postFunction("/functions/v1/server-calls", JSONObject(payload.toString()).put("action", action), accessToken)
  }

  private suspend fun postFunction(path: String, body: JSONObject, token: String?): JSONObject =
    withContext(Dispatchers.IO) {
      val connection = (URL(BuildConfig.SUPABASE_URL.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 15_000
        readTimeout = 20_000
        doOutput = true
        setRequestProperty("content-type", "application/json")
        setRequestProperty("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
        if (!token.isNullOrBlank()) setRequestProperty("authorization", "Bearer $token")
      }
      try {
        connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        val status = connection.responseCode
        val stream = if (status in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.use { input -> BufferedReader(InputStreamReader(input)).readText() }.orEmpty()
        val result = try { JSONObject(text) } catch (_: Exception) { JSONObject() }
        if (status !in 200..299) {
          val reason = result.optString("msg", result.optString("message", result.optString("error", "HTTP $status")))
          throw IllegalStateException("$reason (HTTP $status)")
        }
        result
      } finally {
        connection.disconnect()
      }
    }

  private fun normalizePhone(raw: String): String? {
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

  private fun recordStage(stage: String) {
    if (!BuildConfig.DEBUG) return
    prefs.edit().putString("debug_last_telecom_stage", stage)
      .putLong("debug_last_telecom_stage_at", System.currentTimeMillis()).apply()
  }

  private fun failCall(message: String) {
    recordStage("call_setup_failed")
    if (BuildConfig.DEBUG) prefs.edit().putString("debug_last_call_failure", message.take(240)).apply()
    val id = callId
    connection.markEnded()
    if (!id.isNullOrBlank()) {
      ServerCallNotifications.cancel(context, id)
      scope.launch { try { api("end", JSONObject().put("call_id", id)) } catch (_: Exception) {} }
    }
    cleanupPeer()
    ServerCallEngineStatusNotifications.showFailure(context, message)
    release()
  }

  private fun cleanupPeer() {
    pollingJob?.cancel()
    pollingJob = null
    try { peer?.close() } catch (_: Exception) {}
    peer = null
    audioTrack = null
    pendingIce.clear()
    try { audioSource?.dispose() } catch (_: Exception) {}
    audioSource = null
    try { peerFactory?.dispose() } catch (_: Exception) {}
    peerFactory = null
    try { audioModule?.release() } catch (_: Exception) {}
    audioModule = null
    activeStateSyncedFor = null
    try { (context.getSystemService(Context.AUDIO_SERVICE) as AudioManager).mode = AudioManager.MODE_NORMAL } catch (_: Exception) {}
  }

  private fun release() {
    if (disposed) return
    disposed = true
    cleanupPeer()
    owner.releaseEngine(this)
    scope.cancel()
  }

  override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
    when (state) {
      PeerConnection.IceConnectionState.CONNECTED, PeerConnection.IceConnectionState.COMPLETED -> {
        val id = callId ?: return
        connection.markConnected()
        if (activeStateSyncedFor != id) {
          activeStateSyncedFor = id
          scope.launch {
            try { api("set_active", JSONObject().put("call_id", id)) }
            catch (error: Exception) { Log.w(TAG, "Could not sync active Server call: " + error.javaClass.simpleName) }
          }
        }
      }
      PeerConnection.IceConnectionState.FAILED -> {
        ServerCallEngineStatusNotifications.showFailure(context, "Server audio failed to connect. This network may require a TURN relay.")
      }
      else -> Unit
    }
  }

  override fun onIceCandidate(candidate: IceCandidate) {
    scope.launch {
      val id = callId ?: return@launch
      try {
        api("signal", JSONObject().put("call_id", id).put("kind", "ice").put("payload", JSONObject()
          .put("candidate", candidate.sdp).put("sdpMid", candidate.sdpMid).put("sdpMLineIndex", candidate.sdpMLineIndex)))
      } catch (error: Exception) {
        Log.w(TAG, "Could not submit ICE candidate: " + error.javaClass.simpleName)
      }
    }
  }

  override fun onAddTrack(receiver: RtpReceiver, mediaStreams: Array<out org.webrtc.MediaStream>) {
    (receiver.track() as? AudioTrack)?.setEnabled(true)
  }
  override fun onSignalingChange(state: PeerConnection.SignalingState) {}
  override fun onIceConnectionReceivingChange(receiving: Boolean) {}
  override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {}
  override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
  override fun onAddStream(stream: org.webrtc.MediaStream) {}
  override fun onRemoveStream(stream: org.webrtc.MediaStream) {}
  override fun onDataChannel(dataChannel: org.webrtc.DataChannel) {}
  override fun onRenegotiationNeeded() {}

  companion object { private const val TAG = "ServerTelecomEngine" }
}

/** Actionable browser-invite notification, separate from the native call screen. */
internal object ServerGuestInviteNotifications {
  private const val CHANNEL = "server-guest-invitations-v1"

  fun show(context: Context, callId: String, phone: String, text: String) {
    if (Build.VERSION.SDK_INT >= 33 &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null) {
      manager.createNotificationChannel(NotificationChannel(
        CHANNEL, "Server guest-call invitations", NotificationManager.IMPORTANCE_DEFAULT
      ).apply { description = "Prompts you to send a secure browser invitation to a non-Server contact." })
    }
    val intent = Intent(context, ServerGuestInviteActivity::class.java).apply {
      putExtra(ServerGuestInviteActivity.EXTRA_TEXT, text)
      putExtra(ServerGuestInviteActivity.EXTRA_PHONE, phone)
      putExtra(ServerGuestInviteActivity.EXTRA_CALL_ID, callId)
    }
    val pending = PendingIntent.getActivity(
      context, 8500 + (callId.hashCode() and 0x0000FFFF), intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val notification = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(android.R.drawable.sym_action_call)
      .setContentTitle("Send Server invitation")
      .setContentText("Tap to send the secure internet-call link to the selected contact.")
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setAutoCancel(true)
      .setContentIntent(pending)
      .addAction(android.R.drawable.ic_menu_share, "Send invitation", pending)
      .build()
    manager.notify(8500 + (callId.hashCode() and 0x0000FFFF), notification)
  }
}

internal object ServerCallEngineStatusNotifications {
  private const val CHANNEL = "server-call-status-v1"
  fun showFailure(context: Context, message: String) {
    if (Build.VERSION.SDK_INT >= 33 &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null) {
      manager.createNotificationChannel(NotificationChannel(
        CHANNEL, "Server call status", NotificationManager.IMPORTANCE_DEFAULT
      ))
    }
    manager.notify(8601, NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(android.R.drawable.sym_call_missed)
      .setContentTitle("Server could not start the internet call")
      .setContentText(message.take(180))
      .setAutoCancel(true)
      .build())
  }
}

/** Opens sharing only after the user taps the invitation notification. */
class ServerGuestInviteActivity : android.app.Activity() {
  override fun onCreate(savedInstanceState: android.os.Bundle?) {
    super.onCreate(savedInstanceState)
    val text = intent.getStringExtra(EXTRA_TEXT).orEmpty()
    val phone = intent.getStringExtra(EXTRA_PHONE).orEmpty()
    if (text.isBlank()) { finish(); return }
    val share = Intent(Intent.ACTION_SEND).apply {
      type = "text/plain"
      putExtra(Intent.EXTRA_TEXT, text)
    }
    val sms = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:$phone")).apply { putExtra("sms_body", text) }
    val chooser = Intent.createChooser(share, "Send Server invitation").apply {
      putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(sms))
    }
    try { startActivity(chooser) } catch (_: Exception) {}
    finish()
  }

  companion object {
    const val EXTRA_TEXT = "server_guest_invitation_text"
    const val EXTRA_PHONE = "server_guest_invitation_phone"
    const val EXTRA_CALL_ID = "server_guest_invitation_call_id"
  }
}
