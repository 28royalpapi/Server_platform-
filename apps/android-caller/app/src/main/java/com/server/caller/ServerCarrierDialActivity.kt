package com.server.caller

import android.app.Activity
import android.os.Bundle
import android.widget.Toast

/**
 * Notification fallback action. If automatic carrier calling is enabled by
 * the user, continue through the selected SIM; otherwise open the normal dialler.
 */
class ServerCarrierDialActivity : Activity() {
  companion object {
    const val EXTRA_CALL_ID = "server_carrier_call_id"
    const val EXTRA_PHONE = "server_carrier_phone"
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val callId = intent.getStringExtra(EXTRA_CALL_ID).orEmpty()
    val phone = intent.getStringExtra(EXTRA_PHONE).orEmpty()

    if (callId.isNotBlank()) {
      ServerGuestInviteNotifications.cancel(this, callId)
      ServerTelecomRegistry.fallbackToCarrier(callId)
    }

    if (ServerFallbackSimManager.automaticFallbackEnabled(this) &&
      ServerCarrierDialer.placeAutomatically(this, phone) == AutomaticCarrierFallbackResult.PLACED) {
      finish()
      return
    }

    val dialIntent = ServerCarrierDialer.createIntent(this, phone)
    if (dialIntent == null) {
      Toast.makeText(this, "A valid phone number is required for a SIM call.", Toast.LENGTH_LONG).show()
      finish()
      return
    }

    try {
      startActivity(dialIntent)
    } catch (_: Exception) {
      Toast.makeText(this, "Android could not open the phone dialler.", Toast.LENGTH_LONG).show()
    } finally {
      finish()
    }
  }
}
