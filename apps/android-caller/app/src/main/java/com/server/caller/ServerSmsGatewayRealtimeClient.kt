package com.server.caller

import android.content.Context
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

/** Payload-free wake-up channel. The durable SMS queue remains token-protected. */
internal class ServerSmsGatewayRealtimeClient(
  context: Context,
  private val onWake: () -> Unit,
  private val onState: (String) -> Unit
) : Closeable {
  private val appContext = context.applicationContext
  private val stopped = AtomicBoolean(false)
  private val reconnectScheduled = AtomicBoolean(false)
  private val refs = AtomicInteger(2)
  private val scheduler: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
  private val client = OkHttpClient.Builder().pingInterval(30, TimeUnit.SECONDS).retryOnConnectionFailure(true).build()

  @Volatile private var socket: WebSocket? = null
  @Volatile private var heartbeatTask: ScheduledFuture<*>? = null
  @Volatile private var joinTopic = ""
  @Volatile private var reconnectAttempt = 0

  fun start() = connect()

  private fun connect() {
    if (stopped.get()) return
    val base = BuildConfig.SUPABASE_URL.trimEnd('/')
    val key = BuildConfig.SUPABASE_PUBLISHABLE_KEY
    val gatewayToken = ServerSmsGatewaySecureStore.token(appContext).orEmpty()
    if (!base.startsWith("https://") || key.isBlank() || gatewayToken.length != 64) {
      onState("Gateway credentials unavailable")
      scheduleReconnect()
      return
    }
    joinTopic = "realtime:server-gateway-" + sha256Hex(gatewayToken)
    val requestUrl = try {
      (base + "/realtime/v1/websocket").toHttpUrl().newBuilder()
        .addQueryParameter("apikey", key)
        .addQueryParameter("vsn", "1.0.0")
        .build()
    } catch (_: Exception) {
      onState("Realtime setup unavailable")
      scheduleReconnect()
      return
    }

    client.newWebSocket(Request.Builder().url(requestUrl).build(), object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) {
        if (stopped.get()) { webSocket.close(1000, "Gateway stopped"); return }
        socket = webSocket
        reconnectAttempt = 0
        reconnectScheduled.set(false)
        val config = JSONObject()
          .put("broadcast", JSONObject().put("ack", false).put("self", true))
          .put("presence", JSONObject().put("enabled", false))
          .put("private", false)
        val join = JSONObject().put("topic", joinTopic).put("event", "phx_join")
          .put("payload", JSONObject().put("config", config))
          .put("ref", "1").put("join_ref", "1")
        if (!webSocket.send(join.toString())) webSocket.cancel() else startHeartbeats(webSocket)
      }

      override fun onMessage(webSocket: WebSocket, text: String) {
        if (stopped.get()) return
        try {
          val frame = JSONObject(text)
          when (frame.optString("event")) {
            "phx_reply" -> if (frame.optString("topic") == joinTopic) {
              val payload = frame.optJSONObject("payload")
              if (payload?.optString("status") == "ok") {
                onState("Connected · waiting for messages")
                onWake()
              } else {
                onState("Realtime subscription rejected · using secure fallback")
                webSocket.cancel()
              }
            }
            "broadcast" -> {
              val payload = frame.optJSONObject("payload")
              if (frame.optString("topic") == joinTopic && payload?.optString("event") == "gateway_wake") onWake()
            }
            "phx_error", "phx_close" -> webSocket.cancel()
          }
        } catch (_: Exception) {
          // Ignore unrelated frames.
        }
      }

      override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, null) }
      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        clearSocket(webSocket)
        if (!stopped.get()) { onState("Realtime reconnecting"); scheduleReconnect() }
      }
      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        clearSocket(webSocket)
        if (!stopped.get()) { onState("Realtime unavailable · queue checks remain active"); scheduleReconnect() }
      }
    })
  }

  private fun startHeartbeats(webSocket: WebSocket) {
    heartbeatTask?.cancel(true)
    heartbeatTask = scheduler.scheduleAtFixedRate({
      if (stopped.get() || socket !== webSocket) return@scheduleAtFixedRate
      val heartbeat = JSONObject().put("topic", "phoenix").put("event", "heartbeat")
        .put("payload", JSONObject()).put("ref", refs.getAndIncrement().toString())
      if (!webSocket.send(heartbeat.toString())) webSocket.cancel()
    }, 25, 25, TimeUnit.SECONDS)
  }

  private fun clearSocket(webSocket: WebSocket) {
    if (socket === webSocket) socket = null
    heartbeatTask?.cancel(true)
    heartbeatTask = null
  }

  private fun scheduleReconnect() {
    if (stopped.get() || !reconnectScheduled.compareAndSet(false, true)) return
    val delay = minOf(60L, 2L shl reconnectAttempt.coerceAtMost(5))
    reconnectAttempt = (reconnectAttempt + 1).coerceAtMost(6)
    try {
      scheduler.schedule({ reconnectScheduled.set(false); connect() }, delay, TimeUnit.SECONDS)
    } catch (_: Exception) { reconnectScheduled.set(false) }
  }

  override fun close() {
    if (!stopped.compareAndSet(false, true)) return
    heartbeatTask?.cancel(true)
    socket?.close(1000, "Gateway stopped")
    socket = null
    scheduler.shutdownNow()
    client.dispatcher.executorService.shutdown()
    client.connectionPool.evictAll()
  }

  private fun sha256Hex(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray(Charsets.UTF_8))
    .joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
}
