package com.server.gateway

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.telephony.SmsManager
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class SmsGatewayService : Service() {
  private val executor = Executors.newSingleThreadExecutor()
  private val running = AtomicBoolean(false)
  @Volatile private var pollThread: Thread? = null

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopGateway(); stopSelf(); return START_NOT_STICKY
    }
    startForeground(NOTIFICATION_ID, notification("Starting secure gateway…"))
    if (running.compareAndSet(false, true)) {
      pollThread = Thread({ pollingLoop() }, "server-sms-gateway-poller").apply { isDaemon = true; start() }
    }
    return START_STICKY
  }

  private fun pollingLoop() {
    while (running.get()) {
      try {
        val response = MainActivity.postGateway(this, JSONObject().put("action", "poll"))
        val jobs = response.optJSONArray("jobs") ?: JSONArray()
        for (i in 0 until jobs.length()) {
          val job = jobs.optJSONObject(i) ?: continue
          sendJob(job)
        }
        updateNotification("Connected · ${jobs.length()} job(s) claimed · SIM gateway active")
      } catch (e: Exception) {
        updateNotification("Waiting for network · ${e.message?.take(70) ?: "connection unavailable"}")
      }
      try { Thread.sleep(POLL_INTERVAL_MS) } catch (_: InterruptedException) { break }
    }
  }

  private fun sendJob(job: JSONObject) {
    val jobId = job.optString("id")
    val phone = job.optString("recipient_e164")
    val message = job.optString("body")
    if (jobId.isBlank() || phone.isBlank() || message.isBlank()) return
    try {
      val sms = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) getSystemService(SmsManager::class.java) else SmsManager.getDefault()
      val parts = sms.divideMessage(message)
      val sentIntents = ArrayList<PendingIntent>()
      val deliveredIntents = ArrayList<PendingIntent>()
      for (index in parts.indices) {
        sentIntents.add(statusPendingIntent(jobId, "sent", index, parts.size))
        deliveredIntents.add(statusPendingIntent(jobId, "delivered", index, parts.size))
      }
      if (parts.size > 1) {
        sms.sendMultipartTextMessage(phone, null, parts, sentIntents, deliveredIntents)
      } else {
        sms.sendTextMessage(phone, null, message, sentIntents.first(), deliveredIntents.first())
      }
      updateNotification("Submitted SMS through SIM · ${phone.take(5)}…")
    } catch (_: Exception) {
      SmsStatusReceiver.reportFromWorker(this, jobId, "failed", "SMS_MANAGER_REJECTED")
    }
  }

  private fun statusPendingIntent(jobId: String, stage: String, part: Int, partCount: Int): PendingIntent {
    val intent = Intent(this, SmsStatusReceiver::class.java).apply {
      action = "com.server.gateway.${stage.uppercase()}.$jobId.$part"
      putExtra("job_id", jobId)
      putExtra("stage", stage)
      putExtra("part_index", part)
      putExtra("part_count", partCount)
    }
    val requestCode = (jobId.hashCode() * 31 + stage.hashCode() * 7 + part) and 0x7fffffff
    return PendingIntent.getBroadcast(this, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun notification(text: String): Notification = NotificationCompat.Builder(this, CHANNEL_ID)
    .setSmallIcon(android.R.drawable.stat_notify_sync)
    .setContentTitle("Server SIM Gateway")
    .setContentText(text)
    .setOngoing(true)
    .setOnlyAlertOnce(true)
    .setCategory(Notification.CATEGORY_SERVICE)
    .build()

  private fun updateNotification(text: String) {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(NOTIFICATION_ID, notification(text))
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, "Server SIM Gateway", NotificationManager.IMPORTANCE_LOW)
      (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
    }
  }

  private fun stopGateway() {
    running.set(false)
    pollThread?.interrupt()
    stopForeground(STOP_FOREGROUND_REMOVE)
  }

  override fun onDestroy() { stopGateway(); executor.shutdownNow(); super.onDestroy() }
  override fun onBind(intent: Intent?): IBinder? = null

  companion object {
    const val ACTION_START = "com.server.gateway.START"
    const val ACTION_STOP = "com.server.gateway.STOP"
    private const val CHANNEL_ID = "server-sim-gateway"
    private const val NOTIFICATION_ID = 4127
    private const val POLL_INTERVAL_MS = 12_000L
  }
}
