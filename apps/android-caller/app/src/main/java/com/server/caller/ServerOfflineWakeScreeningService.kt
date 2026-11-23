package com.server.caller

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.telecom.Call
import android.telecom.CallScreeningService

/**
 * Offline cellular wake receiver.
 *
 * Android invokes this service for incoming carrier calls after the user grants
 * Server the call-screening role. Caller identity is resolved only from the
 * locally cached, previously accepted contact feed. This service never calls
 * Supabase, FCM, Web Push, SMS, or any network API.
 *
 * IMPORTANT: this detects a cellular call; it does not create a free network
 * wake-up signal. The caller-side carrier trigger is a separate dependency.
 */
class ServerOfflineWakeScreeningService : CallScreeningService() {
  override fun onScreenCall(details: Call.Details) {
    val rawNumber = details.handle?.schemeSpecificPart.orEmpty()
    val e164 = ServerPhoneNumberNormalizer.toE164(rawNumber, ServerPhoneNumberNormalizer.deviceRegion(this))
    val caller = e164?.let { ServerOfflineCallerDirectory.find(this, it) }

    if (caller == null) {
      respondToCall(details, CallResponse.Builder().build())
      return
    }

    val notificationPosted = showWakeNotification(this, caller.displayName)
    // Silence only when Server successfully posts its own visible wake alert.
    // Never reject the cellular call: this is a wake-up event, not the WebRTC call.
    val response = CallResponse.Builder()
      .setSilenceCall(notificationPosted)
      .build()
    respondToCall(details, response)
  }

  private fun showWakeNotification(context: Context, callerName: String): Boolean {
    if (Build.VERSION.SDK_INT >= 33 &&
      context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
      android.content.pm.PackageManager.PERMISSION_GRANTED) return false

    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (!manager.areNotificationsEnabled()) return false

    if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(
        NotificationChannel(
          CHANNEL_ID,
          "Offline Server call alerts",
          NotificationManager.IMPORTANCE_HIGH
        ).apply {
          description = "Alerts from accepted Server contacts when mobile data is unavailable."
          setShowBadge(true)
          lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        }
      )
    }

    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return false
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    val pending = PendingIntent.getActivity(
      this, callerName.hashCode(),
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val notification = Notification.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.sym_call_incoming)
      .setContentTitle("Server: $callerName is trying to reach you")
      .setContentText("Turn on mobile data to continue the Server call.")
      .setCategory(Notification.CATEGORY_CALL)
      .setPriority(Notification.PRIORITY_HIGH)
      .setVisibility(Notification.VISIBILITY_PRIVATE)
      .setAutoCancel(true)
      .setContentIntent(pending)
      .build()
    manager.notify(NOTIFICATION_ID, notification)
    return true
  }

  companion object {
    private const val CHANNEL_ID = "server-offline-wake-v1"
    private const val NOTIFICATION_ID = 48271
  }
}
