package com.server.caller

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** SMS transport for a Server-operated gateway handset. Never run on customer devices. */
class ServerSmsGatewayService : Service() {
  private val executor = Executors.newSingleThreadExecutor()
  private val timers = Executors.newScheduledThreadPool(2)
  private val running = AtomicBoolean(false)
  private val pollInProgress = AtomicBoolean(false)
  @Volatile private var realtimeClient: ServerSmsGatewayRealtimeClient? = null

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
    startForeground(NOTIFICATION_ID, notification("Connecting Server SMS gateway…"))
    if (checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
      updateNotification("SMS permission is off · open Server to reconnect")
      stopSelf()
      return START_NOT_STICKY
    }
    if (ServerSmsGatewayManager.resolve(this, ServerSmsGatewaySecureStore.subscriptionId(this)) == null) {
      updateNotification("Server gateway SMS subscription is unavailable")
      stopSelf()
      return START_NOT_STICKY
    }
    if (running.compareAndSet(false, true)) {
      realtimeClient = ServerSmsGatewayRealtimeClient(
        this,
        onWake = { pollQueue() },
        onState = { state -> updateNotification(state) }
      ).also { it.start() }
      pollQueue()
      timers.scheduleAtFixedRate({ pollQueue() }, FALLBACK_POLL_INTERVAL_SECONDS, FALLBACK_POLL_INTERVAL_SECONDS, TimeUnit.SECONDS)
      timers.scheduleAtFixedRate({ refreshGatewayPresence() }, PRESENCE_HEARTBEAT_SECONDS, PRESENCE_HEARTBEAT_SECONDS, TimeUnit.SECONDS)
    }
    return START_STICKY
  }

  private fun pollQueue() {
    if (!running.get() || !pollInProgress.compareAndSet(false, true)) return
    try {
      executor.execute {
        try {
          var claimedCount: Int
          do {
            val response = ServerSmsGatewayApi.postGateway(this, JSONObject().put("action", "poll"))
            val jobs = response.optJSONArray("jobs") ?: JSONArray()
            claimedCount = jobs.length()
            for (i in 0 until jobs.length()) sendJob(jobs.optJSONObject(i) ?: continue)
            updateNotification(if (claimedCount > 0) "Sending ${claimedCount} SMS message(s)" else "Connected · Server SMS gateway ready")
          } while (claimedCount == MAX_SMS_BATCH_SIZE && running.get())
        } catch (e: Exception) {
          if (e.message.orEmpty().contains("PLATFORM_GATEWAY_ONLY")) {
            updateNotification("This handset is not a Server-operated SMS gateway. Sending stopped.")
            running.set(false)
            stopForeground(true)
            stopSelf()
            return@execute
          }
          updateNotification("Waiting for Server · ${safeStatus(e)}")
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
        try { ServerSmsGatewayApi.postGateway(this, JSONObject().put("action", "health")) }
        catch (_: Exception) { updateNotification("Server connection delayed · reconnecting") }
      }
    } catch (_: Exception) {}
  }

  private fun sendJob(job: JSONObject) {
    val jobId = job.optString("id")
    val recipient = job.optString("recipient_e164")
    val message = job.optString("body")
    if (jobId.isBlank() || recipient.isBlank() || message.isBlank()) return
    try {
      val subId = ServerSmsGatewaySecureStore.subscriptionId(this)
      if (ServerSmsGatewayManager.resolve(this, subId) == null) {
        ServerSmsStatusReceiver.reportFailure(this, jobId, "SERVER_GATEWAY_SMS_SUBSCRIPTION_UNAVAILABLE")
        return
      }
      val sms = smsManagerForSubscription(subId)
      val parts = sms.divideMessage(message)
      val sentIntents = ArrayList<PendingIntent>()
      val deliveredIntents = ArrayList<PendingIntent>()
      for (index in parts.indices) {
        sentIntents.add(statusPendingIntent(jobId, "sent", index, parts.size))
        deliveredIntents.add(statusPendingIntent(jobId, "delivered", index, parts.size))
      }
      if (parts.size > 1) {
        sms.sendMultipartTextMessage(recipient, null, parts, sentIntents, deliveredIntents)
      } else {
        sms.sendTextMessage(recipient, null, message, sentIntents.first(), deliveredIntents.first())
      }
    } catch (_: SecurityException) {
      ServerSmsStatusReceiver.reportFailure(this, jobId, "SMS_PERMISSION_REVOKED")
    } catch (_: Exception) {
      ServerSmsStatusReceiver.reportFailure(this, jobId, "SMS_MANAGER_REJECTED")
    }
  }

  @Suppress("DEPRECATION")
  private fun smsManagerForSubscription(subscriptionId: Int): SmsManager {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      requireNotNull(getSystemService(SmsManager::class.java)).createForSubscriptionId(subscriptionId)
    } else {
      SmsManager.getSmsManagerForSubscriptionId(subscriptionId)
    }
  }

  private fun statusPendingIntent(jobId: String, stage: String, part: Int, partCount: Int): PendingIntent {
    val intent = Intent(this, ServerSmsStatusReceiver::class.java).apply {
      action = "com.server.caller.sms.${stage}.${jobId}.${part}"
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
    .setContentTitle("Server SMS gateway")
    .setContentText(text)
    .setOngoing(true)
    .setOnlyAlertOnce(true)
    .setCategory(Notification.CATEGORY_SERVICE)
    .build()

  private fun updateNotification(text: String) {
    try { (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIFICATION_ID, notification(text)) }
    catch (_: Exception) {}
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, "Server SMS gateway", NotificationManager.IMPORTANCE_LOW)
      (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
    }
  }

  private fun stopGateway() {
    running.set(false)
    realtimeClient?.close()
    realtimeClient = null
    timers.shutdownNow()
    executor.shutdownNow()
    try { stopForeground(true) } catch (_: Exception) {}
  }

  override fun onDestroy() {
    stopGateway()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun safeStatus(error: Exception): String {
    val code = error.message?.takeIf { it.matches(Regex("^[A-Z0-9_]{3,64}$")) }
    return code ?: "network unavailable"
  }

  companion object {
    const val ACTION_START = "com.server.caller.sms_gateway.START"
    const val ACTION_STOP = "com.server.caller.sms_gateway.STOP"
    private const val CHANNEL_ID = "server-sms-gateway"
    private const val NOTIFICATION_ID = 4137
    private const val MAX_SMS_BATCH_SIZE = 50
    private const val PRESENCE_HEARTBEAT_SECONDS = 45L
    private const val FALLBACK_POLL_INTERVAL_SECONDS = 15L
  }
}
