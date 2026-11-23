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
    renderStatus()
  }
  private val permissionsResult = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
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
    root.addView(button("Turn on data and open Server Receiver") {
      try {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://server-onboarding-ochre.vercel.app/receiver.html")))
      } catch (_: Exception) { setStatus("Could not open Server Receiver in your browser.") }
    }, matchWrap())
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
          setStatus("PAIRED · $count verified Server callers synced. Approve the Call Screening role and permissions below.")
        }
      } catch (e: Exception) {
        runOnUiThread {
          setStatus("Pairing failed: ${e.message?.take(140) ?: "network error"}. Create a fresh pairing link from the Receiver page.")
        }
      }
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
    setStatus("Pairing: ${if (secretReady) "complete" else "waiting"} · Call Screening role: ${if (roleHeld) "enabled" else "not enabled"} · Contacts: ${if (contacts) "granted" else "not granted"} · Notifications: ${if (notifications) "allowed" else "not allowed"}")
  }

  private fun scheduleRosterRefresh() {
    val request = PeriodicWorkRequestBuilder<ServerRosterRefreshWorker>(12, TimeUnit.HOURS)
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .build()
    WorkManager.getInstance(this).enqueueUniquePeriodicWork(
      "server-receiver-caller-roster-refresh",
      ExistingPeriodicWorkPolicy.KEEP,
      request
    )
  }
}
