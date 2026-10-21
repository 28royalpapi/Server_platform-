package com.server.gateway

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import org.json.JSONObject
import java.util.concurrent.Executors

/** Aggregates multipart SMS callbacks and reports only network/SIM results, never the OTP text. */
class SmsStatusReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val pending = goAsync()
    val callbackResultCode = resultCode
    EXECUTOR.execute {
      try {
        val jobId = intent.getStringExtra("job_id") ?: return@execute
        val stage = intent.getStringExtra("stage") ?: return@execute
        val partCount = intent.getIntExtra("part_count", 1).coerceIn(1, 10)
        val ok = callbackResultCode == Activity.RESULT_OK
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val key = "sms_callback:${jobId}:$stage"
        val state = try { JSONObject(prefs.getString(key, "{}") ?: "{}") } catch (_: Exception) { JSONObject() }
        val seen = state.optInt("seen", 0) + 1
        val failed = state.optBoolean("failed", false) || !ok
        state.put("seen", seen).put("failed", failed).put("part_count", partCount)
        prefs.edit().putString(key, state.toString()).apply()

        if (seen >= partCount) {
          when (stage) {
            "sent" -> reportFromWorker(context, jobId, if (failed) "failed" else "sent", if (failed) "SMS_SEND_FAILED" else null)
            "delivered" -> if (!failed) reportFromWorker(context, jobId, "delivered", null)
          }
          prefs.edit().remove(key).apply()
        }
      } finally { pending.finish() }
    }
  }

  companion object {
    private const val PREFS = "server_gateway_prefs"
    private val EXECUTOR = Executors.newCachedThreadPool()

    fun reportFromWorker(context: Context, jobId: String, status: String, errorCode: String?) {
      EXECUTOR.execute {
        try {
          val payload = JSONObject().put("action", "complete").put("job_id", jobId).put("status", status)
          if (errorCode != null) payload.put("error_code", errorCode.take(64))
          MainActivity.postGateway(context, payload)
        } catch (_: Exception) {
          // Server-side lease expires; worker can retry if the device or network was interrupted.
        }
      }
    }
  }
}
