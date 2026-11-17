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
 * Resolves the Android system-default SMS subscription for a Server-operated
 * gateway handset. Customer phones never use this sender capability.
 */
internal object ServerSmsGatewayManager {
  private fun phoneSlotCount(context: Context): Int {
    return try {
      val telephony = context.getSystemService(TelephonyManager::class.java)
      (telephony?.phoneCount ?: 1).coerceIn(1, 8)
    } catch (_: Exception) {
      1
    }
  }

  fun activeSims(context: Context): List<ServerSmsGatewaySim> {
    if (context.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
      return emptyList()
    }

    val manager = try {
      context.getSystemService(SubscriptionManager::class.java)
        ?: (context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as? SubscriptionManager)
    } catch (_: Exception) {
      null
    } ?: return emptyList()

    val discovered = linkedMapOf<Int, ServerSmsGatewaySim>()

    fun add(info: SubscriptionInfo?, slotHint: Int? = null) {
      if (info == null || info.subscriptionId < 0) return
      val slot = info.simSlotIndex.takeIf { it >= 0 } ?: slotHint ?: return
      val carrier = info.carrierName?.toString()?.trim()?.takeIf { it.isNotBlank() }
        ?: info.displayName?.toString()?.trim()?.takeIf { it.isNotBlank() }
        ?: "Mobile network"
      discovered[info.subscriptionId] = ServerSmsGatewaySim(
        subscriptionId = info.subscriptionId,
        slotIndex = slot,
        carrier = carrier.take(80),
        label = "SIM ${slot + 1} · ${carrier.take(60)}"
      )
    }

    try {
      manager.activeSubscriptionInfoList.orEmpty().forEach { add(it) }
    } catch (_: Exception) {
      // The per-slot fallback below handles OEM radio/service startup gaps.
    }

    for (slot in 0 until phoneSlotCount(context)) {
      try {
        add(manager.getActiveSubscriptionInfoForSimSlotIndex(slot), slot)
      } catch (_: Exception) {
        // One missing or restricted slot must not hide another active SIM.
      }
    }

    return discovered.values.sortedWith(
      compareBy<ServerSmsGatewaySim> { it.slotIndex }.thenBy { it.carrier }
    )
  }

  fun defaultSmsSim(context: Context): ServerSmsGatewaySim? {
    val active = activeSims(context)
    if (active.isEmpty()) return null

    val defaultId = try {
      SubscriptionManager.getDefaultSmsSubscriptionId()
    } catch (_: Exception) {
      SubscriptionManager.INVALID_SUBSCRIPTION_ID
    }

    if (defaultId != SubscriptionManager.INVALID_SUBSCRIPTION_ID) {
      return active.firstOrNull { it.subscriptionId == defaultId }
    }

    // A single active subscription is unambiguous. On multi-SIM devices the
    // operator must set Android's default SMS SIM in system settings.
    return active.singleOrNull()
  }
}
