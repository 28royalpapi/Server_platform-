package com.server.receiver

data class OfflineWakeCaller(
  val phoneE164: String,
  val displayName: String,
  val serverId: String,
)

internal object WakeNumberMatcher {
  fun canonical(raw: String): String? {
    val value = raw.trim()
    if (value.isEmpty()) return null
    val digits = value.filter(Char::isDigit)
    if (digits.isEmpty()) return null
    return when {
      value.startsWith("+") && digits.length in 8..15 -> "+$digits"
      digits.startsWith("234") && digits.length in 12..15 -> "+$digits"
      digits.startsWith("0") && digits.length == 11 -> "+234" + digits.drop(1)
      digits.length in 8..15 -> "+$digits"
      else -> null
    }
  }

  fun matches(incoming: String, savedE164: String): Boolean {
    val incomingNumber = canonical(incoming) ?: return false
    val savedNumber = canonical(savedE164) ?: return false
    return incomingNumber == savedNumber
  }
}
