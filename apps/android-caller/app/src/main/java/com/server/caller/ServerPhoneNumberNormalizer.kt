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
  private val E164 = Regex("^\\+[1-9][0-9]{7,14}$")
  private val REGION = Regex("^[A-Za-z]{2}$")
  private val phoneUtil: PhoneNumberUtil by lazy { PhoneNumberUtil.getInstance() }

  private data class ContactHints(
    val normalizedNumber: String? = null,
    val countryRegion: String? = null,
    val contactMatched: Boolean = false,
    val ambiguous: Boolean = false
  )

  /** Caller default region for unsaved/manual national-format numbers only. */
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
  fun toE164FromContact(context: Context, raw: String, fallbackRegion: String): String? {
    val value = raw.trim()
    if (value.isEmpty()) return null
    if (value.startsWith("+")) return toE164(value, "ZZ")

    val hints = lookupContactHints(context, value)
    if (hints?.ambiguous == true) return null
    if (hints?.contactMatched == true &&
      hints.normalizedNumber.isNullOrBlank() &&
      hints.countryRegion.isNullOrBlank()
    ) return null

    return toE164WithContactMetadata(
      value,
      fallbackRegion,
      hints?.normalizedNumber,
      hints?.countryRegion
    )
  }

  /**
   * Pure resolver used by tests and by the provider lookup path. A contact's
   * normalized E.164 number outranks its postal country; postal country outranks
   * the caller's SIM region.
   */
  fun toE164WithContactMetadata(
    raw: String,
    fallbackRegion: String,
    normalizedNumber: String?,
    contactCountry: String?
  ): String? {
    val value = raw.trim()
    if (value.isEmpty()) return null
    if (value.startsWith("+")) return toE164(value, "ZZ")

    val normalized = normalizedNumber?.trim()
    if (!normalized.isNullOrBlank() && E164.matches(normalized)) {
      return toE164(normalized, "ZZ")
    }

    val region = regionForCountry(contactCountry) ?: fallbackRegion
    return toE164(value, region)
  }

  private fun lookupContactHints(context: Context, raw: String): ContactHints? {
    if (context.checkSelfPermission(android.Manifest.permission.READ_CONTACTS) !=
      PackageManager.PERMISSION_GRANTED
    ) return null

    val inputDigits = PhoneNumberUtils.normalizeNumber(raw)
    if (inputDigits.isBlank()) return null

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
      val contactIds = linkedSetOf<Long>()

      context.contentResolver.query(lookupUri, projection, null, null, null)?.use { cursor ->
        val numberIndex = cursor.getColumnIndex(ContactsContract.PhoneLookup.NUMBER)
        val normalizedIndex = cursor.getColumnIndex(ContactsContract.PhoneLookup.NORMALIZED_NUMBER)
        val contactIdIndex = cursor.getColumnIndex(ContactsContract.PhoneLookup.CONTACT_ID)
        while (cursor.moveToNext()) {
          val savedNumber = if (numberIndex >= 0) cursor.getString(numberIndex).orEmpty() else ""
          if (PhoneNumberUtils.normalizeNumber(savedNumber) != inputDigits) continue

          if (normalizedIndex >= 0) {
            cursor.getString(normalizedIndex)?.trim()?.takeIf(E164::matches)?.let(normalizedNumbers::add)
          }
          if (contactIdIndex >= 0) {
            val id = cursor.getLong(contactIdIndex)
            if (id > 0L) contactIds.add(id)
          }
        }
      }

      if (normalizedNumbers.size > 1) {
        return ContactHints(contactMatched = true, ambiguous = true)
      }
      if (normalizedNumbers.size == 1) {
        return ContactHints(
          normalizedNumber = normalizedNumbers.first(),
          contactMatched = true
        )
      }
      if (contactIds.isEmpty()) return null

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

      when (contactRegions.size) {
        0 -> ContactHints(contactMatched = true, ambiguous = true)
        1 -> ContactHints(countryRegion = contactRegions.first(), contactMatched = true)
        else -> ContactHints(contactMatched = true, ambiguous = true)
      }
    } catch (_: SecurityException) {
      null
    } catch (_: Exception) {
      null
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
