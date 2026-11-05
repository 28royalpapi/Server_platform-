package com.server.caller

import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * Opens Android's ordinary phone dialler for a caller-confirmed carrier attempt.
 * This deliberately uses ACTION_DIAL (never ACTION_CALL); Android shows the
 * available SIM accounts and the user must press Call.
 */
internal object ServerCarrierDialer {
  fun createIntent(rawNumber: String): Intent? {
    val number = rawNumber.trim()
    if (!number.matches(Regex("^\\+[1-9][0-9]{7,14}$"))) return null
    return Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", number, null))
  }

  fun open(context: Context, rawNumber: String): Boolean {
    val intent = createIntent(rawNumber) ?: return false
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return try {
      context.startActivity(intent)
      true
    } catch (_: Exception) {
      false
    }
  }
}
