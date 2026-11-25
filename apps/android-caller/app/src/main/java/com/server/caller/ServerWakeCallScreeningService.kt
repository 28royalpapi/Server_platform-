package com.server.caller

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.telecom.Call
import android.telecom.CallScreeningService

class ServerWakeCallScreeningService : CallScreeningService() {
  override fun onScreenCall(callDetails: Call.Details) {
    if (callDetails.callDirection != Call.Details.DIRECTION_INCOMING) return

    val caller = ServerReceiverRoster.match(this, callDetails.handle?.schemeSpecificPart)
    if (caller == null) {
      allow(callDetails)
      return
    }

    // A recognised Server cellular leg is never the conversation. If internet
    // is already available, the normal Server WebRTC/browser push is the only
    // incoming-call UI; silently suppress this wake-up carrier leg.
    if (!ServerReceiverRoster.hasInternet(this)) {
      // This cellular leg is only a wake signal. Never expose it as an ordinary
      // carrier conversation or let it ring as a paid fallback. The notification
      // permission is part of the Receiver readiness gate; if the user revokes it
      // after setup, the leg is still suppressed rather than becoming a normal call.
      showWakeNotification(caller)
    }

    // Always end a recognised Server cellular leg. The actual voice conversation
    // is resumed over WebRTC after the recipient restores internet access.
    respondToCall(callDetails, CallResponse.Builder()
      .setDisallowCall(true)
      .setRejectCall(true)
      .build())
  }

  private fun allow(details: Call.Details) {
    respondToCall(details, CallResponse.Builder().setDisallowCall(false).build())
  }

  private fun showWakeNotification(caller: ServerCaller): Boolean {
    if (Build.VERSION.SDK_INT >= 33 &&
      checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      return false
    }
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(NotificationChannel(
        CHANNEL_ID, "Server offline wake-up", NotificationManager.IMPORTANCE_HIGH
      ).apply {
        description = "Alerts you when a Server caller reaches your phone while its internet is off."
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 350, 150, 350)
        lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
      })
    }
    val open = Intent(this, ServerReceiverSetupActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    val pending = PendingIntent.getActivity(
      this, 4107, open,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val notification = android.app.Notification.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.sym_call_missed)
      .setContentTitle("${caller.displayName} is trying to reach you")
      .setContentText("Turn on mobile data or Wi-Fi, then open Server to answer by internet voice.")
      .setCategory(android.app.Notification.CATEGORY_CALL)
      .setPriority(android.app.Notification.PRIORITY_HIGH)
      .setAutoCancel(true)
      .setContentIntent(pending)
      .build()
    return try {
      manager.notify((caller.serverId.hashCode() and 0x3fffffff) + 4100, notification)
      true
    } catch (_: SecurityException) {
      false
    }
  }

  companion object {
    private const val CHANNEL_ID = "server-offline-wakeup-v1"
  }
}
