package com.server.caller

import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import android.telephony.PhoneNumberUtils
import android.telephony.TelephonyManager
import com.google.i18n.phonenumbers.NumberParseException
import com.google.i18n.phonenumbers.PhoneNumberUtil
import java.util.Locale

/**
 * Worldwide phone-number parsing for Server's Android calling path.
 *
 * A national number is not globally unique. Resolve a saved contact's normalized
 * E.164 value first, then its country in the contact address. Only a number with
 * no matching saved-contact row may fall back to the caller's SIM/network/locale.
 * Contact data is queried locally and is never sent to the Server backend.
 */
internal object ServerPhoneNumberNormalizer {
  private val E164 = Regex("^\\+[1-9][0-9]{1,14}$")
  private val REGION = Regex("^[A-Za-z]{2}$")
  private val phoneUtil: PhoneNumberUtil by lazy { PhoneNumberUtil.getInstance() }

  private data class ContactHints(
    val normalizedNumber: String? = null,
    val countryRegion: String? = null,
    val normalizedNumberIsExplicitInternational: Boolean = false,
    val contactMatched: Boolean = false,
    val ambiguous: Boolean = false
  )

  /** Caller default region for unsaved/manual national-format numbers only. */
  fun resolveRegion(
    simRegion: String?,
    networkRegion: String?,
    localeRegion: String?,
    fallback: String? = null
  ): String? {
    return listOf(simRegion, networkRegion, localeRegion, fallback)
      .firstNotNullOfOrNull { value ->
        value?.trim()?.takeIf { REGION.matches(it) }?.uppercase(Locale.ROOT)
      }
  }

  @Suppress("DEPRECATION")
  fun deviceRegion(context: Context): String? {
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
    // An explicit + number is globally unambiguous. A national-format number is
    // not: never silently interpret it as Nigerian (or any other country) when
    // this device has no SIM, network, locale, or user-supplied region context.
    if (defaultRegion == null && !value.startsWith("+")) return null
    return try {
      val parsed = phoneUtil.parse(value, defaultRegion ?: "ZZ")
      if (!phoneUtil.isPossibleNumber(parsed)) return null
      phoneUtil.format(parsed, PhoneNumberUtil.PhoneNumberFormat.E164)
        .takeIf(E164::matches)
    } catch (_: NumberParseException) {
      null
    } catch (_: IllegalArgumentException) {
      null
    }
  }

  /** Main entry used by both Android outgoing-call implementations. */
  fun toE164FromDevice(context: Context, raw: String): String? =
    toE164FromContact(context, raw, deviceRegion(context))

  /**
   * Resolve a destination selected from Android Contacts/Phone.
   *
   * Android Telecom supplies a tel: URI, not the selected contact ID. PhoneLookup
   * lets us match the selected number and read only that matching row's normalized
   * E.164 value or its contact country. If a saved contact exists but has no usable
   * country metadata, fail closed rather than silently calling a different country.
   */
  fun toE164FromContact(context: Context, raw: String, fallbackRegion: String?): String? {
    val value = raw.trim()
    if (value.isEmpty()) return null
    if (value.startsWith("+")) return toE164(value, "ZZ")

    // A national-format number cannot be assigned a destination country from its
    // digits alone. If Contacts access is unavailable, fail closed rather than
    // guessing that a foreign contact belongs to the caller's SIM country.
    val hints = lookupContactHints(context, value) ?: return null
    if (hints.ambiguous) return null

    if (!hints.contactMatched) return toE164(value, fallbackRegion)

    val contactRegion = hints.countryRegion
    val normalized = hints.normalizedNumber
    if (contactRegion == null && !hints.normalizedNumberIsExplicitInternational) return null

    if (!normalized.isNullOrBlank() && E164.matches(normalized)) {
      val normalizedRegion = regionForE164(normalized)
      if (hints.normalizedNumberIsExplicitInternational) {
        if (contactRegion != null && normalizedRegion != null && normalizedRegion != contactRegion) return null
        return toE164(normalized, "ZZ")
      }
      // Android may auto-fill NORMALIZED_NUMBER using the device's current
      // country. Trust it only when the contact's own country independently agrees.
      if (contactRegion != null && normalizedRegion == contactRegion) return toE164(normalized, "ZZ")
      // A mismatch means the provider probably inferred NORMALIZED_NUMBER from
      // the caller's device country. Discard that guess and parse the original
      // national-format number using the matched contact's saved country instead.
    }

    return contactRegion?.let { toE164(value, it) }
  }

  /**
   * Pure resolver used by tests. A provider-generated NORMALIZED_NUMBER is accepted
   * only when its region agrees with contact-country metadata. If it disagrees, the
   * original national number is parsed using the contact country instead. An
   * explicitly + prefixed saved number is independently trustworthy.
   */
  fun toE164WithContactMetadata(
    raw: String,
    fallbackRegion: String?,
    normalizedNumber: String?,
    contactCountry: String?,
    normalizedNumberIsExplicitInternational: Boolean = false,
    contactMatched: Boolean = true
  ): String? {
    val value = raw.trim()
    if (value.isEmpty()) return null
    if (value.startsWith("+")) return toE164(value, "ZZ")

    val contactRegion = regionForCountry(contactCountry)
    val normalized = normalizedNumber?.trim()?.takeIf(E164::matches)
    if (!contactMatched) return toE164(value, fallbackRegion)

    if (normalizedNumberIsExplicitInternational && normalized != null) {
      val parsedRegion = regionForE164(normalized)
      if (contactRegion != null && parsedRegion != null && contactRegion != parsedRegion) return null
      return toE164(normalized, "ZZ")
    }

    if (normalized != null && contactRegion != null) {
      val parsedRegion = regionForE164(normalized)
      if (parsedRegion == contactRegion) return toE164(normalized, "ZZ")
      // Otherwise the NORMALIZED_NUMBER may have been inferred from this device's
      // locale. Fall through and parse the original value using contactRegion.
    }

    if (contactRegion != null) return toE164(value, contactRegion)
    return null
  }

  private fun regionForE164(number: String): String? {
    return try {
      val parsed = phoneUtil.parse(number, "ZZ")
      phoneUtil.getRegionCodeForNumber(parsed)?.takeIf { REGION.matches(it) && it != "001" }
    } catch (_: Exception) {
      null
    }
  }

  private fun lookupContactHints(context: Context, raw: String): ContactHints? {
    if (context.checkSelfPermission(android.Manifest.permission.READ_CONTACTS) !=
      PackageManager.PERMISSION_GRANTED
    ) return ContactHints(ambiguous = true)

    val inputDigits = PhoneNumberUtils.normalizeNumber(raw)
    if (inputDigits.isBlank()) return ContactHints(ambiguous = true)

    return try {
      val lookupUri = Uri.withAppendedPath(
        ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
        Uri.encode(raw)
      )
      val projection = arrayOf(
        ContactsContract.PhoneLookup.NUMBER,
        ContactsContract.PhoneLookup.NORMALIZED_NUMBER,
        ContactsContract.PhoneLookup.CONTACT_ID
      )
      val normalizedNumbers = linkedSetOf<String>()
      val explicitNormalizedNumbers = linkedSetOf<String>()
      val contactIds = linkedSetOf<Long>()

      context.contentResolver.query(lookupUri, projection, null, null, null)?.use { cursor ->
        val numberIndex = cursor.getColumnIndex(ContactsContract.PhoneLookup.NUMBER)
        val normalizedIndex = cursor.getColumnIndex(ContactsContract.PhoneLookup.NORMALIZED_NUMBER)
        val contactIdIndex = cursor.getColumnIndex(ContactsContract.PhoneLookup.CONTACT_ID)
        while (cursor.moveToNext()) {
          val savedNumber = if (numberIndex >= 0) cursor.getString(numberIndex).orEmpty() else ""
          if (PhoneNumberUtils.normalizeNumber(savedNumber) != inputDigits) continue

          if (normalizedIndex >= 0) {
            val normalized = cursor.getString(normalizedIndex)?.trim()?.takeIf(E164::matches)
            if (normalized != null) {
              normalizedNumbers.add(normalized)
              // A literal + in the original saved number is explicit international
              // evidence. A provider-generated national NORMALIZED_NUMBER is not.
              if (savedNumber.trim().startsWith("+")) explicitNormalizedNumbers.add(normalized)
            }
          }
          if (contactIdIndex >= 0) {
            val id = cursor.getLong(contactIdIndex)
            if (id > 0L) contactIds.add(id)
          }
        }
      } ?: return ContactHints(ambiguous = true)

      if (normalizedNumbers.size > 1 || explicitNormalizedNumbers.size > 1) {
        return ContactHints(contactMatched = true, ambiguous = true)
      }
      if (contactIds.isEmpty()) return ContactHints()

      // Always fetch postal-country metadata, even when NORMALIZED_NUMBER exists:
      // Android can generate the latter using the phone's current country ISO.
      val contactRegions = linkedSetOf<String>()
      val countryProjection = arrayOf(ContactsContract.CommonDataKinds.StructuredPostal.COUNTRY)
      for (contactId in contactIds) {
        context.contentResolver.query(
          ContactsContract.CommonDataKinds.StructuredPostal.CONTENT_URI,
          countryProjection,
          ContactsContract.Data.CONTACT_ID + " = ?",
          arrayOf(contactId.toString()),
          null
        )?.use { cursor ->
          val countryIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.StructuredPostal.COUNTRY)
          while (cursor.moveToNext()) {
            val country = if (countryIndex >= 0) cursor.getString(countryIndex) else null
            regionForCountry(country)?.let(contactRegions::add)
          }
        }
      }

      if (contactRegions.size > 1) return ContactHints(contactMatched = true, ambiguous = true)
      ContactHints(
        normalizedNumber = normalizedNumbers.singleOrNull(),
        countryRegion = contactRegions.singleOrNull(),
        normalizedNumberIsExplicitInternational = explicitNormalizedNumbers.size == 1,
        contactMatched = true,
        ambiguous = contactRegions.isEmpty() && explicitNormalizedNumbers.isEmpty()
      )
    } catch (_: SecurityException) {
      ContactHints(ambiguous = true)
    } catch (_: Exception) {
      ContactHints(ambiguous = true)
    }
  }

  private fun regionForCountry(country: String?): String? {
    val value = country?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val upper = value.uppercase(Locale.ROOT)
    if (upper == "UK" || upper == "GREAT BRITAIN" || upper == "BRITAIN") return "GB"
    if (upper == "USA" || upper == "UNITED STATES OF AMERICA") return "US"
    if (upper == "UAE") return "AE"
    if (upper == "KSA") return "SA"

    val supported = Locale.getISOCountries()
    if (upper.length == 2 && supported.any { it.equals(upper, ignoreCase = true) }) return upper

    val matches = supported.filter { iso ->
      val locale = Locale("", iso)
      locale.getDisplayCountry(Locale.ENGLISH).equals(value, ignoreCase = true) ||
        locale.getDisplayCountry(Locale.getDefault()).equals(value, ignoreCase = true)
    }
    return matches.singleOrNull()
  }
}
