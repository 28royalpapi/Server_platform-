package com.server.gateway

import android.content.Context
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject
import java.io.Closeable
import java.security.MessageDigest
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Receives payload-free wake-up hints from Supabase Realtime.
 *
 * The public topic is derived from SHA-256(gateway bearer token). It contains
 * no SMS body or recipient details. Every wake-up is followed by the regular
 * authenticated server-gateway poll, which remains the only way to claim SMS.
 */
internal class ServerGatewayRealtimeClient(
  context: Context,
  private val onWake: () -> Unit,
  private val onState: (String) -> Unit
) : Closeable {
  private val appContext = context.applicationContext
  private val stopped = AtomicBoolean(false)
  private val reconnectScheduled = AtomicBoolean(false)
  private val refs = AtomicInteger(2)
  private val scheduler: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
  private val client = OkHttpClient.Builder()
    .pingInterval(30, TimeUnit.SECONDS)
    .retryOnConnectionFailure(true)
    .build()

  @Volatile private var socket: WebSocket? = null
  @Volatile private var heartbeatTask: ScheduledFuture<*>? = null
  @Volatile private var joinTopic = ""
  @Volatile private var reconnectAttempt = 0

  fun start() {
    connect()
  }

  private fun connect() {
    if (stopped.get()) return
    val base = SecureStore.getText(appContext, "url").trim().trimEnd('/')
    val key = SecureStore.getText(appContext, "key").trim()
    val gatewayToken = SecureStore.getSecret(appContext, "gateway_token").orEmpty()
    if (!base.startsWith("https://") || key.isBlank() || gatewayToken.length < 48) {
      onState("Realtime setup incomplete · fallback queue checks remain active")
      scheduleReconnect()
      return
    }

    val topicHash = sha256Hex(gatewayToken)
    joinTopic = "realtime:server-gateway-" + topicHash
    val requestUrl = try {
      (base + "/realtime/v1/websocket").toHttpUrl().newBuilder()
        .addQueryParameter("apikey", key)
        .addQueryParameter("vsn", "1.0.0")
        .build()
    } catch (_: Exception) {
      onState("Realtime URL invalid · fallback queue checks remain active")
      scheduleReconnect()
      return
    }

    onState("Connecting to Server Realtime…")
    client.newWebSocket(Request.Builder().url(requestUrl).build(), object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) {
        if (stopped.get()) {
          webSocket.close(1000, "Gateway stopped")
          return
        }
        socket = webSocket
        reconnectAttempt = 0
        reconnectScheduled.set(false)
        val config = JSONObject()
          .put("broadcast", JSONObject().put("ack", false).put("self", false))
          .put("presence", JSONObject().put("enabled", false))
          .put("private", false)
        val join = JSONObject()
          .put("topic", joinTopic)
          .put("event", "phx_join")
          .put("payload", JSONObject().put("config", config))
          .put("ref", "1")
          .put("join_ref", "1")
        if (!webSocket.send(join.toString())) {
          onState("Realtime join failed · reconnecting")
          webSocket.cancel()
          return
        }
        startHeartbeats(webSocket)
      }

      override fun onMessage(webSocket: WebSocket, text: String) {
        if (stopped.get()) return
        try {
          val frame = JSONObject(text)
          when (frame.optString("event")) {
            "phx_reply" -> {
              if (frame.optString("topic") == joinTopic) {
                val payload = frame.optJSONObject("payload")
                if (payload?.optString("status") == "ok") {
                  onState("Realtime connected · waiting for SMS jobs")
                  onWake() // close the race between the initial poll and channel join
                } else {
                  onState("Realtime subscription rejected · fallback queue checks remain active")
                  webSocket.cancel()
                }
              }
            }
            "broadcast" -> {
              val payload = frame.optJSONObject("payload")
              if (frame.optString("topic") == joinTopic &&
                  payload?.optString("event") == "gateway_wake") {
                onWake()
              }
            }
            "phx_error", "phx_close" -> {
              onState("Realtime connection interrupted · reconnecting")
              webSocket.cancel()
            }
          }
        } catch (_: Exception) {
          // Ignore malformed or unrelated frames; never interpret them as SMS jobs.
        }
      }

      override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
        webSocket.close(code, null)
      }

      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        clearSocket(webSocket)
        if (!stopped.get()) {
          onState("Realtime disconnected · fallback queue checks remain active")
          scheduleReconnect()
        }
      }

      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        clearSocket(webSocket)
        if (!stopped.get()) {
          onState("Realtime unavailable · fallback queue checks remain active")
          scheduleReconnect()
        }
      }
    })
  }

  private fun startHeartbeats(webSocket: WebSocket) {
    heartbeatTask?.cancel(true)
    heartbeatTask = scheduler.scheduleAtFixedRate({
      if (stopped.get() || socket !== webSocket) return@scheduleAtFixedRate
      val heartbeat = JSONObject()
        .put("topic", "phoenix")
        .put("event", "heartbeat")
        .put("payload", JSONObject())
        .put("ref", refs.getAndIncrement().toString())
      if (!webSocket.send(heartbeat.toString())) {
        webSocket.cancel()
      }
    }, 25, 25, TimeUnit.SECONDS)
  }

  private fun clearSocket(webSocket: WebSocket) {
    if (socket === webSocket) socket = null
    heartbeatTask?.cancel(true)
    heartbeatTask = null
  }

  private fun scheduleReconnect() {
    if (stopped.get() || !reconnectScheduled.compareAndSet(false, true)) return
    val attempt = reconnectAttempt.coerceAtMost(5)
    val delaySeconds = minOf(60L, 2L shl attempt)
    reconnectAttempt = (reconnectAttempt + 1).coerceAtMost(6)
    try {
      scheduler.schedule({
        reconnectScheduled.set(false)
        connect()
      }, delaySeconds, TimeUnit.SECONDS)
    } catch (_: Exception) {
      reconnectScheduled.set(false)
    }
  }

  override fun close() {
    if (!stopped.compareAndSet(false, true)) return
    heartbeatTask?.cancel(true)
    heartbeatTask = null
    socket?.close(1000, "Gateway stopped")
    socket = null
    scheduler.shutdownNow()
    client.dispatcher.executorService.shutdown()
    client.connectionPool.evictAll()
  }

  private fun sha256Hex(value: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
    return digest.joinToString("") { "%02x".format(it) }
  }
}
