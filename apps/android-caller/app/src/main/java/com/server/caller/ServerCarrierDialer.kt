package com.server.caller

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager

internal enum class AutomaticCarrierFallbackResult {
  PLACED, INVALID_NUMBER, NOT_OPTED_IN, CALL_PERMISSION_MISSING,
  SELECTED_SIM_UNAVAILABLE, TELECOM_REJECTED, FAILED
}

/** Places ordinary carrier calls through Android Telecom on the explicitly selected SIM. */
internal object ServerCarrierDialer {
  private val E164 = Regex("^\\\\+[1-9][0-9]{7,14}$")

  fun createIntent(rawNumber: String): Intent? {
    val number = rawNumber.trim()
    if (!E164.matches(number)) return null
    return Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", number, null))
  }

  fun createIntent(context: Context, rawNumber: String): Intent? {
    val intent = createIntent(rawNumber) ?: return null
    val selectedAccount = ServerFallbackSimManager.selectedPhoneAccount(context)
    if (selectedAccount != null) intent.putExtra(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, selectedAccount)
    return intent
  }

  fun buildPlaceCallExtras(selectedAccount: PhoneAccountHandle): Bundle =
    Bundle().apply { putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, selectedAccount) }

  fun placeAutomatically(context: Context, rawNumber: String): AutomaticCarrierFallbackResult {
    val number = rawNumber.trim()
    if (!E164.matches(number)) return AutomaticCarrierFallbackResult.INVALID_NUMBER
    if (!ServerFallbackSimManager.hasAutomaticFallbackConsent(context)) {
      return AutomaticCarrierFallbackResult.NOT_OPTED_IN
    }
    if (context.checkSelfPermission(Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) {
      return AutomaticCarrierFallbackResult.CALL_PERMISSION_MISSING
    }
    val selectedAccount = ServerFallbackSimManager.selectedPhoneAccount(context)
      ?: return AutomaticCarrierFallbackResult.SELECTED_SIM_UNAVAILABLE
    val telecom = context.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
      ?: return AutomaticCarrierFallbackResult.FAILED
    return try {
      if (!telecom.isOutgoingCallPermitted(selectedAccount)) return AutomaticCarrierFallbackResult.TELECOM_REJECTED
      telecom.placeCall(Uri.fromParts("tel", number, null), buildPlaceCallExtras(selectedAccount))
      AutomaticCarrierFallbackResult.PLACED
    } catch (_: SecurityException) {
      AutomaticCarrierFallbackResult.CALL_PERMISSION_MISSING
    } catch (_: Exception) {
      AutomaticCarrierFallbackResult.FAILED
    }
  }

  fun open(context: Context, rawNumber: String): Boolean {
    val intent = createIntent(context, rawNumber) ?: return false
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return try { context.startActivity(intent); true } catch (_: Exception) { false }
  }
}
