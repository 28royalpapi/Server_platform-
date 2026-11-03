package com.server.caller

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log

/**
 * Posts only a live Server internet-call alert.
 *
 * This service deliberately has a separate notification ID from the persistent,
 * low-importance incoming-call listener service. Android notification channels are
 * bound to a notification once posted; reusing the listener's ID can leave an
 * incoming CallStyle alert stuck on the listener's silent/low-importance channel.
 */
class ServerIncomingCallAlertService : Service() {
  private var activeCallId: String? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val callId = intent?.getStringExtra(EXTRA_CALL_ID).orEmpty()
    when (intent?.action) {
      ACTION_CLEAR -> {
        clearAlert(callId)
        return START_NOT_STICKY
      }
      ACTION_SHOW, ACTION_SILENCE -> {
        if (callId.isBlank() || !ServerCallNotifications.canPostNotifications(this)) {
          stopSelf(startId)
          return START_NOT_STICKY
        }

        val previousCallId = activeCallId
        if (previousCallId != null) {
          // Remove the previous foreground notification before publishing a new
          // notification on a different channel or for a different call.
          stopForeground(STOP_FOREGROUND_REMOVE)
          getSystemService(android.app.NotificationManager::class.java)
            .cancel(ServerCallNotifications.notificationId(previousCallId))
          activeCallId = null
        }

        val caller = intent.getStringExtra(EXTRA_CALLER_ID).orEmpty().ifBlank { "Server caller" }
        val silent = intent.action == ACTION_SILENCE
        val notification = ServerCallNotifications.buildIncomingNotification(this, callId, caller, silent)
        if (notification == null) {
          stopSelf(startId)
          return START_NOT_STICKY
        }

        activeCallId = callId
        try {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
              ServerCallNotifications.notificationId(callId),
              notification,
              ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
            )
          } else {
            startForeground(ServerCallNotifications.notificationId(callId), notification)
          }
        } catch (error: Exception) {
          Log.w(TAG, "Could not promote incoming Server call alert: " + error.javaClass.simpleName)
          activeCallId = null
          stopSelf(startId)
          return START_NOT_STICKY
        }
        return START_NOT_STICKY
      }
      else -> {
        stopSelf(startId)
        return START_NOT_STICKY
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    activeCallId?.let { callId ->
      try {
        getSystemService(android.app.NotificationManager::class.java)
          .cancel(ServerCallNotifications.notificationId(callId))
      } catch (_: Exception) {}
    }
    activeCallId = null
    super.onDestroy()
  }

  private fun clearAlert(callId: String) {
    if (callId.isBlank()) return
    val notificationId = ServerCallNotifications.notificationId(callId)
    if (activeCallId == callId) {
      activeCallId = null
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
    }
    getSystemService(android.app.NotificationManager::class.java).cancel(notificationId)
  }

  companion object {
    private const val TAG = "ServerCallAlert"
    private const val ACTION_SHOW = "com.server.caller.action.ALERT_SHOW_INCOMING"
    private const val ACTION_SILENCE = "com.server.caller.action.ALERT_SILENCE_INCOMING"
    private const val ACTION_CLEAR = "com.server.caller.action.ALERT_CLEAR_INCOMING"
    private const val EXTRA_CALL_ID = "server_call_id"
    private const val EXTRA_CALLER_ID = "server_caller_id"

    private fun dispatch(context: Context, action: String, callId: String, caller: String = "") {
      if (callId.isBlank() || !ServerCallNotifications.canPostNotifications(context)) return
      val serviceIntent = Intent(context, ServerIncomingCallAlertService::class.java).apply {
        this.action = action
        putExtra(EXTRA_CALL_ID, callId)
        if (caller.isNotBlank()) putExtra(EXTRA_CALLER_ID, caller.take(80))
      }
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(serviceIntent)
        else context.startService(serviceIntent)
      } catch (error: Exception) {
        Log.w(TAG, "Could not start incoming Server call alert: " + error.javaClass.simpleName)
      }
    }

    fun showIncomingCall(context: Context, callId: String, caller: String, silent: Boolean = false) {
      dispatch(context, if (silent) ACTION_SILENCE else ACTION_SHOW, callId, caller)
    }

    fun silenceIncomingCall(context: Context, callId: String, caller: String) {
      dispatch(context, ACTION_SILENCE, callId, caller)
    }

    fun clearIncomingCall(context: Context, callId: String) {
      if (callId.isBlank()) return
      // If no live alert service remains, still make sure the notification is cleared.
      try {
        val serviceIntent = Intent(context, ServerIncomingCallAlertService::class.java).apply {
          action = ACTION_CLEAR
          putExtra(EXTRA_CALL_ID, callId)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(serviceIntent)
        else context.startService(serviceIntent)
      } catch (_: Exception) {
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager)
          .cancel(ServerCallNotifications.notificationId(callId))
      }
    }
  }
}
