package com.server.receiver

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.app.role.RoleManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {
  private lateinit var status: TextView
  private lateinit var details: TextView
  private lateinit var enableButton: Button
  private var inviteToken = ""
  private var invite: OfflineWakeCaller? = null
  private var setupInProgress = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    render()
    acceptIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    acceptIntent(intent)
  }

  private fun render() {
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setPadding(24, 28, 24, 28)
      setBackgroundColor(0xFF07121B.toInt())
    }
    root.addView(TextView(this).apply {
      text = "SERVER RECEIVER"
      textSize = 14f
      setTextColor(0xFF65D6AE.toInt())
      gravity = Gravity.CENTER
    })
    root.addView(TextView(this).apply {
      text = "Offline call alerts"
      textSize = 26f
      setTextColor(0xFFFFFFFF.toInt())
      gravity = Gravity.CENTER
      setPadding(0, 20, 0, 12)
    })
    details = TextView(this).apply {
      text = "Open the one-time Receiver setup link shared by a Server user."
      textSize = 15f
      setTextColor(0xFFCAD5DF.toInt())
      gravity = Gravity.CENTER
    }
    root.addView(details)
    status = TextView(this).apply {
      text = "Waiting for Receiver invitation…"
      textSize = 13f
      setTextColor(0xFF65D6AE.toInt())
      gravity = Gravity.CENTER
      setPadding(0, 18, 0, 18)
    }
    root.addView(status)
    enableButton = Button(this).apply {
      text = "Enable offline call alerts"
      isEnabled = false
      setOnClickListener { beginEnableFlow() }
    }
    root.addView(enableButton, LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT,
    ))
    root.addView(TextView(this).apply {
      text = "Server uses a brief unanswered cellular call only as a wake signal. The call is not answered and carries no conversation audio. The actual Server call still uses WebRTC after you reconnect."
      textSize = 12f
      setTextColor(0xFF91A2B3.toInt())
      gravity = Gravity.CENTER
      setPadding(0, 22, 0, 0)
    })
    setContentView(root)
  }

  private fun acceptIntent(intent: Intent?) {
    val uri = intent?.data
    val token = uri?.getQueryParameter("token").orEmpty()
    if (token.isBlank()) {
      val saved = WakeStore.callers(this)
      if (saved.isNotEmpty()) {
        details.text = "Offline wake is enabled for " + saved.joinToString { it.displayName } + "."
        status.text = "This phone is registered."
        enableButton.text = "Add another Server caller"
        enableButton.isEnabled = false
      }
      return
    }
    if (!token.matches(Regex("^[0-9a-fA-F]{64}$"))) {
      status.text = "This Receiver invitation is invalid."
      return
    }
    inviteToken = token
    enableButton.isEnabled = false
    status.text = "Checking the private invitation…"
    Thread {
      try {
        val result = ReceiverApi.post("native_inspect", inviteToken)
        val phone = result.optString("caller_phone_e164")
        val name = result.optString("caller_label")
        if (!phone.startsWith("+") || name.isBlank()) throw IllegalStateException("The inviter has not enabled verified caller identity.")
        val record = OfflineWakeCaller(phone, name, result.optString("caller_server_id"))
        runOnUiThread {
          invite = record
          details.text = name + " (" + mask(phone) + ") invited this phone to receive Server calls."
          status.text = "One-time invitation verified. Enable Android's caller-ID screening permission to finish."
          enableButton.isEnabled = true
        }
      } catch (error: Exception) {
        runOnUiThread {
          status.text = error.message ?: "Could not validate the Receiver invitation."
          enableButton.isEnabled = false
        }
      }
    }.start()
  }

  private fun beginEnableFlow() {
    if (setupInProgress || invite == null || inviteToken.isBlank()) return
    setupInProgress = true
    enableButton.isEnabled = false

    if (checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(arrayOf(Manifest.permission.READ_CONTACTS), REQUEST_CONTACTS)
      return
    }
    if (Build.VERSION.SDK_INT >= 33 &&
      checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
      return
    }
    requestScreeningRole()
  }

  private fun requestScreeningRole() {
    val manager = getSystemService(RoleManager::class.java)
    if (!manager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) {
      setupInProgress = false
      status.text = "This Android version does not provide the required call-screening role."
      enableButton.isEnabled = true
      return
    }
    if (manager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) {
      registerNativeReceiver()
      return
    }
    startActivityForResult(manager.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING), REQUEST_ROLE)
  }

  @Deprecated("The Android role request API uses activity results.")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode == REQUEST_ROLE) {
      val manager = getSystemService(RoleManager::class.java)
      if (manager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) registerNativeReceiver()
      else {
        setupInProgress = false
        status.text = "Caller-ID and call-screening access is required for offline wake alerts."
        enableButton.isEnabled = true
      }
    }
  }

  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<out String>,
    grantResults: IntArray,
  ) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (grantResults.isEmpty() || grantResults[0] != PackageManager.PERMISSION_GRANTED) {
      setupInProgress = false
      status.text = if (requestCode == REQUEST_CONTACTS)
        "Contacts permission is needed so Android can pass calls from saved contacts to Server's screening service."
      else "Notifications permission is needed to display the offline wake alert."
      enableButton.isEnabled = true
      return
    }
    if (requestCode == REQUEST_CONTACTS) beginEnableFlow()
    else requestScreeningRole()
  }

  private fun registerNativeReceiver() {
    val caller = invite ?: run { setupInProgress = false; return }
    status.text = "Registering this phone with Server…"
    Thread {
      try {
        val (deviceId, deviceSecret) = WakeStore.credentials(this)
        val result = ReceiverApi.post(
          "native_claim",
          inviteToken,
          org.json.JSONObject()
            .put("consent", true)
            .put("device_id", deviceId)
            .put("device_secret", deviceSecret),
        )
        if (result.optBoolean("registered") != true) throw IllegalStateException("Server did not register this phone.")
        WakeStore.saveCaller(this, caller)
        runOnUiThread {
          setupInProgress = false
          inviteToken = ""
          invite = null
          details.text = "Offline wake is enabled for " + caller.displayName + "."
          status.text = "CONNECTED · NATIVE OFFLINE WAKE ENABLED"
          enableButton.text = "Receiver is enabled"
          enableButton.isEnabled = false
        }
      } catch (error: Exception) {
        runOnUiThread {
          setupInProgress = false
          status.text = error.message ?: "Could not register this Receiver."
          enableButton.isEnabled = true
        }
      }
    }.start()
  }

  private fun mask(phone: String): String =
    if (phone.length > 6) phone.take(4) + "••••" + phone.takeLast(3) else phone

  private companion object {
    const val REQUEST_ROLE = 20
    const val REQUEST_CONTACTS = 21
    const val REQUEST_NOTIFICATIONS = 22
  }
}
