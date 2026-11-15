package com.server.caller

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject
import java.util.concurrent.Executors

/** Reports carrier send/delivery outcomes without retaining or logging SMS bodies. */
internal class ServerSmsStatusReceiver : BroadcastReceiver() {
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
            "sent" -> report(context, jobId, if (failed) "failed" else "sent", if (failed) "SMS_SEND_FAILED" else null)
            "delivered" -> report(context, jobId, if (failed) "failed" else "delivered", if (failed) "SMS_DELIVERY_FAILED" else null)
          }
          prefs.edit().remove(key).apply()
        }
      } finally { pending.finish() }
    }
  }

  private fun report(context: Context, jobId: String, status: String, error: String?) {
    try {
      val payload = JSONObject().put("action", "complete").put("job_id", jobId).put("status", status)
      if (error != null) payload.put("error_code", error)
      ServerSmsGatewayApi.postGateway(context, payload)
    } catch (_: Exception) {
      // The server lease expires if delivery acknowledgement cannot reach the backend.
    }
  }

  companion object {
    fun reportFailure(context: Context, jobId: String, errorCode: String) {
      EXECUTOR.execute {
        try {
          val payload = JSONObject().put("action", "complete")
            .put("job_id", jobId).put("status", "failed")
            .put("error_code", errorCode.take(64))
          ServerSmsGatewayApi.postGateway(context, payload)
        } catch (_: Exception) {
          // The lease expiry provides server-side recovery if the acknowledgement is lost.
        }
      }
    }

    private const val PREFS = "server-session"
    // Multipart carrier callbacks for one message share a counter in preferences.\n    // Serialize all sent/delivered callbacks so simultaneous segments cannot lose increments.\n    private val EXECUTOR = Executors.newSingleThreadExecutor()
  }
}
