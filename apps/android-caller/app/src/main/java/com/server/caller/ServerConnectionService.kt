package com.server.caller

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.telecom.Connection
import android.telecom.ConnectionRequest
import android.telecom.ConnectionService
import android.telecom.DisconnectCause
import android.telecom.PhoneAccount
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.telecom.StatusHints

/** Registers Server as a Telecom calling account, never as a SIM/eSIM subscription. */
object ServerTelecomRegistry {
  private const val ACCOUNT_ID = "server-internet-calling"
  @Volatile private var currentConnection: ServerTelecomConnection? = null
  @Volatile private var currentConnectionCallId: String? = null
  private val incomingConnections = java.util.concurrent.ConcurrentHashMap<String, ServerTelecomConnection>()

  fun handle(context: Context): PhoneAccountHandle = PhoneAccountHandle(
    ComponentName(context, ServerConnectionService::class.java), ACCOUNT_ID
  )

  internal fun buildPhoneAccount(context: Context): PhoneAccount {
    val app = context.applicationContext
    val handle = handle(app)
    // A phone number is attached only after the user explicitly verifies and
    // opts into number-based Server calls. Server ID calling never needs SIM metadata.
    val sessionPrefs = app.getSharedPreferences("server-session", Context.MODE_PRIVATE)
    val linkedPhone = if (
      sessionPrefs.getBoolean("server_phone_number_linked", false) &&
      sessionPrefs.getBoolean("allow_number_based_server_calls", false)
    ) {
      sessionPrefs.getString("server_linked_phone", "").orEmpty()
    } else ""
    val observedNumber = linkedPhone.filter { it.isDigit() || it == '+' }
    val accountLabel = if (BuildConfig.DEBUG) "Server Preview" else "Server"
    val shortDescription = if (BuildConfig.DEBUG) {
      "Server preview internet calling account; not a cellular SIM"
    } else {
      "Server internet calling account; not a cellular SIM"
    }
    val accountBuilder = PhoneAccount.builder(handle, accountLabel)
      .setCapabilities(PhoneAccount.CAPABILITY_CALL_PROVIDER)
      .setSupportedUriSchemes(listOf(PhoneAccount.SCHEME_TEL))
      .setShortDescription(shortDescription)
    if (observedNumber.isNotBlank()) {
      accountBuilder.setAddress(Uri.parse("tel:$observedNumber"))
    }
    return accountBuilder.build()
  }

  fun register(context: Context): Boolean {
    val app = context.applicationContext
    val telecom = app.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
    telecom.registerPhoneAccount(buildPhoneAccount(app))
    // getPhoneAccount() is protected by READ_PHONE_NUMBERS on modern Android.
    // The enabled account is instead discovered via the call-capable list, which
    // requires READ_PHONE_STATE and contains only accounts the user enabled.
    return isEnabled(app)
  }

  /**
   * The enabled state is intentionally tri-state. Android protects the pre-API-35
   * account-list APIs with READ_PHONE_STATE/READ_PHONE_NUMBERS, which Server does
   * not request because it does not inspect SIMs or carrier numbers. API 35+
   * exposes this app's own registered accounts without those permissions.
   */
  fun enabledState(context: Context): Boolean? {
    if (Build.VERSION.SDK_INT < 35) return null
    val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
    return try {
      telecom.registeredPhoneAccounts
        .firstOrNull { it.accountHandle == handle(context) }
        ?.isEnabled ?: false
    } catch (_: SecurityException) {
      null
    } catch (_: Exception) {
      null
    }
  }

  fun isEnabled(context: Context): Boolean = enabledState(context) == true

  /** Unknown on older Android means attempt Telecom and handle a rejected account safely. */
  fun canAttemptTelecom(context: Context): Boolean = enabledState(context) != false

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
    currentConnection?.setCallId(callId)
  }

  internal fun currentCallId(): String? = currentConnectionCallId

  fun markConnecting(callId: String) {
    incomingConnections[callId]?.markConnecting()
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

  /** End an unanswered/guest Server attempt before handing the same number to Android's SIM dialler. */
  fun fallbackToCarrier(callId: String) {
    if (callId.isBlank()) return
    val connection = incomingConnections.remove(callId)
      ?: currentConnection.takeIf { currentConnectionCallId == callId }
    connection?.fallbackToCarrier()
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

  internal fun incomingConnectionState(callId: String): Int? =
    incomingConnections[callId]?.state

  internal fun incomingCallerDisplayName(callId: String): String? =
    incomingConnections[callId]?.callerDisplayName

  fun answerFromNotification(context: Context, callId: String) {
    ServerCallNotifications.cancel(context, callId)
    val connection = incomingConnections[callId]
    if (connection != null) {
      connection.answerFromNotification()
    } else {
      // If the account is disabled (or Android cannot expose its state without
      // phone-state permission), answer in Server itself instead of re-reporting
      // an incoming call that Telecom may reject.
      openApp(context, Bundle().apply {
        putString("server_action", "answer")
        putString("server_call_id", callId)
      })
    }
  }

  fun declineFromNotification(context: Context, callId: String) {
    ServerCallNotifications.cancel(context, callId)
    val connection = incomingConnections[callId]
    if (connection != null) connection.declineFromNotification()
    else ServerIncomingCallService.endCall(context, callId)
  }

  fun reportIncoming(
    context: Context,
    callId: String,
    callerDisplayName: String,
    sharedCallerPhone: String? = null
  ) {
    val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
    val phonePattern = Regex("^\\+[1-9][0-9]{7,14}$")
    // Keep older internal callers compatible when they pass only a shared E.164 number.
    val callerPhone = sharedCallerPhone?.trim()?.takeIf { phonePattern.matches(it) }
      ?: if (sharedCallerPhone == null) callerDisplayName.trim().takeIf { phonePattern.matches(it) } else null
    val fallbackName = if (sharedCallerPhone == null && callerPhone != null) null else callerDisplayName
    val localName = if (callerPhone != null) {
      ServerCallerIdentityResolver.resolve(context, callerPhone, fallbackName)
    } else {
      ServerCallerIdentityResolver.chooseDisplayName(null, fallbackName, null)
    }
    val extras = Bundle().apply {
      putString("server_call_id", callId)
      putString("server_caller_id", localName.take(80))
      if (callerPhone != null) {
        putParcelable(TelecomManager.EXTRA_INCOMING_CALL_ADDRESS, Uri.parse("tel:$callerPhone"))
        putString("server_remote_phone", callerPhone)
      }
    }
    telecom.addNewIncomingCall(handle(context), extras)
  }
}

class ServerConnectionService : ConnectionService() {
  private val activeEngines = java.util.concurrent.ConcurrentHashMap.newKeySet<ServerTelecomCallEngine>()

  internal fun retainEngine(engine: ServerTelecomCallEngine) { activeEngines.add(engine) }
  internal fun releaseEngine(engine: ServerTelecomCallEngine) { activeEngines.remove(engine) }

  override fun onCreateOutgoingConnection(connectionManagerPhoneAccount: PhoneAccountHandle, request: ConnectionRequest): Connection {
    // OEM diallers may send a malformed or incomplete ConnectionRequest when
    // multiple SIM accounts and third-party call providers coexist. A provider
    // error must become a rejected call, never an uncaught system-service crash.
    return try {
      val phone = request.address?.schemeSpecificPart.orEmpty()
      val requestedAccount = request.accountHandle
      val serverAccountMatches = requestedAccount == ServerTelecomRegistry.handle(this)
      if (BuildConfig.DEBUG) {
        getSharedPreferences("server-session", Context.MODE_PRIVATE).edit()
          .putLong("debug_last_telecom_connection_service_entered_at", System.currentTimeMillis())
          .putString("debug_last_telecom_request_scheme", request.address?.scheme.orEmpty())
          .putInt("debug_last_telecom_request_target_length", phone.length)
          .putBoolean("debug_last_telecom_request_account_matches", serverAccountMatches)
          .putBoolean("debug_last_telecom_manager_account_present", connectionManagerPhoneAccount != null)
          .apply()
      }
      android.util.Log.i(
        "ServerTelecom",
        "Outgoing provider selected; accountMatches=$serverAccountMatches, managerAccountPresent=${connectionManagerPhoneAccount != null}, hasTelAddress=${request.address?.scheme == PhoneAccount.SCHEME_TEL}"
      )
      if (request.address?.scheme != PhoneAccount.SCHEME_TEL || phone.isBlank()) {
        android.util.Log.w("ServerTelecom", "Rejected outgoing request with a missing or unsupported telephone address.")
        Connection.createFailedConnection(DisconnectCause(DisconnectCause.ERROR))
      } else {
        val connection = ServerTelecomConnection(this).apply {
          setAddress(request.address, TelecomManager.PRESENTATION_ALLOWED)
          setCallerDisplayName("Server internet call", TelecomManager.PRESENTATION_ALLOWED)
          setAudioModeIsVoip(true)
          setExtras(Bundle().apply { putString("server_remote_phone", phone) })
          setDialing()
        }
        ServerTelecomRegistry.attach(connection)
        // Telecom owns the Connection for its lifetime. The WebRTC engine stays
        // bound to the ConnectionService and does not launch an Activity.
        val engine = ServerTelecomCallEngine(this, connection)
        connection.attachEngine(engine)
        retainEngine(engine)
        engine.startOutgoing(phone)
        connection
      }
    } catch (error: Exception) {
      android.util.Log.e(
        "ServerTelecom",
        "Could not initialise the selected Server calling account; rejecting this call without crashing the dialler.",
        error
      )
      Connection.createFailedConnection(DisconnectCause(DisconnectCause.ERROR))
    }
  }

  override fun onCreateOutgoingConnectionFailed(connectionManagerPhoneAccount: PhoneAccountHandle, request: ConnectionRequest) {
    super.onCreateOutgoingConnectionFailed(connectionManagerPhoneAccount, request)
    val preferences = getSharedPreferences("server-session", Context.MODE_PRIVATE)
    if (BuildConfig.DEBUG) {
      preferences.edit()
        .putLong("debug_last_telecom_outgoing_failed_at", System.currentTimeMillis())
        .putString("debug_last_telecom_outgoing_failed_scheme", request.address?.scheme.orEmpty())
        .putInt("debug_last_telecom_outgoing_failed_target_length", request.address?.schemeSpecificPart?.length ?: 0)
        .apply()
    }
    android.util.Log.e("ServerTelecom", "Android Telecom rejected the outgoing ConnectionService request before a call connection was created.")
  }

  override fun onCreateIncomingConnection(connectionManagerPhoneAccount: PhoneAccountHandle, request: ConnectionRequest): Connection {
    val extras = request.extras ?: Bundle()
    val requestPhone = request.address?.schemeSpecificPart.orEmpty()
    val phone = (extras.getString("server_remote_phone") ?: requestPhone)
      .takeIf { it.matches(Regex("^\\+[1-9][0-9]{7,14}$")) }.orEmpty()
    val callerFallback = extras.getString("server_caller_id").orEmpty()
    val callerIdentity = if (phone.isNotBlank()) {
      ServerCallerIdentityResolver.resolve(this, phone, callerFallback)
    } else {
      ServerCallerIdentityResolver.chooseDisplayName(null, callerFallback, null)
    }
    val callId = extras.getString("server_call_id").orEmpty()
    val address = phone.takeIf { it.isNotBlank() }?.let { Uri.parse("tel:$it") }
    return ServerTelecomConnection(this).apply {
      setAddress(address, if (address != null) TelecomManager.PRESENTATION_ALLOWED else TelecomManager.PRESENTATION_UNKNOWN)
      // Give Telecom and CallStyle the contact name saved by the recipient.
      // If the number is not saved, the resolver returns the actual E.164 number.
      setCallerDisplayName(callerIdentity, TelecomManager.PRESENTATION_ALLOWED)
      setAudioModeIsVoip(true)
      setExtras(Bundle().apply {
        putString("server_call_id", callId)
        putString("server_caller_id", callerIdentity)
        if (phone.isNotBlank()) putString("server_remote_phone", phone)
      })
      setRinging()
      ServerTelecomRegistry.attach(this, callId)
      val engine = ServerTelecomCallEngine(this@ServerConnectionService, this)
      attachEngine(engine)
      retainEngine(engine)
    }
  }
}

internal class ServerTelecomConnection(context: Context) : Connection() {
  private val app = context.applicationContext
  @Volatile private var callEngine: ServerTelecomCallEngine? = null

  internal fun attachEngine(engine: ServerTelecomCallEngine) { callEngine = engine }

  override fun onShowIncomingCallUi() {
    val callId = extras?.getString("server_call_id").orEmpty()
    val caller = extras?.getString("server_caller_id").orEmpty().ifBlank { "Server caller" }
    ServerCallNotifications.show(app, callId, caller)
  }

  override fun onSilence() {
    val callId = extras?.getString("server_call_id").orEmpty()
    val caller = extras?.getString("server_caller_id").orEmpty().ifBlank { "Server caller" }
    ServerCallNotifications.silence(app, callId, caller)
  }

  internal fun answerFromNotification() { onAnswer() }
  internal fun declineFromNotification() { onReject() }

  override fun onAnswer() {
    super.onAnswer()
    val id = extras?.getString("server_call_id").orEmpty()
    ServerCallNotifications.cancel(app, id)
    setInitializing()
    callEngine?.answerIncoming(id)
  }

  override fun onReject() {
    val id = extras?.getString("server_call_id").orEmpty()
    ServerCallNotifications.cancel(app, id)
    setDisconnected(DisconnectCause(DisconnectCause.REJECTED))
    ServerTelecomRegistry.detach(this)
    destroy()
    callEngine?.declineIncoming(id)
  }

  override fun onDisconnect() {
    setRingbackRequested(false)
    val id = extras?.getString("server_call_id").orEmpty().ifBlank { ServerTelecomRegistry.currentCallId().orEmpty() }
    ServerCallNotifications.cancel(app, id)
    setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
    ServerTelecomRegistry.detach(this)
    destroy()
    callEngine?.hangup()
  }

  internal fun fallbackToCarrier() {
    val id = extras?.getString("server_call_id").orEmpty()
    setRingbackRequested(false)
    ServerCallNotifications.cancel(app, id)
    setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
    ServerTelecomRegistry.detach(this)
    destroy()
    // Ask the Server engine to end the pending internet call and release WebRTC
    // before the carrier dialler is opened.
    callEngine?.hangup()
  }

  fun updateServerStatus(message: String) {
    // Status hints are best-effort; some OEM diallers display them and others
    // retain their standard UI. Never interpret this as raw mobile-data telemetry.
    setStatusHints(StatusHints(message.take(110), null, Bundle()))
  }

  fun markConnecting() { setInitializing() }

  fun setCallId(callId: String?) {
    if (callId.isNullOrBlank()) return
    val updated = Bundle(extras ?: Bundle()).apply { putString("server_call_id", callId) }
    setExtras(updated)
  }

  fun markConnected() { setRingbackRequested(false); setActive() }

  fun markEnded() {
    setRingbackRequested(false)
    ServerCallNotifications.cancel(app, extras?.getString("server_call_id").orEmpty())
    setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
    ServerTelecomRegistry.detach(this)
    destroy()
  }

  fun markRemoteEnded() {
    setRingbackRequested(false)
    ServerCallNotifications.cancel(app, extras?.getString("server_call_id").orEmpty())
    setDisconnected(DisconnectCause(DisconnectCause.REMOTE))
    ServerTelecomRegistry.detach(this)
    destroy()
  }
}
