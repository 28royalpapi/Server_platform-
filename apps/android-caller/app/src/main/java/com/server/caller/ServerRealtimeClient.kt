package com.server.caller

import android.util.Log
import io.github.centrifugal.centrifuge.Client
import io.github.centrifugal.centrifuge.ConnectionTokenEvent
import io.github.centrifugal.centrifuge.ConnectionTokenGetter
import io.github.centrifugal.centrifuge.TokenCallback
import io.github.centrifugal.centrifuge.ConnectedEvent
import io.github.centrifugal.centrifuge.DisconnectedEvent
import io.github.centrifugal.centrifuge.ErrorEvent
import io.github.centrifugal.centrifuge.EventListener
import io.github.centrifugal.centrifuge.Options
import io.github.centrifugal.centrifuge.ServerPublicationEvent
import org.json.JSONObject
import java.nio.charset.StandardCharsets

/**
 * Thin native wrapper around the official Centrifugo Java SDK.
 *
 * The backend supplies a short-lived JWT containing only server-side
 * subscriptions the signed-in user is authorized to receive. The client never
 * receives the Centrifugo HTTP API key or token HMAC secret.
 */
internal class ServerRealtimeClient(
  endpoint: String,
  token: String,
  private val onPublication: (JSONObject) -> Unit,
  private val onConnectionChanged: (Boolean) -> Unit,
  private val fetchFreshToken: () -> String
) {
  private val client: Client

  init {
    require(endpoint.startsWith("wss://") || endpoint.startsWith("ws://")) {
      "Realtime endpoint must use ws:// or wss://."
    }
    val options = Options().apply {
      setToken(token)
      setName("server-android")
      setVersion(BuildConfig.VERSION_NAME)
      setTimeout(8_000)
      setMinReconnectDelay(500)
      setMaxReconnectDelay(15_000)
      setTokenGetter(object : ConnectionTokenGetter() {
        override fun getConnectionToken(event: ConnectionTokenEvent, cb: TokenCallback) {
          try {
            cb.Done(null, fetchFreshToken())
          } catch (error: Exception) {
            cb.Done(error, "")
          }
        }
      })
    }
    client = Client(endpoint, options, object : EventListener() {
      override fun onConnected(client: Client, event: ConnectedEvent) {
        onConnectionChanged(true)
      }

      override fun onDisconnected(client: Client, event: DisconnectedEvent) {
        onConnectionChanged(false)
      }

      override fun onPublication(client: Client, event: ServerPublicationEvent) {
        try {
          val json = JSONObject(String(event.data ?: byteArrayOf(), StandardCharsets.UTF_8))
          onPublication(json)
        } catch (error: Exception) {
          Log.w(TAG, "Discarded malformed realtime publication: ${error.javaClass.simpleName}")
        }
      }

      override fun onError(client: Client, event: ErrorEvent) {
        Log.w(TAG, "Realtime SDK error: ${event.javaClass.simpleName}")
      }
    })
  }

  fun connect() {
    client.connect()
  }

  fun close() {
    // Client.close(0) shuts down the SDK executor without waiting for the peer's
    // close frame. It is intentionally not called from a network callback.
    try {
      client.close(0)
    } catch (error: Exception) {
      Log.w(TAG, "Realtime client close failed: ${error.javaClass.simpleName}")
    }
  }

  private companion object {
    const val TAG = "ServerRealtime"
  }
}
