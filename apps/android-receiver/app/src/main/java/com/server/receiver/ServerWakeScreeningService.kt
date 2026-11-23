package com.server.receiver

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.telecom.Call
import android.telecom.CallScreeningService
import androidx.core.app.NotificationCompat

class ServerWakeScreeningService : CallScreeningService() {
  override fun onScreenCall(callDetails: Call.Details) {
    val isIncoming = callDetails.callDirection == Call.Details.DIRECTION_INCOMING
    val number = callDetails.handle?.schemeSpecificPart.orEmpty()
    val caller = if (isIncoming && WakeStore.isEnabled(this)) WakeStore.findCaller(this, number) else null

    if (caller == null) {
      respondToCall(callDetails, CallResponse.Builder()
        .setDisallowCall(false)
        .setRejectCall(false)
        .setSilenceCall(false)
        .build())
      return
    }

    // This cellular leg is only the wake signal. Reject it before it is answered;
    // the voice conversation remains on Server WebRTC after mobile data is enabled.
    showWakeNotification(caller)
    respondToCall(callDetails, CallResponse.Builder()
      .setDisallowCall(true)
      .setRejectCall(true)
      .setSkipNotification(true)
      .setSkipCallLog(false)
      .build())
  }

  private fun showWakeNotification(caller: OfflineWakeCaller) {
    val manager = getSystemService(NotificationManager::class.java)
    val channelId = "server_offline_wake"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(
          channelId,
          "Server offline call alerts",
          NotificationManager.IMPORTANCE_HIGH,
        ).apply {
          description = "Alerts when an accepted Server contact tries to reach this phone while it is offline."
          lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
          enableVibration(true)
          vibrationPattern = longArrayOf(0, 250, 120, 250)
        },
      )
    }
    val open = PendingIntent.getActivity(
      this,
      41,
      Intent(this, WakeActivity::class.java)
        .putExtra(WakeActivity.EXTRA_CALLER_NAME, caller.displayName)
        .putExtra(WakeActivity.EXTRA_CALLER_PHONE, caller.phoneE164)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = NotificationCompat.Builder(this, channelId)
      .setSmallIcon(android.R.drawable.sym_action_call)
      .setContentTitle(caller.displayName + " is trying to reach you on Server")
      .setContentText("Turn on mobile data to receive the internet call.")
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setAutoCancel(true)
      .setContentIntent(open)
      .build()
    manager.notify(("server-wake:" + caller.phoneE164).hashCode(), notification)
  }
}
