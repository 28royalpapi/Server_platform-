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
 * Places a short cellular wake-up leg using the SIM whose exposed caller ID matches the
 * caller's verified Server number. It does not blindly use or change the default SIM.
 * It is never the voice conversation: Server WebRTC remains the call itself.
 * A caller must explicitly accept possible carrier charges.
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
      context.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED ||
      context.checkSelfPermission(Manifest.permission.READ_PHONE_NUMBERS) != PackageManager.PERMISSION_GRANTED) {
      return unavailable("WAKE_PHONE_PERMISSION_REQUIRED", "Allow Phone, phone-state and SIM-number access to verify the wake-up line.")
    }

    val attemptKey = "server_offline_wake_attempt_" + callId
    if (prefs.getBoolean(attemptKey, false)) {
      return OfflineWakeAttempt(false, "WAKE_ALREADY_ATTEMPTED", "A cellular wake-up attempt was already submitted for this call.")
    }

    return try {
      val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
      // On dual-SIM phones, Android may be set to "Ask every time" or the
      // default SIM may not be the verified Server number. Search only real
      // cellular PhoneAccounts and select the unique SIM whose exposed number
      // exactly matches the caller's verified Server number.
      val matchingAccounts = telecom.callCapablePhoneAccounts.orEmpty().mapNotNull { handle ->
        if (handle == ServerTelecomRegistry.handle(context)) return@mapNotNull null
        val account = telecom.getPhoneAccount(handle) ?: return@mapNotNull null
        if (!account.hasCapabilities(PhoneAccount.CAPABILITY_SIM_SUBSCRIPTION)) return@mapNotNull null
        val rawNumber = account.address?.schemeSpecificPart ?: return@mapNotNull null
        val normalized = normalizeE164(context, rawNumber) ?: return@mapNotNull null
        if (normalized == verifiedCallerE164) handle else null
      }
      val defaultAccount = telecom.getDefaultOutgoingPhoneAccount(PhoneAccount.SCHEME_TEL)
      val accountHandle = when {
        matchingAccounts.size == 1 -> matchingAccounts.single()
        matchingAccounts.size > 1 && defaultAccount != null && defaultAccount in matchingAccounts -> defaultAccount
        matchingAccounts.size > 1 -> return unavailable(
          "MULTIPLE_MATCHING_SIM_ACCOUNTS",
          "More than one SIM matches your verified Server number. Choose one as Android's default outgoing SIM."
        )
        else -> return unavailable(
          "VERIFIED_CALLER_SIM_NOT_FOUND",
          "No accessible SIM caller ID matches your verified Server number. No cellular wake-up was placed."
        )
      }

      // One attempt per Server call; MainActivity and Telecom share this guard.
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
