package com.server.receiver

import android.Manifest
import android.app.role.RoleManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class MainActivity : ComponentActivity() {
  private val executor = Executors.newSingleThreadExecutor()
  private lateinit var status: TextView

  private val roleResult = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
    val manager = getSystemService(RoleManager::class.java)
    if (manager?.isRoleHeld(RoleManager.ROLE_CALL_SCREENING) == true) requestPermissions()
    else {
      syncRoster()
      renderStatus()
    }
  }
  private val permissionsResult = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
    syncRoster()
    renderStatus()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    buildUi()
    handlePairLink(intent)
    scheduleRosterRefresh()
    if (ServerReceiverRoster.secret(this).isNotBlank()) syncRoster()
    renderStatus()
  }

  override fun onResume() {
    super.onResume()
    if (ServerReceiverRoster.secret(this).isNotBlank()) {
      if (ServerReceiverRoster.hasInternet(this)) resumePendingCall()
      else syncRoster()
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handlePairLink(intent)
  }

  private fun buildUi() {
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(28, 34, 28, 28)
      setBackgroundColor(0xff081522.toInt())
    }
    val scroll = ScrollView(this)
    scroll.addView(root)
    setContentView(scroll)
    root.addView(TextView(this).apply {
      text = "SERVER RECEIVER"
      textSize = 12f
      letterSpacing = .18f
      setTextColor(0xff72e6b0.toInt())
    })
    root.addView(TextView(this).apply {
      text = "Offline wake-up"
      textSize = 28f
      setTextColor(0xfff2f7fb.toInt())
      setPadding(0, 8, 0, 8)
    })
    root.addView(TextView(this).apply {
      text = "This small companion listens for a cellular call from a verified Server caller when this phone has no internet connection. It does not carry the conversation. After the alert, turn on mobile data or Wi-Fi and answer the Server call over the internet."
      textSize = 14f
      setTextColor(0xffb0c0ca.toInt())
      setPadding(0, 0, 0, 18)
    })
    status = TextView(this).apply {
      textSize = 13f
      setTextColor(0xffffdfa3.toInt())
      setPadding(14, 14, 14, 14)
      setBackgroundColor(0xff172b3b.toInt())
    }
    root.addView(status, matchWrap())
    root.addView(button("Allow Server to detect cellular wake-up calls") { requestScreeningRole() }, matchWrap())
    root.addView(button("Grant Contacts and notification access") { requestPermissions() }, matchWrap())
    root.addView(button("Refresh Server caller list") { syncRoster() }, matchWrap())
    root.addView(button("Resume pending Server call") { resumePendingCall() }, matchWrap())
    root.addView(button("Turn off offline wake-up on this phone") { revoke() }, matchWrap())
    root.addView(TextView(this).apply {
      text = "Privacy: Server downloads keyed caller fingerprints, not phone numbers. Contacts permission is required by Android so Call Screening can receive calls from numbers already saved in Contacts; this app does not read or upload your address book. Android may show a notification rather than a full-screen call screen."
      textSize = 11f
      setTextColor(0xff8197a6.toInt())
      setPadding(0, 18, 0, 0)
    }, matchWrap())
  }

  private fun button(label: String, action: () -> Unit) = Button(this).apply {
    text = label
    setOnClickListener { action() }
  }

  private fun matchWrap() = LinearLayout.LayoutParams(
    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
  ).apply { bottomMargin = 10 }

  private fun setStatus(value: String) {
    if (::status.isInitialized) status.text = value
  }

  private fun handlePairLink(intent: Intent?) {
    val uri = intent?.data ?: return
    if (uri.scheme != "serverreceiver" || uri.host != "pair") return
    val code = uri.getQueryParameter("code").orEmpty()
    if (!code.matches(Regex("^[0-9a-f]{32}$"))) {
      setStatus("This Receiver pairing link is invalid. Return to the setup page and create a new pairing link.")
      return
    }
    setStatus("Connecting this companion to the enrolled Receiver…")
    executor.execute {
      try {
        val secret = ServerReceiverRoster.claimPair(code)
        if (!secret.matches(Regex("^[0-9a-f]{64}$"))) throw IllegalStateException("The pairing response was incomplete.")
        ServerReceiverRoster.saveSecret(this, secret)
        val count = ServerReceiverRoster.sync(this, secret)
        runOnUiThread {
          setStatus("Receiver paired. Approve the Android offline wake-up permissions to finish setup.")
          beginOfflineWakeActivation()
        }
      } catch (e: Exception) {
        runOnUiThread {
          setStatus("Pairing failed: ${e.message?.take(140) ?: "network error"}. Create a fresh pairing link from the Receiver page.")
        }
      }
    }
  }

  private fun beginOfflineWakeActivation() {
    if (Build.VERSION.SDK_INT < 29) {
      setStatus("Android 10 or later is required for offline wake-up.")
      return
    }
    val manager = getSystemService(RoleManager::class.java)
    if (manager == null || !manager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) {
      setStatus("This phone does not expose Android's Call Screening role. Browser Receiver alerts remain available while internet is on.")
      return
    }
    if (manager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) {
      requestPermissions()
    } else {
      roleResult.launch(manager.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING))
    }
  }

  private fun requestScreeningRole() {
    if (Build.VERSION.SDK_INT < 29) {
      setStatus("Android 10 or later is required for the Call Screening role.")
      return
    }
    val manager = getSystemService(RoleManager::class.java)
    if (manager == null || !manager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) {
      setStatus("This Android device does not expose the Call Screening role.")
      return
    }
    if (manager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) {
      setStatus("Server already holds the Call Screening role on this phone.")
      return
    }
    roleResult.launch(manager.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING))
  }

  private fun requestPermissions() {
    val needed = mutableListOf<String>()
    if (checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
      needed.add(Manifest.permission.READ_CONTACTS)
    }
    if (Build.VERSION.SDK_INT >= 33 &&
      checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      needed.add(Manifest.permission.POST_NOTIFICATIONS)
    }
    if (needed.isEmpty()) {
      setStatus("Contacts and notification permissions are already enabled.")
    } else {
      permissionsResult.launch(needed.toTypedArray())
    }
  }

  private fun resumePendingCall() {
    val nativeSecret = ServerReceiverRoster.secret(this)
    if (nativeSecret.isBlank()) {
      setStatus("Pair this companion with your enrolled browser Receiver first.")
      return
    }
    if (!ServerReceiverRoster.hasInternet(this)) {
      setStatus("Turn on mobile data or Wi-Fi. Server will look for the pending call when internet returns.")
      return
    }
    val launchPrefs = getSharedPreferences("server_receiver_companion", MODE_PRIVATE)
    val previousAt = launchPrefs.getLong("last_resumed_call_at", 0L)
    if (System.currentTimeMillis() - previousAt < 90_000L &&
      launchPrefs.getString("last_resumed_call_id", "").orEmpty().isNotBlank()) {
      setStatus("The pending Server call has already been opened in your browser. Answer there or return to that browser tab.")
      return
    }
    setStatus("Checking for the Server call that triggered this wake-up…")
    executor.execute {
      try {
        // Refresh the readiness lease and the roster while internet is available,
        // then request a one-time link for the original still-live WebRTC call.
        try { ServerReceiverRoster.sync(this, nativeSecret) } catch (_: Exception) {}
        val pending = ServerReceiverRoster.pendingGuestCall(this, nativeSecret)
        if (pending == null) {
          runOnUiThread { setStatus("No live pending Server call was found. Ask the caller to call again if the call has expired.") }
          return@execute
        }
        val prefs = getSharedPreferences("server_receiver_companion", MODE_PRIVATE)
        val previousCall = prefs.getString("last_resumed_call_id", "").orEmpty()
        val previousAt = prefs.getLong("last_resumed_call_at", 0L)
        val now = System.currentTimeMillis()
        if (previousCall == pending.callId && now - previousAt < 90_000L) {
          runOnUiThread { setStatus("The pending Server call has already been opened in your browser. Answer there or return to that browser tab.") }
          return@execute
        }
        prefs.edit().putString("last_resumed_call_id", pending.callId)
          .putLong("last_resumed_call_at", now).apply()
        runOnUiThread {
          setStatus("Opening the pending Server call in your browser…")
          try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(pending.invitationUrl)))
          } catch (_: Exception) {
            prefs.edit().remove("last_resumed_call_id").remove("last_resumed_call_at").apply()
            setStatus("Could not open the pending Server call in your browser.")
          }
        }
      } catch (e: Exception) {
        runOnUiThread { setStatus("Could not recover the pending Server call: ${e.message?.take(120) ?: "network error"}.") }
      }
    }
  }

  private fun syncRoster() {
    val secret = ServerReceiverRoster.secret(this)
    if (secret.isBlank()) {
      setStatus("Complete browser Receiver setup first, then tap Activate offline wake-up on the Receiver page.")
      return
    }
    setStatus("Refreshing the verified Server caller list…")
    executor.execute {
      try {
        val count = ServerReceiverRoster.sync(this, secret)
        runOnUiThread { setStatus("READY · $count verified Server callers synced on this phone.") }
      } catch (e: Exception) {
        runOnUiThread {
          setStatus("Could not refresh caller list: ${e.message?.take(120) ?: "network unavailable"}. The saved list is kept.")
        }
      }
    }
  }

  private fun revoke() {
    setStatus("Turning off offline wake-up…")
    executor.execute {
      try {
        ServerReceiverRoster.revoke(this)
        runOnUiThread { setStatus("Offline wake-up is off on this phone. Browser Receiver alerts remain separate.") }
      } catch (e: Exception) {
        runOnUiThread { setStatus("Could not revoke companion: ${e.message?.take(120) ?: "network unavailable"}.") }
      }
    }
  }

  private fun renderStatus() {
    val roleHeld = if (Build.VERSION.SDK_INT >= 29) {
      getSystemService(RoleManager::class.java)?.isRoleHeld(RoleManager.ROLE_CALL_SCREENING) == true
    } else false
    val contacts = checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED
    val notifications = Build.VERSION.SDK_INT < 33 ||
      checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    val secretReady = ServerReceiverRoster.secret(this).isNotBlank()
    val ready = ServerReceiverRoster.isReady(this)
    setStatus("Pairing: ${if (secretReady) "complete" else "waiting"} · Call Screening role: ${if (roleHeld) "enabled" else "not enabled"} · Contacts: ${if (contacts) "granted" else "not granted"} · Notifications: ${if (notifications) "allowed" else "not allowed"} · Offline wake: ${if (ready) "ready" else "not ready"}")
  }

  private fun scheduleRosterRefresh() {
    val request = PeriodicWorkRequestBuilder<ServerRosterRefreshWorker>(15, TimeUnit.MINUTES)
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .build()
    WorkManager.getInstance(this).enqueueUniquePeriodicWork(
      "server-receiver-caller-roster-refresh",
      ExistingPeriodicWorkPolicy.KEEP,
      request
    )
  }
}
