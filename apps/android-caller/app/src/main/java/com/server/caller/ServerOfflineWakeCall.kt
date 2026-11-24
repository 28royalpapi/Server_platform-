package com.server.caller

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.telecom.PhoneAccount
import android.telecom.TelecomManager
import android.telephony.PhoneNumberUtils
import android.telephony.TelephonyManager
import android.os.Bundle
import java.util.Locale

internal data class OfflineWakeAttempt(
  val handedOff: Boolean,
  val code: String,
  val message: String
)

/**
 * Places a short cellular wake-up leg on the user's already-selected default SIM.
 * It is never the voice conversation: Server WebRTC remains the call itself.
 *
 * The caller must have explicitly enabled this feature and accepted possible
 * carrier charges. We fail closed unless Android exposes the selected SIM's
 * number and it exactly matches the caller's verified Server number; otherwise
 * the Receiver could see an ordinary, unidentified carrier call.
 */
internal object ServerOfflineWakeCall {
  fun place(
    context: Context,
    callId: String,
    destinationE164: String,
    verifiedCallerE164: String
  ): OfflineWakeAttempt {
    val prefs = context.getSharedPreferences("server-session", Context.MODE_PRIVATE)
    if (!prefs.getBoolean("server_offline_wake_consent", false)) {
      return unavailable("CALLER_CONSENT_REQUIRED", "Enable offline wake-up in Server settings first.")
    }
    if (callId.isBlank() || !isE164(destinationE164) || !isE164(verifiedCallerE164)) {
      return unavailable("WAKE_TARGET_INVALID", "Offline wake-up needs a valid enrolled Receiver and verified caller number.")
    }
    if (context.checkSelfPermission(Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED ||
      context.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
      return unavailable("WAKE_PHONE_PERMISSION_REQUIRED", "Allow Phone and phone-state access in Server to enable cellular wake-up.")
    }

    val attemptKey = "server_offline_wake_attempt_" + callId
    if (prefs.getBoolean(attemptKey, false)) {
      return OfflineWakeAttempt(false, "WAKE_ALREADY_ATTEMPTED", "A cellular wake-up attempt was already submitted for this call.")
    }

    return try {
      val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
      val accountHandle = telecom.getDefaultOutgoingPhoneAccount(PhoneAccount.SCHEME_TEL)
        ?: return unavailable("DEFAULT_SIM_NOT_SELECTED", "Choose a default SIM for outgoing calls in Android Phone settings.")
      if (accountHandle == ServerTelecomRegistry.handle(context)) {
        return unavailable("SERVER_ACCOUNT_IS_NOT_A_SIM", "Select an ordinary mobile SIM as the default outgoing line.")
      }

      val account = telecom.getPhoneAccount(accountHandle)
        ?: return unavailable("DEFAULT_SIM_UNAVAILABLE", "Android could not read the selected outgoing SIM.")
      val simNumber = account.address?.schemeSpecificPart
        ?: return unavailable("SIM_CALLER_ID_UNAVAILABLE", "Android did not expose the selected SIM caller ID. No wake-up call was placed.")
      val normalizedSim = normalizeE164(context, simNumber)
        ?: return unavailable("SIM_CALLER_ID_UNAVAILABLE", "The selected SIM caller ID could not be verified. No wake-up call was placed.")
      if (normalizedSim != verifiedCallerE164) {
        return unavailable("SIM_CALLER_ID_MISMATCH", "Your default SIM number does not match your verified Server number. No wake-up call was placed.")
      }

      // Persist the attempt key before Telecom handoff so the app's legacy and
      // ConnectionService call paths cannot launch duplicate cellular legs.
      if (!prefs.edit().putBoolean(attemptKey, true).commit()) {
        return unavailable("WAKE_ATTEMPT_NOT_SAVED", "Server could not safely record this wake-up attempt.")
      }

      val extras = Bundle().apply {
        putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, accountHandle)
      }
      telecom.placeCall(Uri.fromParts("tel", destinationE164, null), extras)
      OfflineWakeAttempt(
        true,
        "WAKE_HANDED_TO_TELECOM",
        "Android accepted the cellular wake-up attempt. Carrier delivery and notification display are not confirmed."
      )
    } catch (_: SecurityException) {
      prefs.edit().remove(attemptKey).apply()
      unavailable("WAKE_PERMISSION_REJECTED", "Android denied the cellular wake-up request. Check Server's Phone permissions.")
    } catch (_: Exception) {
      prefs.edit().remove(attemptKey).apply()
      unavailable("WAKE_TELECOM_HANDOFF_FAILED", "Android could not place the cellular wake-up call.")
    }
  }

  private fun isE164(value: String): Boolean = Regex("^\\+[1-9][0-9]{7,14}$").matches(value)

  private fun normalizeE164(context: Context, raw: String): String? {
    val value = raw.trim().removePrefix("tel:")
    if (value.isBlank()) return null
    val digits = PhoneNumberUtils.normalizeNumber(value)
    if (digits.length < 7) return null
    if (value.startsWith("+")) return "+$digits"
    val telephony = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
    val region = try { telephony?.simCountryIso?.takeIf { it.length == 2 } }
      catch (_: Exception) { null }
      ?: try { telephony?.networkCountryIso?.takeIf { it.length == 2 } }
      catch (_: Exception) { null }
      ?: return null
    return try { PhoneNumberUtils.formatNumberToE164(value, region.uppercase(Locale.ROOT)) }
      catch (_: Exception) { null }
  }

  private fun unavailable(code: String, message: String) =
    OfflineWakeAttempt(false, code, message)
}
