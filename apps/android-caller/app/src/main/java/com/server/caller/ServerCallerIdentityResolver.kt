package com.server.caller

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract

/** Resolve caller identity against the recipient's local Contacts; never upload the address book. */
internal object ServerCallerIdentityResolver {
  private val E164 = Regex("^\\+[1-9][0-9]{7,14}$")

  fun resolve(context: Context, rawNumber: String): String {
    val number = rawNumber.trim()
    if (!E164.matches(number)) return "Server caller"
    if (context.checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return number
    return try {
      val lookup = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number))
      val projection = arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME)
      context.contentResolver.query(lookup, projection, null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0)?.trim()?.takeIf { it.isNotBlank() } else null
      } ?: number
    } catch (_: SecurityException) { number } catch (_: Exception) { number }
  }
}
