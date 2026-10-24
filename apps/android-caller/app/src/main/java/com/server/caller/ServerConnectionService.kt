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

  fun handle(context: Context): PhoneAccountHandle = PhoneAccountHandle(
    ComponentName(context, ServerConnectionService::class.java), ACCOUNT_ID
  )

  fun register(context: Context): Boolean {
    val app = context.applicationContext
    val telecom = app.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
    val handle = handle(app)
    // Reuse the number Android exposed for the user-selected SIM as the calling
    // account address when available. This affects the account metadata shown by
    // the dialer; it does not provision or clone a carrier subscription.
    val observedNumber = app.getSharedPreferences("server-session", Context.MODE_PRIVATE)
      .getString("selected_sim_phone", "")
      .orEmpty()
      .filter { it.isDigit() || it == '+' }
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
    return telecom.getPhoneAccount(handle)?.isEnabled == true
  }

  fun isEnabled(context: Context): Boolean {
    val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
    return telecom.getPhoneAccount(handle(context))?.isEnabled == true
  }

  fun openApp(context: Context, extras: Bundle) {
    val intent = Intent(context, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      putExtras(extras)
    }
    context.startActivity(intent)
  }

  internal fun attach(connection: ServerTelecomConnection) { currentConnection = connection }
  fun markConnected() { currentConnection?.markConnected() }
  fun markEnded() { currentConnection?.markEnded(); currentConnection = null }

  fun reportIncoming(context: Context, callId: String, phone: String) {
    val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
    val extras = Bundle().apply {
      putParcelable(TelecomManager.EXTRA_INCOMING_CALL_ADDRESS, Uri.parse("tel:$phone"))
      putString("server_call_id", callId)
      putString("server_remote_phone", phone)
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
    val phone = extras.getString("server_remote_phone") ?: request.address?.schemeSpecificPart.orEmpty()
    val callId = extras.getString("server_call_id").orEmpty()
    return ServerTelecomConnection(this).apply {
      setAddress(request.address, TelecomManager.PRESENTATION_ALLOWED)
      setCallerDisplayName(if (phone.isBlank()) "Server caller" else phone, TelecomManager.PRESENTATION_ALLOWED)
      setAudioModeIsVoip(true)
      setExtras(Bundle().apply { putString("server_call_id", callId); putString("server_remote_phone", phone) })
      setRinging()
      ServerTelecomRegistry.attach(this)
      ServerTelecomRegistry.openApp(this@ServerConnectionService, Bundle().apply {
        putString("server_action", "incoming"); putString("server_call_id", callId); putString("server_remote_phone", phone)
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
      putString("server_remote_phone", address?.schemeSpecificPart.orEmpty())
    })
  }

  override fun onReject() {
    setDisconnected(DisconnectCause(DisconnectCause.REJECTED)); destroy()
    ServerTelecomRegistry.openApp(app, Bundle().apply {
      putString("server_action", "decline")
      putString("server_call_id", extras?.getString("server_call_id").orEmpty())
    })
  }

  override fun onDisconnect() {
    setDisconnected(DisconnectCause(DisconnectCause.LOCAL)); destroy()
    ServerTelecomRegistry.openApp(app, Bundle().apply {
      putString("server_action", "hangup")
      putString("server_call_id", extras?.getString("server_call_id").orEmpty())
    })
  }

  fun markConnected() { setActive() }
  fun markEnded() { setDisconnected(DisconnectCause(DisconnectCause.LOCAL)); destroy() }
}
