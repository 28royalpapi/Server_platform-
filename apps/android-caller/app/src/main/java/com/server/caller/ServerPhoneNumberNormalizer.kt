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
    val country = region?.takeIf { REGION.matches(it) }?.uppercase(java.util.Locale.ROOT) ?: "NG"
    val candidate = when {
      value.startsWith("+") -> "+$digits"
      value.startsWith("00") && digits.length > 2 -> "+" + digits.drop(2)
      // A fully country-coded Nigerian number is already unambiguous.
      digits.startsWith("234") && digits.length == 13 -> "+$digits"
      // Android 8's libphonenumber metadata can return null for some Nigerian
      // national numbers. Convert the common national forms deterministically
      // before falling back to Android's country-aware E.164 formatter.
      country == "NG" && digits.length == 11 && digits.startsWith("0") -> "+234" + digits.drop(1)
      country == "NG" && digits.length == 10 && digits.firstOrNull() in '7'..'9' -> "+234$digits"
      else -> PhoneNumberUtils.formatNumberToE164(value, country)
    }
    return candidate?.takeIf(E164::matches)
  }
}
