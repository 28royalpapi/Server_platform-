package com.server.caller

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.IBinder
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
 * Owns the actual call independently of an Activity. Android Telecom can bind
 * ConnectionService while Server's UI is closed; launching MainActivity from that
 * callback is blocked by Android's background-activity-start rules on modern OSes.
 */
class ServerCallEngineService : Service(), PeerConnection.Observer {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private val prefs by lazy { getSharedPreferences("server-session", Context.MODE_PRIVATE) }
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
  private var callIceServers = JSONArray()
  private val pendingIce = mutableListOf<IceCandidate>()
  private var inviteText: String? = null
  private var invitePhone: String? = null
  private var operation: Job? = null
  private var ending = false

  override fun onCreate() {
    super.onCreate()
    accessToken = prefs.getString("access_token", null)
    accessExpiry = prefs.getLong("access_expiry", 0L)
    ensureChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val action = intent?.action ?: return START_NOT_STICKY
    try {
      val notification = buildNotification("Starting Server call…", null, null)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (error: Exception) {
      Log.w(TAG, "Could not start call engine foreground service: " + error.javaClass.simpleName)
      stopSelf()
      return START_NOT_STICKY
    }

    when (action) {
      ACTION_OUTGOING -> {
        val target = intent.getStringExtra(EXTRA_TARGET).orEmpty()
        if (operation?.isActive != true) operation = scope.launch { runOutgoing(target) }
      }
      ACTION_ANSWER -> {
        val id = intent.getStringExtra(EXTRA_CALL_ID).orEmpty()
        if (operation?.isActive != true) operation = scope.launch { runAnswer(id) }
      }
      ACTION_END -> {
        val id = intent.getStringExtra(EXTRA_CALL_ID).orEmpty()
        if (operation?.isActive != true) operation = scope.launch { runEnd(id) }
      }
    }
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private suspend fun runOutgoing(rawTarget: String) {
    recordStage("call_engine_service_started")
    try {
      val connectivity = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      val capabilities = connectivity.activeNetwork?.let { connectivity.getNetworkCapabilities(it) }
      if (capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) != true) {
        throw IllegalStateException("Server needs mobile data or Wi-Fi to place an internet call.")
      }
      if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        throw IllegalStateException("Microphone permission is missing. Reopen Server setup and allow microphone access.")
      }
      val normalized = normalizePhone(rawTarget)
        ?: throw IllegalStateException("The number from Android Phone could not be read as a Nigerian or international number.")
      if (BuildConfig.DEBUG) {
        prefs.edit()
          .putLong("debug_last_call_engine_entered_at", System.currentTimeMillis())
          .putString("debug_last_call_target_kind", "phone")
          .putBoolean("debug_call_engine_service_started", true)
          .apply()
      }
      recordStage("backend_start_requested")
      val started = api("start", JSONObject().put("to_phone", normalized))
      callId = started.optString("call_id").takeIf { it.isNotBlank() }
        ?: throw IllegalStateException("Server did not return a call ID.")
      ServerTelecomRegistry.setCurrentCallId(callId)
      route = started.optString("route", "guest")
      lastSeq = 0
      callIceServers = started.optJSONArray("ice_servers") ?: JSONArray()
      recordStage("backend_call_created")
      preparePeer(callIceServers)
      val offer = createLocalDescription(offer = true)
      api("signal", JSONObject().put("call_id", callId).put("kind", "offer").put("payload", offer))
      recordStage("call_offer_submitted")
      if (route == "guest") {
        invitePhone = normalized
        inviteText = started.optString("invitation_text", started.optString("sms_body", "")).takeIf { it.isNotBlank() }
        updateNotification(
          "Server invitation ready",
          "Send the secure internet-call invitation to the contact you selected.",
          inviteText,
          invitePhone
        )
      } else {
        val sent = started.optJSONObject("push_delivery")?.optInt("sent", 0) ?: 0
        val message = if (sent > 0) {
          "Server call alert submitted. Waiting for the other Server user to answer."
        } else {
          "Call created. No push wake was accepted; the recipient must have Server's incoming-call listener running or reopen Server."
        }
        updateNotification("Server call", message, null, null)
      }
      beginPolling()
    } catch (error: Exception) {
      failCall(error.message ?: "Unknown call-start error")
    }
  }

  private suspend fun runAnswer(id: String) {
    if (id.isBlank()) {
      failCall("The incoming Server call ID is missing.")
      return
    }
    callId = id
    route = "server"
    lastSeq = 0
    try {
      recordStage("incoming_answer_requested")
      val accepted = api("accept", JSONObject().put("call_id", id))
      callIceServers = accepted.optJSONArray("ice_servers") ?: JSONArray()
      preparePeer(callIceServers)
      ServerTelecomRegistry.markConnecting(id)
      updateNotification("Server call connecting", "Negotiating the internet audio connection.", null, null)
      beginPolling()
    } catch (error: Exception) {
      failCall(error.message ?: "Could not answer the incoming Server call.")
    }
  }

  private suspend fun runEnd(id: String) {
    ending = true
    val target = id.ifBlank { callId.orEmpty() }
    try {
      if (target.isNotBlank() && validSession()) {
        api("end", JSONObject().put("call_id", target))
      }
    } catch (error: Exception) {
      Log.w(TAG, "Server call-end request failed: " + error.javaClass.simpleName)
    } finally {
      if (target.isNotBlank()) ServerTelecomRegistry.markEnded(target)
      if (callId == target || target.isBlank()) cleanupPeer()
      callId = null
      finishService()
    }
  }

  private fun validSession(): Boolean = !accessToken.isNullOrBlank()

  private suspend fun failCall(message: String) {
    recordStage("call_setup_failed")
    if (BuildConfig.DEBUG) prefs.edit().putString("debug_last_call_failure", message.take(240)).apply()
    val id = callId
    if (!id.isNullOrBlank()) {
      try { api("end", JSONObject().put("call_id", id)) } catch (_: Exception) {}
      ServerTelecomRegistry.markEnded(id)
    } else {
      ServerTelecomRegistry.markEnded()
    }
    cleanupPeer()
    updateNotification("Server call could not start", message, null, null)
    stopForeground(STOP_FOREGROUND_DETACH)
    // Leave the short-lived diagnostic notification visible, but do not keep
    // a phone-call foreground service running after call setup has failed.
    scope.launch {
      delay(7_000)
      finishService()
    }
  }

  private fun beginPolling() {
    if (operation?.isActive == true) return
    operation = scope.launch {
      while (currentCoroutineContext().isActive && !ending && !callId.isNullOrBlank()) {
        try {
          val id = callId ?: break
          val result = api("poll", JSONObject().put("call_id", id).put("after_seq", lastSeq))
          val signals = result.optJSONArray("signals") ?: JSONArray()
          for (index in 0 until signals.length()) {
            val signal = signals.optJSONObject(index) ?: continue
            lastSeq = maxOf(lastSeq, signal.optLong("seq", 0L))
            handleSignal(signal)
          }
          lastSeq = maxOf(lastSeq, result.optLong("next_after_seq", lastSeq))
          val state = result.optJSONObject("call")?.optString("state").orEmpty()
          if (state in listOf("ended", "failed", "missed")) {
            val idToEnd = callId
            cleanupPeer()
            if (!idToEnd.isNullOrBlank()) ServerTelecomRegistry.markEnded(idToEnd)
            callId = null
            updateNotification("Server call ended", "The call is no longer active.", null, null)
            delay(2_000)
            finishService()
            break
          }
        } catch (cancelled: CancellationException) {
          throw cancelled
        } catch (error: Exception) {
          if (BuildConfig.DEBUG) recordStage("call_poll_retry")
          Log.w(TAG, "Server call polling failed: " + error.javaClass.simpleName)
        }
        delay(700)
      }
    }
  }

  private suspend fun handleSignal(signal: JSONObject) {
    when (signal.optString("kind")) {
      "offer" -> {
        if (peer == null) preparePeer(callIceServers)
        setRemoteDescription(signal.optJSONObject("payload") ?: JSONObject())
        pendingIce.toList().forEach { peer?.addIceCandidate(it) }
        pendingIce.clear()
        val answer = createLocalDescription(offer = false)
        val id = callId ?: return
        api("signal", JSONObject().put("call_id", id).put("kind", "answer").put("payload", answer))
        updateNotification("Server call connecting", "Audio answer sent. Establishing the connection.", null, null)
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
        cleanupPeer()
        if (!id.isNullOrBlank()) ServerTelecomRegistry.markEnded(id)
        callId = null
        finishService()
      }
      "state" -> Unit
    }
  }

  private suspend fun preparePeer(serversJson: JSONArray) {
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      throw IllegalStateException("Microphone permission is required for Server calling.")
    }
    if (peer != null) cleanupPeer()
    val init = PeerConnectionFactory.InitializationOptions.builder(applicationContext).createInitializationOptions()
    PeerConnectionFactory.initialize(init)
    audioModule = JavaAudioDeviceModule.builder(applicationContext).createAudioDeviceModule()
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
    val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    audio.mode = AudioManager.MODE_IN_COMMUNICATION
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
    val refreshed = postFunction(
      "/functions/v1/server-auth",
      JSONObject().put("action", "refresh"),
      accessToken
    )
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

  private suspend fun postFunction(path: String, body: JSONObject, bearerToken: String?): JSONObject =
    withContext(Dispatchers.IO) {
      val connection = (URL(BuildConfig.SUPABASE_URL.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 15_000
        readTimeout = 20_000
        doOutput = true
        setRequestProperty("content-type", "application/json")
        setRequestProperty("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
        if (!bearerToken.isNullOrBlank()) setRequestProperty("authorization", "Bearer $bearerToken")
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

  private fun cleanupPeer() {
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
    try { (getSystemService(Context.AUDIO_SERVICE) as AudioManager).mode = AudioManager.MODE_NORMAL } catch (_: Exception) {}
  }

  private fun finishService() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE)
    else @Suppress("DEPRECATION") stopForeground(true)
    stopSelf()
  }

  private fun recordStage(stage: String) {
    if (!BuildConfig.DEBUG) return
    prefs.edit().putString("debug_last_telecom_stage", stage)
      .putLong("debug_last_telecom_stage_at", System.currentTimeMillis()).apply()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, "Server call activity", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Updates about active Server internet calls and invitations."
            setShowBadge(false)
          }
        )
      }
    }
  }

  private fun buildNotification(title: String, message: String?, invite: String?): Notification {
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.sym_action_call)
      .setContentTitle(title)
      .setContentText(message ?: "Server internet calling")
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
    if (!invite.isNullOrBlank() && !invitePhone.isNullOrBlank()) {
      val shareIntent = Intent(this, ServerGuestInviteActivity::class.java).apply {
        putExtra(ServerGuestInviteActivity.EXTRA_TEXT, invite)
        putExtra(ServerGuestInviteActivity.EXTRA_PHONE, invitePhone)
        putExtra(ServerGuestInviteActivity.EXTRA_CALL_ID, callId)
      }
      val share = PendingIntent.getActivity(
        this, 7350 + (callId?.hashCode()?.and(0x0000FFFF) ?: 0), shareIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      builder.addAction(android.R.drawable.ic_menu_share, "Send invitation", share)
    }
    val id = callId
    if (!id.isNullOrBlank()) {
      val endIntent = Intent(this, ServerEndCallReceiver::class.java).apply {
        action = ACTION_END
        putExtra(EXTRA_CALL_ID, id)
      }
      val end = PendingIntent.getBroadcast(
        this, 7450 + (id.hashCode() and 0x0000FFFF), endIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "End call", end)
    }
    return builder.build()
  }

  private fun updateNotification(title: String, message: String, invite: String?, phone: String?) {
    inviteText = invite
    invitePhone = phone
    val notification = buildNotification(title, message, invite)
    (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIFICATION_ID, notification)
  }

  override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
    when (state) {
      PeerConnection.IceConnectionState.CONNECTED, PeerConnection.IceConnectionState.COMPLETED -> {
        val id = callId ?: return
        ServerTelecomRegistry.markConnected(id)
        updateNotification("Server call active", "Your Server internet call is connected.", null, null)
        if (activeStateSyncedFor != id) {
          activeStateSyncedFor = id
          scope.launch {
            try { api("set_active", JSONObject().put("call_id", id)) }
            catch (error: Exception) { Log.w(TAG, "Could not sync active Server call state: " + error.javaClass.simpleName) }
          }
        }
      }
      PeerConnection.IceConnectionState.FAILED -> {
        updateNotification("Server audio connection failed", "This network may require a TURN relay. No cellular call was placed.", null, null)
      }
      PeerConnection.IceConnectionState.DISCONNECTED -> {
        updateNotification("Server connection interrupted", "Trying to recover the internet audio connection.", null, null)
      }
      else -> Unit
    }
  }

  override fun onSignalingChange(state: PeerConnection.SignalingState) {}
  override fun onIceConnectionReceivingChange(receiving: Boolean) {}
  override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {}
  override fun onIceCandidate(candidate: IceCandidate) {
    scope.launch {
      val id = callId ?: return@launch
      try {
        api("signal", JSONObject().put("call_id", id).put("kind", "ice").put("payload", JSONObject()
          .put("candidate", candidate.sdp).put("sdpMid", candidate.sdpMid).put("sdpMLineIndex", candidate.sdpMLineIndex)))
      } catch (error: Exception) {
        Log.w(TAG, "Could not submit WebRTC ICE candidate: " + error.javaClass.simpleName)
      }
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

  override fun onDestroy() {
    operation?.cancel()
    cleanupPeer()
    scope.cancel()
    super.onDestroy()
  }

  companion object {
    private const val TAG = "ServerCallEngine"
    private const val CHANNEL_ID = "server-call-engine-v1"
    private const val NOTIFICATION_ID = 7340
    private const val ACTION_OUTGOING = "com.server.caller.action.ENGINE_OUTGOING"
    private const val ACTION_ANSWER = "com.server.caller.action.ENGINE_ANSWER"
    private const val ACTION_END = "com.server.caller.action.ENGINE_END"
    private const val EXTRA_TARGET = "server_engine_target"
    private const val EXTRA_CALL_ID = "server_call_id"

    private fun start(context: Context, intent: Intent) {
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
        else context.startService(intent)
      } catch (error: Exception) {
        Log.w(TAG, "Could not start the Telecom call engine: " + error.javaClass.simpleName)
      }
    }

    fun startOutgoing(context: Context, phone: String) {
      start(context, Intent(context, ServerCallEngineService::class.java)
        .setAction(ACTION_OUTGOING).putExtra(EXTRA_TARGET, phone))
    }

    fun startAnswer(context: Context, callId: String) {
      if (callId.isBlank()) return
      start(context, Intent(context, ServerCallEngineService::class.java)
        .setAction(ACTION_ANSWER).putExtra(EXTRA_CALL_ID, callId))
    }

    fun end(context: Context, callId: String) {
      if (callId.isBlank()) return
      start(context, Intent(context, ServerCallEngineService::class.java)
        .setAction(ACTION_END).putExtra(EXTRA_CALL_ID, callId))
    }
  }
}

class ServerGuestInviteActivity : android.app.Activity() {
  override fun onCreate(savedInstanceState: android.os.Bundle?) {
    super.onCreate(savedInstanceState)
    val text = intent.getStringExtra(EXTRA_TEXT).orEmpty()
    val phone = intent.getStringExtra(EXTRA_PHONE).orEmpty()
    if (text.isBlank()) {
      finish()
      return
    }
    val shareIntent = Intent(Intent.ACTION_SEND).apply {
      type = "text/plain"
      putExtra(Intent.EXTRA_TEXT, text)
    }
    val smsIntent = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:$phone")).apply {
      putExtra("sms_body", text)
    }
    val chooser = Intent.createChooser(shareIntent, "Send Server invitation").apply {
      putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(smsIntent))
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

class ServerEndCallReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val callId = intent?.getStringExtra("server_call_id").orEmpty()
    if (callId.isNotBlank()) ServerCallEngineService.end(context, callId)
  }
}
