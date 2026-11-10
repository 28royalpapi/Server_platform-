package com.server.caller

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract

/** Resolve caller identity against the recipient's local Contacts; never upload the address book. */
internal object ServerCallerIdentityResolver {
  private val E164 = Regex("^\\\\+[1-9][0-9]{7,14}$")

  /** A saved contact wins; otherwise show the caller's chosen Server name, not an unshared number. */
  internal fun chooseDisplayName(
    localContactName: String?,
    serverDisplayName: String?,
    sharedPhone: String?
  ): String {
    return localContactName?.trim()?.takeIf { it.isNotBlank() }
      ?: serverDisplayName?.trim()?.take(80)?.takeIf { it.isNotBlank() }
      ?: sharedPhone?.trim()?.takeIf { E164.matches(it) }
      ?: "Server caller"
  }

  fun resolve(context: Context, rawNumber: String, fallbackDisplayName: String? = null): String {
    val number = rawNumber.trim()
    if (!E164.matches(number)) {
      return chooseDisplayName(null, fallbackDisplayName, null)
    }
    val contactName = if (context.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) {
      try {
        val lookup = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number))
        val projection = arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME)
        context.contentResolver.query(lookup, projection, null, null, null)?.use { cursor ->
          if (cursor.moveToFirst()) cursor.getString(0)?.trim()?.takeIf { it.isNotBlank() } else null
        }
      } catch (_: SecurityException) {
        null
      } catch (_: Exception) {
        null
      }
    } else null
    return chooseDisplayName(contactName, fallbackDisplayName, number)
  }
}
