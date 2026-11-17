package com.server.caller

import android.app.Activity
import android.content.Intent
import android.content.ActivityNotFoundException
import android.net.Uri
import android.os.Bundle
import android.util.Log

/**
 * Launched only after the caller taps the guest-invitation notification.
 * Prefills the recipient and invitation in Android's SMS composer. The user
 * must press Send; Server never sends this fallback SMS silently.
 * If no SMS app is available, the normal Android share chooser is offered.
 */
class ServerGuestInviteShareActivity : Activity() {
  companion object {
    internal fun createSmsComposeIntent(phone: String, invitation: String): Intent {
      require(phone.isNotBlank() && invitation.isNotBlank()) { "A recipient and secure invitation are required." }
      return Intent(Intent.ACTION_SENDTO, Uri.fromParts("smsto", phone, null)).apply {
        putExtra("sms_body", invitation)
      }
    }

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
      try {
        startActivity(createSmsComposeIntent(phone, invitation))
      } catch (_: ActivityNotFoundException) {
        startActivity(createShareChooserIntent(phone, invitation))
      }
    } catch (error: Exception) {
      Log.w("ServerGuestInvite", "Could not open the native invitation composer: " + error.javaClass.simpleName)
    } finally {
      finish()
    }
  }
}
