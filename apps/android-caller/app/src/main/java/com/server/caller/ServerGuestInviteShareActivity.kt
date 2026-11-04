package com.server.caller

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log

/**
 * Launched only after the caller taps the guest-invitation notification.
 * It opens Android's native share/SMS chooser; the caller must press Send.
 */
class ServerGuestInviteShareActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val callId = intent.getStringExtra(ServerGuestInviteNotifications.EXTRA_CALL_ID).orEmpty()
    val phone = intent.getStringExtra(ServerGuestInviteNotifications.EXTRA_RECIPIENT_PHONE).orEmpty()
    val invitation = intent.getStringExtra(ServerGuestInviteNotifications.EXTRA_INVITATION_TEXT).orEmpty()
    try {
      if (callId.isBlank() || phone.isBlank() || invitation.isBlank()) {
        throw IllegalArgumentException("The invitation is no longer available. Start a new Server call.")
      }
      val share = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, invitation)
      }
      val sms = Intent(Intent.ACTION_SENDTO, Uri.fromParts("smsto", phone, null)).apply {
        putExtra("sms_body", invitation)
      }
      startActivity(Intent.createChooser(share, "Share Server call invitation").apply {
        putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(sms))
      })
    } catch (error: Exception) {
      Log.w("ServerGuestInvite", "Could not open the native invitation chooser: " + error.javaClass.simpleName)
    } finally {
      finish()
    }
  }
}
