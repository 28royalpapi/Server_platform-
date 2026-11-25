package com.server.caller

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

class ServerRosterRefreshWorker(
  context: Context,
  params: WorkerParameters
) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    val secret = ServerReceiverRoster.secret(applicationContext)
    if (secret.isBlank()) return Result.success()
    return try {
      ServerReceiverRoster.sync(applicationContext, secret)
      Result.success()
    } catch (_: Exception) {
      Result.retry()
    }
  }
}
