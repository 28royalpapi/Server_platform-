package com.server.caller

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.telephony.SubscriptionInfo
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import org.json.JSONArray
import org.json.JSONObject

internal data class ServerSmsGatewaySim(
  val subscriptionId: Int,
  val slotIndex: Int,
  val carrier: String,
  val label: String
)

/**
 * SIM discovery for the explicitly enabled SMS gateway.
 *
 * Do not gate this on FEATURE_TELEPHONY_MESSAGING: several Android builds do
 * not advertise that optional package-manager feature consistently even when
 * the modem and active subscriptions are available. The authoritative signal
 * is an active SubscriptionInfo returned by SubscriptionManager.
 */
internal object ServerSmsGatewayManager {
  private fun phoneSlotCount(context: Context): Int {
    val telephony = try {
      context.getSystemService(TelephonyManager::class.java)
    } catch (_: Exception) {
      null
    }
    return try { (telephony?.phoneCount ?: 1).coerceIn(1, 8) } catch (_: Exception) { 1 }
  }

  private fun subscriptionManager(context: Context): SubscriptionManager? = try {
    context.getSystemService(SubscriptionManager::class.java)
      ?: (context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as? SubscriptionManager)
  } catch (_: Exception) {
    null
  }

  fun activeSims(context: Context): List<ServerSmsGatewaySim> {
    if (context.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
      return emptyList()
    }

    val manager = subscriptionManager(context) ?: return emptyList()
    // The active-list call is the normal multi-SIM path. Some OEM builds
    // transiently omit one or all entries from this list, so also query each
    // physical SIM slot and merge by subscription ID.
    val discovered = linkedMapOf<Int, Pair<SubscriptionInfo, Int?>>()
    fun add(info: SubscriptionInfo?, slotHint: Int? = null) {
      if (info == null || info.subscriptionId < 0) return
      val reportedSlot = info.simSlotIndex.takeIf { it >= 0 } ?: slotHint
      val previous = discovered[info.subscriptionId]
      if (previous == null || (previous.second == null && reportedSlot != null)) {
        discovered[info.subscriptionId] = info to reportedSlot
      }
    }

    try {
      manager.activeSubscriptionInfoList.orEmpty().forEach { info -> add(info) }
    } catch (_: SecurityException) {
      // Continue with per-slot lookup; the final result will remain empty if
      // the platform does not permit either form of SIM discovery.
    } catch (_: Exception) {
      // Some vendor telephony services throw while the radio is initializing.
    }

    for (slot in 0 until phoneSlotCount(context)) {
      try {
        add(manager.getActiveSubscriptionInfoForSimSlotIndex(slot), slot)
      } catch (_: SecurityException) {
        // Keep any subscriptions returned by the active-list query.
      } catch (_: Exception) {
        // One unavailable slot must not hide the other active SIM.
      }
    }

    return discovered.values.mapNotNull { (info, slotHint) ->
      val slot = info.simSlotIndex.takeIf { it >= 0 } ?: slotHint ?: return@mapNotNull null
      val carrier = info.carrierName?.toString()?.trim()?.takeIf { it.isNotBlank() }
        ?: info.displayName?.toString()?.trim()?.takeIf { it.isNotBlank() }
        ?: "Mobile network"
      ServerSmsGatewaySim(
        info.subscriptionId,
        slot,
        carrier.take(80),
        "SIM ${slot + 1} · ${carrier.take(60)}"
      )
    }.sortedWith(compareBy<ServerSmsGatewaySim> { it.slotIndex }.thenBy { it.carrier })
  }

  fun optionsJson(context: Context): JSONObject {
    if (context.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
      return JSONObject().put("ok", false).put("error", "SIM_PERMISSION_REQUIRED")
    }
    val sims = activeSims(context)
    val array = JSONArray()
    sims.forEach { sim ->
      array.put(JSONObject()
        .put("subscription_id", sim.subscriptionId)
        .put("slot_index", sim.slotIndex)
        .put("carrier", sim.carrier)
        .put("label", sim.label))
    }
    return JSONObject()
      .put("ok", true)
      .put("options", array)
      .put("phone_count", phoneSlotCount(context))
      .put("active_subscription_count", sims.size)
      .put("telephony_feature_reported", context.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY))
  }

  fun resolve(context: Context, subscriptionId: Int): ServerSmsGatewaySim? =
    activeSims(context).firstOrNull { it.subscriptionId == subscriptionId }
}
