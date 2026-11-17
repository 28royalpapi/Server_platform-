package com.server.caller

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.telephony.SubscriptionInfo
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager

internal data class ServerSmsGatewaySim(
  val subscriptionId: Int,
  val slotIndex: Int,
  val carrier: String,
  val label: String
)

/**
 * Select the Android system's default SMS subscription for a Server-operated
 * gateway handset. Consumer phones are not enrolled as Server SMS senders.
 *
 * Do not gate this on FEATURE_TELEPHONY_MESSAGING: several Android builds do
 * not advertise that optional package-manager feature consistently even when
 * the modem and active subscriptions are available.
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

  fun defaultSmsSim(context: Context): ServerSmsGatewaySim? {
    val sims = activeSims(context)
    if (sims.isEmpty()) return null
    val defaultId = try { SubscriptionManager.getDefaultSmsSubscriptionId() } catch (_: Exception) { -1 }
    if (defaultId >= 0) return sims.firstOrNull { it.subscriptionId == defaultId }
    // A single active SIM is unambiguous. On a dual-SIM device, require the
    // Android system default to be set instead of asking the Server user to choose.
    return sims.singleOrNull()
  }
}
