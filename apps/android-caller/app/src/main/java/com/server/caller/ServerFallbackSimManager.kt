package com.server.caller

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

internal data class ServerFallbackSimOption(
  val key: String,
  val slotIndex: Int,
  val carrierName: String,
  val label: String,
  val handle: PhoneAccountHandle
)

/**
 * Lists active SIM-backed calling accounts only after Android permission consent.
 * It does not read SIM phone numbers, ICCIDs, IMSIs or subscriber identifiers.
 * The opaque account key remains on-device; only selected slot and carrier label
 * are sent to Server as non-secret setup metadata.
 */
internal object ServerFallbackSimManager {
  private const val PREFS = "server-session"
  private const val KEY_SELECTED = "fallback_sim_account_key"
  private const val ASK_EVERY_TIME = "ask"
  private const val KEY_AUTO_FALLBACK = "automatic_carrier_fallback_enabled"

  /**
   * Resolve a call-capable Telecom account to an active cellular subscription
   * without reading any line number or full PhoneAccount metadata.
   */
  internal fun resolveActiveSubscriptionId(
    accountId: String,
    activeSubscriptionIds: Set<Int>,
    apiLevel: Int,
    telephonySubscriptionId: Int?
  ): Int? {
    val mappedId = telephonySubscriptionId
      ?.takeIf { apiLevel >= 30 && it >= 0 }
      ?: accountId.toIntOrNull()
    return mappedId?.takeIf { it in activeSubscriptionIds }
  }

  fun options(context: Context): List<ServerFallbackSimOption> {
    if (context.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
      return emptyList()
    }
    val telecom = context.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager ?: return emptyList()
    val telephony = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
    val subscriptionManager = try { SubscriptionManager.from(context) } catch (_: Exception) { null }
    val activeSubscriptions = try {
      subscriptionManager?.activeSubscriptionInfoList.orEmpty()
    } catch (_: SecurityException) {
      emptyList()
    } catch (_: UnsupportedOperationException) {
      emptyList()
    }
    val byId = activeSubscriptions.associateBy { it.subscriptionId }
    val accounts = try { telecom.callCapablePhoneAccounts } catch (_: Exception) { emptyList() }
    val result = ArrayList<ServerFallbackSimOption>()
    val seen = HashSet<String>()

    accounts.forEachIndexed { index, handle ->
      // Do not call TelecomManager.getPhoneAccount(): for apps targeting API 31+
      // it requires READ_PHONE_NUMBERS, which Server deliberately does not request.
      // Android 11+ maps the call-capable PhoneAccountHandle directly to an active
      // subscription using READ_PHONE_STATE. Older versions commonly use the
      // subscription ID as the Telecom account ID.
      val telephonySubscriptionId = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && telephony != null) {
        try {
          telephony.getSubscriptionId(handle)
        } catch (_: SecurityException) {
          null
        } catch (_: UnsupportedOperationException) {
          null
        } catch (_: Exception) {
          null
        }
      } else null
      val subscriptionId = resolveActiveSubscriptionId(
        handle.id, byId.keys, Build.VERSION.SDK_INT, telephonySubscriptionId
      ) ?: return@forEachIndexed
      val info = byId[subscriptionId] ?: return@forEachIndexed

      val slot = (info.simSlotIndex.takeIf { it >= 0 } ?: index).coerceAtLeast(0)
      val carrier = info.carrierName?.toString()?.trim()
        ?.takeIf { it.isNotBlank() }
        ?: info.displayName?.toString()?.trim()?.takeIf { it.isNotBlank() }
        ?: "Mobile network"
      val key = accountKey(handle)
      if (seen.add(key)) {
        result.add(ServerFallbackSimOption(
          key = key,
          slotIndex = slot,
          carrierName = carrier.take(80),
          label = "SIM ${slot + 1} · ${carrier.take(60)}",
          handle = handle
        ))
      }
    }
    return result.sortedWith(compareBy<ServerFallbackSimOption> { it.slotIndex }.thenBy { it.carrierName })
  }

  fun optionsJson(context: Context): JSONObject {
    val all = options(context)
    val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val savedKey = preferences.getString(KEY_SELECTED, ASK_EVERY_TIME) ?: ASK_EVERY_TIME
    val selectionAvailable = savedKey == ASK_EVERY_TIME || all.any { it.key == savedKey }
    val selectedKey = if (selectionAvailable) savedKey else ASK_EVERY_TIME
    if (!selectionAvailable) preferences.edit().putBoolean(KEY_AUTO_FALLBACK, false).apply()
    val array = JSONArray()
    all.forEach { option ->
      array.put(JSONObject()
        .put("key", option.key)
        .put("slot_index", option.slotIndex)
        .put("carrier", option.carrierName)
        .put("label", option.label))
    }
    return JSONObject()
      .put("ok", true)
      .put("options", array)
      .put("selected_key", selectedKey)
      .put("selected_sim_unavailable", !selectionAvailable)
      .put("permission_granted", context.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED)
      .put("automatic_fallback_enabled", automaticFallbackEnabled(context))
  }

  fun saveSelection(context: Context, requestedKey: String): JSONObject {
    val key = requestedKey.trim()
    val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (key == ASK_EVERY_TIME) {
      val saved = preferences.edit()
        .putString(KEY_SELECTED, ASK_EVERY_TIME)
        .putBoolean(KEY_AUTO_FALLBACK, false)
        .remove("selected_sim_slot")
        .remove("selected_sim_carrier")
        .commit()
      return JSONObject().put("ok", saved).put("selected_key", ASK_EVERY_TIME)
    }
    val option = options(context).firstOrNull { it.key == key }
      ?: return JSONObject().put("ok", false).put("error", "The selected SIM is no longer available. Refresh the list and choose an active line.")
    val oldKey = preferences.getString(KEY_SELECTED, ASK_EVERY_TIME) ?: ASK_EVERY_TIME
    val editor = preferences.edit()
      .putString(KEY_SELECTED, option.key)
      .putInt("selected_sim_slot", option.slotIndex)
      .putString("selected_sim_carrier", option.carrierName)
    if (oldKey != option.key) editor.putBoolean(KEY_AUTO_FALLBACK, false)
    val saved = editor.commit()
    return JSONObject()
      .put("ok", saved)
      .put("selected_key", option.key)
      .put("selected_sim_slot", option.slotIndex)
      .put("selected_sim_carrier", option.carrierName)
  }

  fun selectedOption(context: Context): ServerFallbackSimOption? {
    val key = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_SELECTED, ASK_EVERY_TIME) ?: ASK_EVERY_TIME
    if (key == ASK_EVERY_TIME) return null
    return options(context).firstOrNull { it.key == key }
  }

  fun hasAutomaticFallbackConsent(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_AUTO_FALLBACK, false)

  fun automaticFallbackEnabled(context: Context): Boolean =
    hasAutomaticFallbackConsent(context) &&
      context.checkSelfPermission(Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED &&
      selectedOption(context) != null

  fun setAutomaticFallback(context: Context, enabled: Boolean): JSONObject {
    val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (!enabled) {
      val saved = preferences.edit().putBoolean(KEY_AUTO_FALLBACK, false).commit()
      return JSONObject().put("ok", saved).put("automatic_fallback_enabled", false)
    }
    if (context.checkSelfPermission(Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) {
      return JSONObject().put("ok", false).put("automatic_fallback_enabled", false)
        .put("error", "CALL_PHONE_PERMISSION_REQUIRED")
    }
    val selected = selectedOption(context)
      ?: return JSONObject().put("ok", false).put("automatic_fallback_enabled", false)
        .put("error", "SELECTED_SIM_REQUIRED")
    val saved = preferences.edit().putBoolean(KEY_AUTO_FALLBACK, true).commit()
    return JSONObject().put("ok", saved).put("automatic_fallback_enabled", saved)
      .put("selected_sim_slot", selected.slotIndex).put("selected_sim_carrier", selected.carrierName)
  }

  fun selectedPhoneAccount(context: Context): PhoneAccountHandle? =
    selectedOption(context)?.handle

  private fun accountKey(handle: PhoneAccountHandle): String {
    val source = handle.componentName.flattenToString() + "|" + handle.id
    val digest = MessageDigest.getInstance("SHA-256")
      .digest(("server-fallback-account|" + source).toByteArray(Charsets.UTF_8))
    return digest.take(16).joinToString("") { "%02x".format(it) }
  }
}
