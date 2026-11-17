package com.server.caller

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log

/**
 * Launched only after the caller taps the guest-invitation notification.
 * It opens Android's native app-share chooser; the caller chooses where to share.
 */
class ServerGuestInviteShareActivity : Activity() {
  companion object {
    internal fun createShareChooserIntent(phone: String, invitation: String): Intent {
      require(phone.isNotBlank() && invitation.isNotBlank()) { "A recipient and secure invitation are required." }
      val share = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, invitation)
      }
      return Intent.createChooser(share, "Share Server call preview")
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val callId = intent.getStringExtra(ServerGuestInviteNotifications.EXTRA_CALL_ID).orEmpty()
    val phone = intent.getStringExtra(ServerGuestInviteNotifications.EXTRA_RECIPIENT_PHONE).orEmpty()
    val invitation = intent.getStringExtra(ServerGuestInviteNotifications.EXTRA_INVITATION_TEXT).orEmpty()
    try {
      if (callId.isBlank() || phone.isBlank() || invitation.isBlank()) {
        throw IllegalArgumentException("The invitation is no longer available. Start a new Server call.")
      }
      ServerGuestInviteNotifications.cancel(this, callId)
      startActivity(createShareChooserIntent(phone, invitation))
    } catch (error: Exception) {
      Log.w("ServerGuestInvite", "Could not open the native invitation chooser: " + error.javaClass.simpleName)
    } finally {
      finish()
    }
  }
}
