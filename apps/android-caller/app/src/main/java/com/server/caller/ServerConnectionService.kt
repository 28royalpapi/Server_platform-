package com.server.caller

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.telecom.Connection
import android.telecom.ConnectionRequest
import android.telecom.ConnectionService
import android.telecom.DisconnectCause
import android.telecom.PhoneAccount
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager

/** Registers Server as a Telecom calling account, never as a SIM/eSIM subscription. */
object ServerTelecomRegistry {
  private const val ACCOUNT_ID = "server-internet-calling"
  @Volatile private var currentConnection: ServerTelecomConnection? = null
  @Volatile private var currentConnectionCallId: String? = null
  private val incomingConnections = java.util.concurrent.ConcurrentHashMap<String, ServerTelecomConnection>()

  fun handle(context: Context): PhoneAccountHandle = PhoneAccountHandle(
    ComponentName(context, ServerConnectionService::class.java), ACCOUNT_ID
  )

  fun register(context: Context): Boolean {
    val app = context.applicationContext
    val telecom = app.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
    val handle = handle(app)
    // A phone number is attached only after the user explicitly verifies and
    // links it. Server ID calling works independently of SIM metadata.
    val sessionPrefs = app.getSharedPreferences("server-session", Context.MODE_PRIVATE)
    val linkedPhone = if (
      sessionPrefs.getBoolean("server_phone_number_linked", false) &&
      sessionPrefs.getBoolean("allow_number_based_server_calls", false)
    ) {
      sessionPrefs.getString("server_linked_phone", "").orEmpty()
    } else ""
    val observedNumber = linkedPhone.filter { it.isDigit() || it == '+' }
    val accountBuilder = PhoneAccount.builder(handle, "Server")
      .setCapabilities(PhoneAccount.CAPABILITY_CALL_PROVIDER)
      // Tell Telecom explicitly that Server handles telephone-number URIs. This is
      // an internet-calling account; it must never be registered as a cellular SIM.
      .setSupportedUriSchemes(listOf(PhoneAccount.SCHEME_TEL))
      .setShortDescription("Server internet calling account; not a cellular SIM")
    if (observedNumber.isNotBlank()) {
      accountBuilder.setAddress(Uri.parse("tel:$observedNumber"))
    }
    val account = accountBuilder.build()
    telecom.registerPhoneAccount(account)
    // Account registration should survive a later revocation of phone-number metadata permission.
    return try { telecom.getPhoneAccount(handle)?.isEnabled == true }
    catch (_: SecurityException) { false }
  }

  fun isEnabled(context: Context): Boolean {
    val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
    return try { telecom.getPhoneAccount(handle(context))?.isEnabled == true }
    catch (_: SecurityException) { false }
  }

  fun openApp(context: Context, extras: Bundle) {
    val intent = Intent(context, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      putExtras(extras)
    }
    context.startActivity(intent)
  }

  internal fun attach(connection: ServerTelecomConnection, callId: String? = null) {
    if (!callId.isNullOrBlank()) {
      incomingConnections[callId] = connection
    } else {
      currentConnection = connection
      currentConnectionCallId = null
    }
  }

  internal fun detach(connection: ServerTelecomConnection) {
    if (currentConnection === connection) {
      currentConnection = null
      currentConnectionCallId = null
    }
    incomingConnections.entries.removeIf { it.value === connection }
  }

  fun setCurrentCallId(callId: String?) {
    currentConnectionCallId = callId
  }

  fun markConnected(callId: String? = null) {
    if (!callId.isNullOrBlank()) {
      incomingConnections[callId]?.let { it.markConnected(); return }
      if (currentConnectionCallId != callId) return
    }
    currentConnection?.markConnected()
  }

  fun markEnded(callId: String? = null) {
    if (!callId.isNullOrBlank()) {
      incomingConnections.remove(callId)?.let { it.markEnded(); return }
      if (currentConnectionCallId != callId) return
    }
    val connection = currentConnection
    currentConnection = null
    currentConnectionCallId = null
    connection?.markEnded()
  }

  /**
   * A backend call that was ringing but disappears from the authoritative incoming
   * list has ended or was answered elsewhere. Clear only still-ringing Telecom
   * connections; an answered call must remain connected while media negotiation runs.
   */
  fun reconcileIncoming(liveCallIds: Set<String>) {
    incomingConnections.entries.toList().forEach { (callId, connection) ->
      if (callId !in liveCallIds &&
          connection.state == Connection.STATE_RINGING &&
          incomingConnections.remove(callId, connection)) {
        connection.markRemoteEnded()
      }
    }
  }

  fun reportIncoming(context: Context, callId: String, callerIdentity: String) {
    val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
    val extras = Bundle().apply {
      putString("server_call_id", callId)
      putString("server_caller_id", callerIdentity.take(80))
      // A Server ID is not a telephone number. Only attach a tel: address when
      // the backend supplied a valid E.164 number; never create tel:SVR-... URIs.
      if (callerIdentity.matches(Regex("^\\+[1-9][0-9]{7,14}$"))) {
        putParcelable(TelecomManager.EXTRA_INCOMING_CALL_ADDRESS, Uri.parse("tel:$callerIdentity"))
        putString("server_remote_phone", callerIdentity)
      }
    }
    telecom.addNewIncomingCall(handle(context), extras)
  }
}

class ServerConnectionService : ConnectionService() {
  override fun onCreateOutgoingConnection(connectionManagerPhoneAccount: PhoneAccountHandle, request: ConnectionRequest): Connection {
    val phone = request.address?.schemeSpecificPart.orEmpty()
    val connection = ServerTelecomConnection(this).apply {
      setAddress(request.address, TelecomManager.PRESENTATION_ALLOWED)
      setCallerDisplayName("Server internet call", TelecomManager.PRESENTATION_ALLOWED)
      setAudioModeIsVoip(true)
      setExtras(Bundle().apply { putString("server_remote_phone", phone) })
      setDialing()
    }
    ServerTelecomRegistry.attach(connection)
    ServerTelecomRegistry.openApp(this, Bundle().apply {
      putString("server_action", "dial"); putString("server_dialed_number", phone)
    })
    return connection
  }

  override fun onCreateIncomingConnection(connectionManagerPhoneAccount: PhoneAccountHandle, request: ConnectionRequest): Connection {
    val extras = request.extras ?: Bundle()
    val requestPhone = request.address?.schemeSpecificPart.orEmpty()
    val phone = (extras.getString("server_remote_phone") ?: requestPhone)
      .takeIf { it.matches(Regex("^\\+[1-9][0-9]{7,14}$")) }.orEmpty()
    val callerIdentity = extras.getString("server_caller_id").orEmpty()
      .ifBlank { phone.ifBlank { "Server caller" } }
    val callId = extras.getString("server_call_id").orEmpty()
    val address = phone.takeIf { it.isNotBlank() }?.let { Uri.parse("tel:$it") }
    return ServerTelecomConnection(this).apply {
      setAddress(address, if (address != null) TelecomManager.PRESENTATION_ALLOWED else TelecomManager.PRESENTATION_UNKNOWN)
      setCallerDisplayName(callerIdentity, TelecomManager.PRESENTATION_ALLOWED)
      setAudioModeIsVoip(true)
      setExtras(Bundle().apply {
        putString("server_call_id", callId)
        putString("server_caller_id", callerIdentity)
        if (phone.isNotBlank()) putString("server_remote_phone", phone)
      })
      setRinging()
      ServerTelecomRegistry.attach(this, callId)
      ServerTelecomRegistry.openApp(this@ServerConnectionService, Bundle().apply {
        putString("server_action", "incoming")
        putString("server_call_id", callId)
        putString("server_caller_id", callerIdentity)
        if (phone.isNotBlank()) putString("server_remote_phone", phone)
      })
    }
  }
}

internal class ServerTelecomConnection(context: Context) : Connection() {
  private val app = context.applicationContext

  override fun onAnswer() {
    super.onAnswer()
    setActive()
    ServerTelecomRegistry.openApp(app, Bundle().apply {
      putString("server_action", "answer")
      putString("server_call_id", extras?.getString("server_call_id").orEmpty())
      putString("server_caller_id", extras?.getString("server_caller_id").orEmpty())
      putString("server_remote_phone", address?.schemeSpecificPart.orEmpty())
    })
  }

  override fun onReject() {
    setDisconnected(DisconnectCause(DisconnectCause.REJECTED))
    ServerTelecomRegistry.detach(this)
    destroy()
    ServerTelecomRegistry.openApp(app, Bundle().apply {
      putString("server_action", "decline")
      putString("server_call_id", extras?.getString("server_call_id").orEmpty())
    })
  }

  override fun onDisconnect() {
    setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
    ServerTelecomRegistry.detach(this)
    destroy()
    ServerTelecomRegistry.openApp(app, Bundle().apply {
      putString("server_action", "hangup")
      putString("server_call_id", extras?.getString("server_call_id").orEmpty())
    })
  }

  fun markConnected() { setActive() }

  fun markEnded() {
    setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
    ServerTelecomRegistry.detach(this)
    destroy()
  }

  fun markRemoteEnded() {
    setDisconnected(DisconnectCause(DisconnectCause.REMOTE))
    ServerTelecomRegistry.detach(this)
    destroy()
  }
}
