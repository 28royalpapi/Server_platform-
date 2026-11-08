package com.server.caller

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.content.Intent
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
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RTCStatsCollectorCallback
import org.webrtc.RTCStatsReport
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
internal data class ServerCallTarget private constructor(
  val serverId: String?,
  val phoneNumber: String?
) {
  val isServerId: Boolean get() = serverId != null

  fun toStartPayload(source: String): JSONObject {
    val payload = JSONObject().put("source", source)
    if (serverId != null) payload.put("to_server_id", serverId)
    else payload.put("to_phone", phoneNumber.orEmpty())
    return payload
  }

  companion object {
    private val SERVER_ID = Regex("^SVR-[0-9A-F]{10}$")

    /** A Server ID is an identity, not a phone number; never pass it through E.164 normalisation. */
    fun parse(raw: String, normalizePhone: (String) -> String?): ServerCallTarget? {
      val candidate = raw.trim().uppercase()
      if (SERVER_ID.matches(candidate)) return ServerCallTarget(candidate, null)
      val phone = normalizePhone(raw) ?: return null
      return ServerCallTarget(null, phone)
    }
  }
}

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
  // Retain the E.164 destination for the later ICE callback, which can fail
  // after placeOutgoing has already returned.
  private var carrierFallbackPhone: String? = null
  private var activeStateSyncedFor: String? = null
  private var iceConnected = false
  private var remoteAudioTrackReady = false
  private var lastMediaSyncAttemptAt = 0L
  private var sentIceCandidates = 0
  private var receivedIceCandidates = 0
  private var rejectedIceCandidates = 0
  private var inboundAudioRtpPacketsReceived = 0L
  private var outboundAudioRtpPacketsSent = 0L
  private var inboundAudioRtpEnergy = 0.0
  private var outboundAudioRtpEnergy = 0.0
  private var lastAudioStatsCheckAt = 0L
  private var peer: PeerConnection? = null
  private var peerFactory: PeerConnectionFactory? = null
  private var audioSource: AudioSource? = null
  private var audioTrack: AudioTrack? = null
  private var audioModule: JavaAudioDeviceModule? = null
  private var iceServers = JSONArray()
  private var iceServerMode = "stun-only"
  private val pendingIce = mutableListOf<IceCandidate>()
  private var actionJob: Job? = null
  private var pollingJob: Job? = null
  private var disposed = false
  private var failCallStarted = false
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
    recordStage("call_engine_connection_started")
    if (BuildConfig.DEBUG) {
      prefs.edit().remove("debug_last_guest_invitation_text")
        .remove("debug_last_guest_call_id")
        .remove("debug_last_inbound_audio_rtp_packets")
        .remove("debug_last_outbound_audio_rtp_packets")
        .remove("debug_last_inbound_audio_rtp_energy")
        .remove("debug_last_outbound_audio_rtp_energy")
        .apply()
    }
    carrierFallbackPhone = null
    try {
      // Resolve the phone destination before testing the caller's data connection.
      // If Server cannot even start an internet attempt, Android can still open
      // the same destination through the user's preferred carrier SIM.
      val target = ServerCallTarget.parse(rawTarget) { value -> normalizePhone(value) }
        ?: throw IllegalStateException("The destination could not be resolved. Use a valid Server ID or an international telephone number. No carrier call was placed.")
      carrierFallbackPhone = target.phoneNumber
      val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      val capabilities = connectivity.activeNetwork?.let { connectivity.getNetworkCapabilities(it) }
      if (capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) != true) {
        failCall(
          "Server cannot reach the internet from this phone. Continuing through the selected SIM if automatic fallback is enabled.",
          carrierFallbackPhone,
          automaticCarrierFallback = true
        )
        return
      }
      if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        throw IllegalStateException("Microphone permission is missing for Server internet calling. You can use your selected SIM for a normal carrier call.")
      }
      if (BuildConfig.DEBUG) {
        prefs.edit()
          .putLong("debug_last_call_engine_entered_at", System.currentTimeMillis())
          .putString("debug_last_call_target_kind", if (target.isServerId) "server_id" else "phone")
          .putBoolean("debug_telecom_connection_engine_started", true)
          .apply()
      }
      recordStage("backend_start_requested")
      val started = api("start", target.toStartPayload("android_telecom"))
      callId = started.optString("call_id").takeIf { it.isNotBlank() }
        ?: throw IllegalStateException("Server did not return a call ID.")
      ServerTelecomRegistry.setCurrentCallId(callId)
      if (hangupRequested) {
        finishCall(callId.orEmpty(), "local")
        return
      }
      route = started.optString("route", "guest")
      val backendFallback = started.optJSONObject("carrier_fallback")
        ?.takeIf { it.optBoolean("available", false) }
        ?.optString("destination_e164")
        ?.takeIf { it.matches(Regex("^\\+[1-9][0-9]{7,14}$")) }
      if (backendFallback != null) carrierFallbackPhone = backendFallback
      // Availability is Server reachability, never a claim that a phone number's
      // mobile data is actually enabled or disabled.
      connection.setRingbackRequested(route == "server")
      if (route == "guest") {
        connection.updateServerStatus("Guest recipient not yet connected · preview link ready")
        if (carrierFallbackPhone != null && ServerFallbackSimManager.automaticFallbackEnabled(context)) {
          failCall("No Server receiver is registered for this number. Continuing through your selected SIM.", carrierFallbackPhone, automaticCarrierFallback = true)
          return
        }
      }
      lastSeq = 0
      iceServers = started.optJSONArray("ice_servers") ?: JSONArray()
      iceServerMode = started.optString("ice_server_mode", "stun-only")
      recordStage("backend_call_created")
      preparePeer(iceServers)
      if (hangupRequested) {
        finishCall(callId.orEmpty(), "local")
        return
      }
      val offer = createLocalDescription(offer = true)
      if (hangupRequested) {
        finishCall(callId.orEmpty(), "local")
        return
      }
      api("signal", JSONObject().put("call_id", callId).put("kind", "offer").put("payload", offer))
      if (hangupRequested) {
        finishCall(callId.orEmpty(), "local")
        return
      }
      recordStage("call_offer_submitted")
      if (route == "guest") {
        val invitation = started.optString("invitation_text").ifBlank {
          started.optString("sms_body")
        }
        if (invitation.isBlank()) throw IllegalStateException("Server did not return a secure guest invitation.")
        // Keep the invitation available to the debug-only virtual-device E2E
        // harness. The release build never writes this bearer token to local storage.
        if (BuildConfig.DEBUG) {
          prefs.edit()
            .putString("debug_last_guest_invitation_text", invitation)
            .putString("debug_last_guest_call_id", callId.orEmpty())
            .apply()
        }
        if (!ServerGuestInviteNotifications.show(context, callId.orEmpty(), target.phoneNumber.orEmpty(), invitation)) {
          throw IllegalStateException(
            started.optString("delivery_message").ifBlank {
              "Allow Server notifications so you can share the caller-identifying guest preview."
            }
          )
        }
        recordStage("guest_invitation_preview_share_ready")
        // The recipient answers on the secure browser page. Keep the Telecom call
        // and WebRTC offer alive while the browser joins; do not launch an Activity
        // over Android's Phone app from this background ConnectionService.
        beginPolling()
        return
      }
      if (route != "server") throw IllegalStateException("Server returned an unsupported call route.")
      val availability = started.optJSONObject("recipient_availability")?.optString("status").orEmpty()
      val queuedWake = started.optJSONObject("push_delivery")?.optBoolean("queued", false) ?: false
      val fallbackAvailable = started.optJSONObject("carrier_fallback")?.optBoolean("available", false) ?: false
      if (availability == "online") {
        connection.updateServerStatus("Available on Server · recent Internet connection · WebRTC")
        Log.i(TAG, "Recipient has a fresh Server presence heartbeat.")
      } else if (availability == "background_reachable" && queuedWake) {
        connection.updateServerStatus("Server background alert queued · ringing not confirmed")
        Log.i(TAG, "Recipient has a registered background endpoint; device delivery is not confirmed.")
      } else {
        connection.updateServerStatus(
          if (fallbackAvailable)
            "Not reachable on Server · mobile-data state unknown · selected SIM available"
          else
            "Not reachable on Server · mobile-data state unknown"
        )
        Log.w(TAG, "Recipient Server reachability was not confirmed; actual mobile-data state is unknown.")
      }
      beginPolling()
    } catch (error: Exception) {
      val apiError = error as? ServerCallApiException
      if (apiError?.httpStatus == 409 && apiError.errorCode == "RECIPIENT_OFFLINE" &&
          (!apiError.payload.optBoolean("call_created", true) || apiError.payload.optBoolean("missed_call_saved", false))) {
        val dialNumber = apiError.carrierFallback?.optString("destination_e164")
          ?.takeIf { it.matches(Regex("^\\+[1-9][0-9]{7,14}$")) }
        val message = apiError.payload.optString(
          "message",
          "This recipient is not currently reachable through Server. Their mobile-data state is unknown. You can use your selected SIM for an ordinary carrier call if you want to continue."
        )
        failCall(message, dialNumber, automaticCarrierFallback = true)
        return
      }
      val reason = error.message.orEmpty()
      val message = if (reason.contains("RECIPIENT_NOT_SERVER_ENABLED")) {
        "This number is not enabled for Server internet calls. Use your carrier SIM for a normal mobile call, or have the recipient enable Server number calling."
      } else reason.ifBlank { "Unknown call-start error" }
      failCall(message, carrierFallbackPhone, automaticCarrierFallback = false)
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
      iceServerMode = accepted.optString("ice_server_mode", "stun-only")
      preparePeer(iceServers)
      connection.markConnecting()
      if (hangupRequested) {
        finishCall(id, "local")
        return
      }
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
      if (target.isNotBlank()) ServerGuestInviteNotifications.cancel(context, target)
      // Telecom's onReject/onDisconnect already moved the native Connection to
      // DISCONNECTED. Only remote hangup and engine failures change its state here.
      cleanupPeer()
      release()
    }
  }

  private suspend fun failCall(
    message: String,
    carrierFallbackPhone: String? = null,
    automaticCarrierFallback: Boolean = false
  ) {
    if (disposed || failCallStarted) return
    failCallStarted = true
    recordStage("call_setup_failed")
    if (BuildConfig.DEBUG) prefs.edit().putString("debug_last_call_failure", message.take(240)).apply()
    val id = callId
    if (!id.isNullOrBlank()) {
      try { api("end", JSONObject().put("call_id", id)) } catch (_: Exception) {}
    }
    // End and release the Server/WebRTC leg before requesting a new cellular call.
    connection.markEnded()
    cleanupPeer()
    ServerCallNotifications.cancel(context, id.orEmpty())
    ServerGuestInviteNotifications.cancel(context, id.orEmpty())
    val carrierResult = if (automaticCarrierFallback) {
      carrierFallbackPhone?.let { ServerCarrierDialer.placeAutomatically(context, it) }
    } else null
    if (carrierResult == AutomaticCarrierFallbackResult.PLACED) {
      recordStage("automatic_carrier_fallback_requested")
      Log.i(TAG, "Server leg ended; Telecom accepted the selected-SIM carrier-call request.")
    } else {
      ServerCallEngineStatusNotifications.showFailure(context, message, carrierFallbackPhone)
    }
    release()
  }

  private fun beginPolling() {
    if (pollingJob?.isActive == true) return
    pollingJob = scope.launch {
      while (currentCoroutineContext().isActive && !disposed && !callId.isNullOrBlank()) {
        try {
          val id = callId ?: break
          if (iceConnected && remoteAudioTrackReady) refreshAudioStats()
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
              ServerGuestInviteNotifications.cancel(context, endedId)
              connection.markRemoteEnded()
              recordStage("remote_call_ended")
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
        applyPendingIceCandidates()
        val answer = createLocalDescription(offer = false)
        val id = callId ?: return
        api("signal", JSONObject().put("call_id", id).put("kind", "answer").put("payload", answer))
      }
      "answer" -> {
        setRemoteDescription(signal.optJSONObject("payload") ?: JSONObject())
        applyPendingIceCandidates()
      }
      "ice" -> {
        val payload = signal.optJSONObject("payload") ?: return
        val candidate = payload.optString("candidate")
        if (candidate.isNotBlank()) {
          val ice = IceCandidate(payload.optString("sdpMid"), payload.optInt("sdpMLineIndex"), candidate)
          if (peer?.remoteDescription != null) addRemoteIceCandidate(ice) else pendingIce.add(ice)
        }
      }
      "hangup" -> {
        val id = callId
        if (!id.isNullOrBlank()) {
          ServerCallNotifications.cancel(context, id)
          ServerGuestInviteNotifications.cancel(context, id)
          connection.markRemoteEnded()
          recordStage("remote_call_ended")
        }
        cleanupPeer()
        release()
      }
      "state" -> Unit
    }
  }

  private fun addRemoteIceCandidate(candidate: IceCandidate) {
    val accepted = peer?.addIceCandidate(candidate) == true
    if (accepted) {
      receivedIceCandidates += 1
      recordStage("remote_ice_candidate_added")
    } else {
      rejectedIceCandidates += 1
      Log.w(TAG, "WebRTC rejected a remote ICE candidate")
      recordStage("remote_ice_candidate_rejected")
    }
  }

  private fun applyPendingIceCandidates() {
    val queued = pendingIce.toList()
    pendingIce.clear()
    queued.forEach(::addRemoteIceCandidate)
  }

  private data class AudioRtpEvidence(
    val inboundPackets: Long,
    val outboundPackets: Long,
    val inboundEnergy: Double,
    val outboundEnergy: Double
  )

  /**
   * Audio readiness is directional. ICE connectivity or one inbound stream is
   * not proof that both microphones are transmitting. Require packet counters
   * and non-zero WebRTC audio-energy counters in both directions.
   */
  private suspend fun refreshAudioStats() {
    if (disposed || !iceConnected || !remoteAudioTrackReady) return
    if (inboundAudioRtpPacketsReceived > 0L && outboundAudioRtpPacketsSent > 0L &&
      inboundAudioRtpEnergy > 0.0 && outboundAudioRtpEnergy > 0.0) return
    val now = System.currentTimeMillis()
    if (now - lastAudioStatsCheckAt < 1200L) return
    lastAudioStatsCheckAt = now
    val activePeer = peer ?: return
    val evidence = withTimeoutOrNull(2500L) {
      suspendCancellableCoroutine<AudioRtpEvidence> { continuation ->
        try {
          activePeer.getStats(object : RTCStatsCollectorCallback {
            override fun onStatsDelivered(report: RTCStatsReport) {
              var inboundPackets = 0L
              var outboundPackets = 0L
              var inboundEnergy = 0.0
              var outboundEnergy = 0.0
              report.getStatsMap().values.forEach { stat ->
                val members = stat.getMembers()
                val isAudio = (members["kind"] ?: members["mediaType"])?.toString() == "audio"
                if (!isAudio) return@forEach
                when (stat.type) {
                  "inbound-rtp" -> {
                    inboundPackets += members["packetsReceived"]?.toString()?.toLongOrNull() ?: 0L
                    inboundEnergy += members["totalAudioEnergy"]?.toString()?.toDoubleOrNull() ?: 0.0
                  }
                  "outbound-rtp" -> {
                    outboundPackets += members["packetsSent"]?.toString()?.toLongOrNull() ?: 0L
                    outboundEnergy += members["totalAudioEnergy"]?.toString()?.toDoubleOrNull() ?: 0.0
                  }
                }
              }
              if (continuation.isActive) continuation.resume(
                AudioRtpEvidence(inboundPackets, outboundPackets, inboundEnergy, outboundEnergy)
              )
            }
          })
        } catch (error: Exception) {
          if (continuation.isActive) continuation.resumeWithException(error)
        }
      }
    } ?: AudioRtpEvidence(0L, 0L, 0.0, 0.0)

    inboundAudioRtpPacketsReceived = maxOf(inboundAudioRtpPacketsReceived, evidence.inboundPackets)
    outboundAudioRtpPacketsSent = maxOf(outboundAudioRtpPacketsSent, evidence.outboundPackets)
    inboundAudioRtpEnergy = maxOf(inboundAudioRtpEnergy, evidence.inboundEnergy)
    outboundAudioRtpEnergy = maxOf(outboundAudioRtpEnergy, evidence.outboundEnergy)
    if (BuildConfig.DEBUG) {
      prefs.edit()
        .putLong("debug_last_inbound_audio_rtp_packets", inboundAudioRtpPacketsReceived)
        .putLong("debug_last_outbound_audio_rtp_packets", outboundAudioRtpPacketsSent)
        .putString("debug_last_inbound_audio_rtp_energy", inboundAudioRtpEnergy.toString())
        .putString("debug_last_outbound_audio_rtp_energy", outboundAudioRtpEnergy.toString())
        .apply()
    }
    if (inboundAudioRtpPacketsReceived > 0L && outboundAudioRtpPacketsSent > 0L) {
      recordStage("audio_rtp_packets_both_directions")
    }
    syncMediaConnected()
  }

  private suspend fun syncMediaConnected() {
    if (disposed || !iceConnected || !remoteAudioTrackReady ||
      inboundAudioRtpPacketsReceived < 1L || outboundAudioRtpPacketsSent < 1L ||
      inboundAudioRtpEnergy <= 0.0 || outboundAudioRtpEnergy <= 0.0) return
    val id = callId ?: return
    connection.markConnected()
    if (activeStateSyncedFor == id) return
    val now = System.currentTimeMillis()
    if (now - lastMediaSyncAttemptAt < 5_000L) return
    lastMediaSyncAttemptAt = now
    try {
      api("set_active", JSONObject().put("call_id", id))
      activeStateSyncedFor = id
      recordStage("two_way_audio_media_ready")
    } catch (error: Exception) {
      val code = (error as? ServerCallApiException)?.errorCode ?: "STATE_SYNC_FAILED"
      Log.w(TAG, "Two-way audio connected but call-state sync failed: " + code)
      recordStage("media_state_sync_retry")
    }
  }

  private suspend fun preparePeer(serversJson: JSONArray) {
    iceConnected = false
    remoteAudioTrackReady = false
    lastMediaSyncAttemptAt = 0L
    activeStateSyncedFor = null
    inboundAudioRtpPacketsReceived = 0L
    outboundAudioRtpPacketsSent = 0L
    inboundAudioRtpEnergy = 0.0
    outboundAudioRtpEnergy = 0.0
    lastAudioStatsCheckAt = 0L
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
    if (servers.isEmpty()) {
      servers.add(PeerConnection.IceServer.builder("stun:stun.cloudflare.com:3478").createIceServer())
      servers.add(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer())
    }
    val config = PeerConnection.RTCConfiguration(servers).apply {
      sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
      // When TURN credentials are present, force the relayed path so carrier
      // NAT/firewall edge cases are exercised instead of silently preferring P2P.
      if (iceServerMode == "cloudflare-turn" || iceServerMode == "coturn-turn") {
        iceTransportsType = PeerConnection.IceTransportsType.RELAY
      }
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
    val session = withContext(Dispatchers.IO) {
      ServerDeviceSessionManager.ensureFresh(context, accessToken, accessExpiry, prefs)
    }
    accessToken = session.accessToken
    accessExpiry = session.expiresAtEpochSeconds
    if (session.serverId != null) prefs.edit().putString("server_id", session.serverId).apply()
  }

  private suspend fun api(action: String, payload: JSONObject = JSONObject()): JSONObject {
    ensureFreshSession()
    val requestBody = JSONObject(payload.toString()).put("action", action)
    return try {
      postFunction("/functions/v1/server-calls", requestBody, accessToken)
    } catch (error: ServerCallApiException) {
      if (error.httpStatus != 401) throw error
      // Retry a single auth rejection after refreshing or restoring this device's
      // own identity; do not retry rate limits, policy errors or server failures.
      val recovered = withContext(Dispatchers.IO) {
        ServerDeviceSessionManager.ensureFresh(context, accessToken, accessExpiry, prefs, forceRefresh = true)
      }
      accessToken = recovered.accessToken
      accessExpiry = recovered.expiresAtEpochSeconds
      if (recovered.serverId != null) prefs.edit().putString("server_id", recovered.serverId).apply()
      postFunction("/functions/v1/server-calls", requestBody, accessToken)
    }
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
          throw ServerCallApiException(status, result, reason)
        }
        result
      } finally {
        connection.disconnect()
      }
    }

  private fun normalizePhone(raw: String): String? =
    ServerPhoneNumberNormalizer.toE164FromDevice(context, raw)

  private fun recordStage(stage: String) {
    if (!BuildConfig.DEBUG) return
    prefs.edit().putString("debug_last_telecom_stage", stage)
      .putLong("debug_last_telecom_stage_at", System.currentTimeMillis()).apply()
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
    iceConnected = false
    remoteAudioTrackReady = false
    lastMediaSyncAttemptAt = 0L
    inboundAudioRtpPacketsReceived = 0L
    lastAudioStatsCheckAt = 0L
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
    // ICE connectivity alone is not a successful voice call. The remote audio
    // track must also arrive before Telecom and the backend report ACTIVE.
    scope.launch {
      if (disposed) return@launch
      when (state) {
        PeerConnection.IceConnectionState.CONNECTED, PeerConnection.IceConnectionState.COMPLETED -> {
          iceConnected = true
          recordStage("ice_transport_connected")
          refreshAudioStats()
        }
        PeerConnection.IceConnectionState.DISCONNECTED -> {
          iceConnected = false
          recordStage("ice_transport_disconnected")
        }
        PeerConnection.IceConnectionState.FAILED -> {
          iceConnected = false
          recordStage("ice_transport_failed")
          failCall(
            "Server could not establish a peer-to-peer ICE path on this network. Continuing through the selected SIM if automatic fallback is enabled.",
            carrierFallbackPhone,
            automaticCarrierFallback = true
          )
        }
        else -> Unit
      }
    }
  }

  override fun onIceCandidate(candidate: IceCandidate) {
    scope.launch {
      val id = callId ?: return@launch
      try {
        api("signal", JSONObject().put("call_id", id).put("kind", "ice").put("payload", JSONObject()
          .put("candidate", candidate.sdp).put("sdpMid", candidate.sdpMid).put("sdpMLineIndex", candidate.sdpMLineIndex)))
        sentIceCandidates += 1
      } catch (error: Exception) {
        val code = (error as? ServerCallApiException)?.errorCode ?: "ICE_SIGNAL_FAILED"
        Log.w(TAG, "Could not submit an ICE candidate: " + code)
        recordStage("ice_signal_failed")
      }
    }
  }

  override fun onAddTrack(receiver: RtpReceiver, mediaStreams: Array<out org.webrtc.MediaStream>) {
    val track = receiver.track() as? AudioTrack ?: return
    track.setEnabled(true)
    scope.launch {
      if (disposed) return@launch
      remoteAudioTrackReady = true
      recordStage("remote_audio_track_received")
      refreshAudioStats()
    }
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

internal object ServerCallEngineStatusNotifications {
  private const val CHANNEL = "server-call-status-v1"
  fun showFailure(context: Context, message: String, carrierFallbackPhone: String? = null) {
    if (Build.VERSION.SDK_INT >= 33 &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null) {
      manager.createNotificationChannel(NotificationChannel(
        CHANNEL, "Server call status", NotificationManager.IMPORTANCE_DEFAULT
      ))
    }
    val builder = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(android.R.drawable.sym_call_missed)
      .setContentTitle("Recipient not currently reachable on Server")
      .setContentText(message.take(180))
      .setStyle(NotificationCompat.BigTextStyle().bigText(message))
      .setAutoCancel(true)
    val dialIntent = carrierFallbackPhone?.let { ServerCarrierDialer.createIntent(context, it) }
    if (dialIntent != null) {
      val pending = PendingIntent.getActivity(
        context,
        8602 + (carrierFallbackPhone.hashCode() and 0x7FFF),
        dialIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      builder.addAction(android.R.drawable.sym_action_call, "Call using selected SIM", pending)
    }
    manager.notify(8601, builder.build())
  }
}
