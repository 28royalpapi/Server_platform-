package com.server.caller

import android.content.Context
import android.telephony.TelephonyManager
import com.google.i18n.phonenumbers.NumberParseException
import com.google.i18n.phonenumbers.PhoneNumberUtil
import java.util.Locale

/**
 * Parses national-format contacts using the caller's home numbering region, and
 * international numbers using their explicit calling code. libphonenumber carries
 * the same numbering metadata on Android 8 through current Android releases.
 *
 * A number like 07123... is not globally unique. If it is a UK national number on
 * a Nigerian handset, the contact must include +44/0044 or supply GB as its region.
 */
internal object ServerPhoneNumberNormalizer {
  private val E164 = Regex("^\\+[1-9][0-9]{7,14}$")
  private val REGION = Regex("^[A-Za-z]{2}$")
  private val phoneUtil: PhoneNumberUtil by lazy { PhoneNumberUtil.getInstance() }

  /**
   * Prefer the SIM's home country for national contacts; use the attached network
   * and device locale only when there is no usable SIM country. Nigeria is the last
   * fallback because Server's first deployment audience is Nigeria.
   */
  fun resolveRegion(
    simRegion: String?,
    networkRegion: String?,
    localeRegion: String?,
    fallback: String = "NG"
  ): String {
    return listOf(simRegion, networkRegion, localeRegion, fallback)
      .firstNotNullOfOrNull { value ->
        value?.trim()?.takeIf { REGION.matches(it) }?.uppercase(Locale.ROOT)
      } ?: "NG"
  }

  @Suppress("DEPRECATION")
  fun deviceRegion(context: Context): String {
    val telephony = try {
      context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
    } catch (_: Exception) {
      null
    }
    val sim = try { telephony?.simCountryIso } catch (_: Exception) { null }
    val network = try { telephony?.networkCountryIso } catch (_: Exception) { null }
    return resolveRegion(sim, network, Locale.getDefault().country)
  }

  fun toE164(raw: String, region: String?): String? {
    val value = raw.trim()
    if (value.isEmpty()) return null
    val defaultRegion = resolveRegion(region, null, null)
    return try {
      val parsed = phoneUtil.parse(value, defaultRegion)
      if (!phoneUtil.isPossibleNumber(parsed)) return null
      phoneUtil.format(parsed, PhoneNumberUtil.PhoneNumberFormat.E164)
        .takeIf(E164::matches)
    } catch (_: NumberParseException) {
      null
    } catch (_: IllegalArgumentException) {
      null
    }
  }
}
