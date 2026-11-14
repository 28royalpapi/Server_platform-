package com.server.caller

/**
 * Server reachability is based on the authenticated Server session heartbeat.
 * A push token is only a wake candidate; it is not proof of current internet
 * connectivity until the recipient app reports a fresh heartbeat.
 */
internal object ServerRecipientReachability {
  fun isFresh(status: String): Boolean = status == "online"

  /** An unregistered phone has no Server receiver; its data/Wi-Fi state is unknown, not offline. */
  fun isUnknownGuest(status: String): Boolean = status == "unknown_guest"

  fun requiresWakeConfirmation(status: String, pushQueued: Boolean): Boolean =
    status == "background_reachable" && pushQueued
}
