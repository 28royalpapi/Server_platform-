package com.server.caller

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.PackageManager.FEATURE_TELEPHONY_MESSAGING
import android.telephony.SubscriptionInfo
import android.telephony.SubscriptionManager
import org.json.JSONArray
import org.json.JSONObject

internal data class ServerSmsGatewaySim(
  val subscriptionId: Int,
  val slotIndex: Int,
  val carrier: String,
  val label: String
)

internal object ServerSmsGatewayManager {
  fun activeSims(context: Context): List<ServerSmsGatewaySim> {
    if (context.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
      return emptyList()
    }
    if (!context.packageManager.hasSystemFeature(FEATURE_TELEPHONY_MESSAGING)) return emptyList()
    val manager = try { context.getSystemService(SubscriptionManager::class.java) } catch (_: Exception) { null }
      ?: return emptyList()
    val subscriptions = try { manager.activeSubscriptionInfoList.orEmpty() }
      catch (_: SecurityException) { emptyList() }
      catch (_: Exception) { emptyList() }

    return subscriptions.mapNotNull { info: SubscriptionInfo ->
      val subId = info.subscriptionId
      if (subId < 0) return@mapNotNull null
      val slot = info.simSlotIndex.takeIf { it >= 0 } ?: return@mapNotNull null
      val carrier = info.carrierName?.toString()?.trim()?.takeIf { it.isNotBlank() }
        ?: info.displayName?.toString()?.trim()?.takeIf { it.isNotBlank() }
        ?: "Mobile network"
      ServerSmsGatewaySim(subId, slot, carrier.take(80), "SIM ${slot + 1} · ${carrier.take(60)}")
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
      .put("telephony_sms_supported", context.packageManager.hasSystemFeature(FEATURE_TELEPHONY_MESSAGING))
  }

  fun resolve(context: Context, subscriptionId: Int): ServerSmsGatewaySim? =
    activeSims(context).firstOrNull { it.subscriptionId == subscriptionId }
}
