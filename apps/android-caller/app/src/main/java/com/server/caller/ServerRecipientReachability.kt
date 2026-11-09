package com.server.caller

/**
 * Server reachability is based on the authenticated Server session heartbeat.
 * A push token is only a wake candidate; it is not proof of current internet
 * connectivity until the recipient app reports a fresh heartbeat.
 */
internal object ServerRecipientReachability {
  fun isFresh(status: String): Boolean = status == "online"

  fun requiresWakeConfirmation(status: String, pushQueued: Boolean): Boolean =
    status == "background_reachable" && pushQueued
}
