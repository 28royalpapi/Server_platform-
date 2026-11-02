package com.server.caller

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Person
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build

internal object ServerCallNotifications {
  const val CHANNEL_ID = "server-incoming-call-alerts-v1"
  const val ACTION_ANSWER = "com.server.caller.action.ANSWER_INCOMING"
  const val ACTION_DECLINE = "com.server.caller.action.DECLINE_INCOMING"
  const val EXTRA_CALL_ID = "server_call_id"

  fun notificationId(callId: String): Int = 7400 + (callId.hashCode() and 0x0000FFFF)

  fun show(context: Context, callId: String, callerIdentity: String, onlyAlertOnce: Boolean = false) {
    if (callId.isBlank()) return
    if (Build.VERSION.SDK_INT >= 33 &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return

    val app = context.applicationContext
    ensureChannel(app)
    val caller = callerIdentity.trim().take(80).ifBlank { "Server caller" }
    val answer = callAction(app, callId, ACTION_ANSWER, 1)
    val decline = callAction(app, callId, ACTION_DECLINE, 2)
    val builder = Notification.Builder(app, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.sym_call_incoming)
      .setContentTitle("Incoming Server call")
      .setContentText("$caller is calling you through Server")
      .setCategory(Notification.CATEGORY_CALL)
      .setPriority(Notification.PRIORITY_MAX)
      .setVisibility(Notification.VISIBILITY_PRIVATE)
      .setOngoing(true)
      .setAutoCancel(false)
      .setOnlyAlertOnce(onlyAlertOnce)
      .setTimeoutAfter(180_000L)

    if (Build.VERSION.SDK_INT >= 31) {
      val person = Person.Builder().setName(caller).setImportant(true).build()
      builder.setStyle(Notification.CallStyle.forIncomingCall(person, decline, answer))
    } else {
      builder.addAction(Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Decline", decline).build())
      builder.addAction(Notification.Action.Builder(android.R.drawable.sym_action_call, "Answer", answer).build())
      builder.setContentIntent(callAction(app, callId, ACTION_ANSWER, 3))
    }
    val manager = app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(notificationId(callId), builder.build())
  }

  fun buildMissedCallIntent(context: Context, callId: String, callerIdentity: String): Intent =
    Intent(context, MainActivity::class.java).apply {
      action = "com.server.caller.action.MISSED_CALLBACK"
      data = Uri.parse("server-missed://$callId")
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      putExtra("server_action", "missed_callback")
      putExtra("server_call_id", callId)
      putExtra("server_caller_id", callerIdentity.take(80))
    }

  fun cancel(context: Context, callId: String) {
    if (callId.isBlank()) return
    (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(notificationId(callId))
  }

  private fun callAction(context: Context, callId: String, action: String, actionCode: Int): PendingIntent {
    val intent = Intent(context, ServerCallActionReceiver::class.java).apply {
      this.action = action
      data = Uri.parse("server-call://$callId/$actionCode")
      putExtra(EXTRA_CALL_ID, callId)
    }
    return PendingIntent.getBroadcast(
      context, notificationId(callId) + actionCode, intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun ensureChannel(context: Context) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val attributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    val channel = NotificationChannel(CHANNEL_ID, "Incoming Server calls", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Incoming Server calls use your phone sound, vibration and Do Not Disturb settings."
      setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), attributes)
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 650, 250, 650)
      setShowBadge(false)
      lockscreenVisibility = Notification.VISIBILITY_PRIVATE
    }
    manager.createNotificationChannel(channel)
  }
}

class ServerCallActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val callId = intent?.getStringExtra(ServerCallNotifications.EXTRA_CALL_ID).orEmpty()
    if (callId.isBlank()) return
    when (intent?.action) {
      ServerCallNotifications.ACTION_ANSWER -> ServerTelecomRegistry.answerFromNotification(context, callId)
      ServerCallNotifications.ACTION_DECLINE -> ServerTelecomRegistry.declineFromNotification(context, callId)
    }
  }
}
