package com.server.caller

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Small offline cache of Server callers accepted by this Receiver.
 *
 * The contact-feed enrolment flow must call replaceAll() while online.
 * No network access is performed by this class or by CallScreeningService.
 */
internal object ServerOfflineCallerDirectory {
  private const val PREFS = "server_offline_caller_directory"
  private const val KEY_ENTRIES = "entries_v1"

  data class Caller(val e164: String, val displayName: String)

  fun replaceAll(context: Context, callers: List<Caller>) {
    val unique = callers
      .mapNotNull { caller ->
        val number = caller.e164.trim()
        val name = caller.displayName.trim().take(80)
        if (!number.matches(Regex("^\\+[1-9][0-9]{7,14}$")) || name.isBlank()) null
        else Caller(number, name)
      }
      .distinctBy { it.e164 }
    val json = JSONArray()
    unique.forEach { caller ->
      json.put(JSONObject().put("number", caller.e164).put("name", caller.displayName))
    }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit().putString(KEY_ENTRIES, json.toString()).commit()
  }

  fun find(context: Context, e164: String): Caller? {
    if (!e164.matches(Regex("^\\+[1-9][0-9]{7,14}$"))) return null
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_ENTRIES, null) ?: return null
    return try {
      val entries = JSONArray(raw)
      for (index in 0 until entries.length()) {
        val item = entries.optJSONObject(index) ?: continue
        if (item.optString("number") == e164) {
          val name = item.optString("name").trim().take(80)
          if (name.isNotBlank()) return Caller(e164, name)
        }
      }
      null
    } catch (_: Exception) {
      null
    }
  }

  fun clear(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit().remove(KEY_ENTRIES).commit()
  }
}
