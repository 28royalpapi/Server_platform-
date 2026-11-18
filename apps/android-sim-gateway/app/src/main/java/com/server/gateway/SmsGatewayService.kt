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
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class SmsGatewayService : Service() {
  private val executor = Executors.newSingleThreadExecutor()
  private val timers = Executors.newScheduledThreadPool(2)
  private val running = AtomicBoolean(false)
  private val pollInProgress = AtomicBoolean(false)
  @Volatile private var realtimeClient: ServerGatewayRealtimeClient? = null

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopGateway()
      stopSelf()
      return START_NOT_STICKY
    }
    startForeground(NOTIFICATION_ID, notification("Starting secure gateway…"))
    if (running.compareAndSet(false, true)) {
      realtimeClient = ServerGatewayRealtimeClient(
        this,
        onWake = { pollQueue() },
        onState = { state -> updateNotification(state) }
      ).also { it.start() }

      // Always check once at startup, then immediately again after Realtime joins.
      pollQueue()

      // A short safety net ensures the 2-minute invitation isn't missed
      // when the Realtime WebSocket is temporarily unavailable.
      timers.scheduleAtFixedRate(
        { pollQueue() },
        FALLBACK_POLL_INTERVAL_SECONDS,
        FALLBACK_POLL_INTERVAL_SECONDS,
        TimeUnit.SECONDS
      )

      // Keep the device's server-side last_seen_at fresh so callers only choose
      // gateways which are demonstrably online. This is not a queue poll.
      timers.scheduleAtFixedRate(
        { refreshGatewayPresence() },
        PRESENCE_HEARTBEAT_SECONDS,
        PRESENCE_HEARTBEAT_SECONDS,
        TimeUnit.SECONDS
      )
    }
    return START_STICKY
  }

  private fun pollQueue() {
    if (!running.get() || !pollInProgress.compareAndSet(false, true)) return
    try {
      executor.execute {
        try {
          val response = MainActivity.postGateway(this, JSONObject().put("action", "poll"))
          val jobs = response.optJSONArray("jobs") ?: JSONArray()
          for (i in 0 until jobs.length()) {
            val job = jobs.optJSONObject(i) ?: continue
            sendJob(job)
          }
          if (jobs.length() > 0) {
            updateNotification("Processing ${jobs.length()} SMS job(s) · Server SIM active")
          } else {
            updateNotification("Realtime wake-up active · SIM gateway ready")
          }
        } catch (e: Exception) {
          updateNotification("Waiting for Server · ${e.message?.take(65) ?: "network unavailable"}")
        } finally {
          pollInProgress.set(false)
        }
      }
    } catch (_: Exception) {
      pollInProgress.set(false)
    }
  }

  private fun refreshGatewayPresence() {
    if (!running.get()) return
    try {
      executor.execute {
        if (!running.get()) return@execute
        try {
          MainActivity.postGateway(this, JSONObject().put("action", "health"))
        } catch (_: Exception) {
          updateNotification("Server heartbeat delayed · Realtime will reconnect")
        }
      }
    } catch (_: Exception) {
      // The service may be shutting down.
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
      updateNotification("SMS submitted to Android telephony service")
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
    realtimeClient?.close()
    realtimeClient = null
    timers.shutdownNow()
    executor.shutdownNow()
    stopForeground(STOP_FOREGROUND_REMOVE)
  }

  override fun onDestroy() {
    stopGateway()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  companion object {
    const val ACTION_START = "com.server.gateway.START"
    const val ACTION_STOP = "com.server.gateway.STOP"
    private const val CHANNEL_ID = "server-sim-gateway"
    private const val NOTIFICATION_ID = 4127
    private const val PRESENCE_HEARTBEAT_SECONDS = 60L
    private const val FALLBACK_POLL_INTERVAL_SECONDS = 15L
  }
}
