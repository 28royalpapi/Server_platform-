package com.server.caller

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * A no-install recipient cannot ring as a native Telecom call. This notification
 * gives the caller an explicit, user-initiated route to share the expiring browser
 * invitation. Server does not automatically send per-call SMS invitations.
 */
internal object ServerGuestInviteNotifications {
  private const val CHANNEL_ID = "server-guest-invites-v1"
  private const val REQUEST_BASE = 700_000
  const val EXTRA_CALL_ID = "server_guest_call_id"
  const val EXTRA_RECIPIENT_PHONE = "server_guest_recipient_phone"
  const val EXTRA_INVITATION_TEXT = "server_guest_invitation_text"

  fun notificationId(callId: String): Int = 700_000_000 + (callId.hashCode() and 0x0FFFFFFF)

  fun show(context: Context, callId: String, recipientPhone: String, invitationText: String): Boolean {
    if (callId.isBlank() || recipientPhone.isBlank() || invitationText.isBlank()) return false
    if (Build.VERSION.SDK_INT >= 33 &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      return false
    }
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    ensureChannel(manager)
    if (Build.VERSION.SDK_INT >= 26 &&
      manager.getNotificationChannel(CHANNEL_ID)?.importance == NotificationManager.IMPORTANCE_NONE) {
      return false
    }
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false

    val shareIntent = Intent(context, ServerGuestInviteShareActivity::class.java).apply {
      action = Intent.ACTION_VIEW
      data = Uri.parse("server-guest://share/$callId")
      putExtra(EXTRA_CALL_ID, callId)
      putExtra(EXTRA_RECIPIENT_PHONE, recipientPhone)
      putExtra(EXTRA_INVITATION_TEXT, invitationText)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    val sharePending = PendingIntent.getActivity(
      context,
      REQUEST_BASE + (callId.hashCode() and 0x0FFFFFFF),
      shareIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val masked = mask(recipientPhone)
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.sym_action_email)
      .setContentTitle("Server invitation ready")
      .setContentText("Share the secure browser invitation to connect over the internet.")
      .setStyle(NotificationCompat.BigTextStyle().bigText(
        "Share the Server call preview with $masked. The preview identifies who is calling; the recipient opens it, enables browser call alerts and taps Answer to connect over WebRTC using mobile data or Wi-Fi. Server never converts this guest call to a mobile-operator call."
      ))
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setAutoCancel(true)
      .setOngoing(false)
      .setTimeoutAfter(20 * 60 * 1000L)
      .setContentIntent(sharePending)
      .addAction(android.R.drawable.ic_menu_share, "Share invitation", sharePending)
      .build()
    return try {
      NotificationManagerCompat.from(context).notify(notificationId(callId), notification)
      true
    } catch (_: SecurityException) {
      false
    }
  }

  fun cancel(context: Context, callId: String) {
    if (callId.isBlank()) return
    NotificationManagerCompat.from(context).cancel(notificationId(callId))
  }

  private fun ensureChannel(manager: NotificationManager) {
    if (Build.VERSION.SDK_INT < 26 || manager.getNotificationChannel(CHANNEL_ID) != null) return
    manager.createNotificationChannel(NotificationChannel(
      CHANNEL_ID,
      "Server guest-call invitations",
      NotificationManager.IMPORTANCE_DEFAULT
    ).apply {
      description = "A reminder to share a secure browser invitation with someone who does not use Server."
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
      lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
    })
  }

  private fun mask(phone: String): String =
    if (phone.length < 6) phone else phone.take(4) + "•••" + phone.takeLast(2)
}
