package com.server.caller

import android.telephony.PhoneNumberUtils

/**
 * Converts the number supplied by Android's Phone/Contacts UI to E.164 internally.
 * Users keep their saved national-format contacts; they never need to add a '+'.
 */
internal object ServerPhoneNumberNormalizer {
  private val E164 = Regex("^\\+[1-9][0-9]{7,14}$")
  private val REGION = Regex("^[A-Za-z]{2}$")

  fun toE164(raw: String, region: String?): String? {
    val value = raw.trim()
    if (value.isEmpty()) return null
    val digits = PhoneNumberUtils.normalizeNumber(value).filter(Char::isDigit)
    val candidate = when {
      value.startsWith("+") -> "+$digits"
      value.startsWith("00") && digits.length > 2 -> "+" + digits.drop(2)
      // Keep a Nigerian number already written with the country code, even
      // when the phone has no active SIM and therefore no SIM country ISO.
      digits.startsWith("234") && digits.length == 13 -> "+$digits"
      else -> {
        val country = region?.takeIf { REGION.matches(it) }?.uppercase(java.util.Locale.ROOT) ?: "NG"
        PhoneNumberUtils.formatNumberToE164(value, country)
      }
    }
    return candidate?.takeIf(E164::matches)
  }
}
