package com.server.gateway

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {
  private val executor = Executors.newSingleThreadExecutor()
  private lateinit var endpoint: EditText
  private lateinit var publishableKey: EditText
  private lateinit var pairingCode: EditText
  private lateinit var deviceLabel: EditText
  private lateinit var status: TextView

  private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
    val smsOk = ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED
    if (smsOk) startGatewayService() else setStatus("SMS permission is required for the SIM gateway. No SMS was sent.")
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(28, 30, 28, 28) }
    val scroll = ScrollView(this).apply { addView(root) }
    setContentView(scroll)

    root.addView(TextView(this).apply { text = "SERVER SIM GATEWAY"; textSize = 23f; setTextColor(0xff155f3d.toInt()) })
    root.addView(TextView(this).apply { text = "A dedicated Android handset uses its real SIM to send Server OTPs and guest-call invitations. SMS may incur normal carrier charges."; textSize = 14f; setPadding(0, 10, 0, 22) })
    endpoint = edit(root, "Supabase project URL", SecureStore.getText(this, "url").ifBlank { DEFAULT_SUPABASE_URL })
    publishableKey = edit(root, "Supabase publishable key", SecureStore.getText(this, "key").ifBlank { DEFAULT_PUBLISHABLE_KEY })
    pairingCode = edit(root, "One-time pairing code", "")
    deviceLabel = edit(root, "Gateway device label", "Server SIM Gateway")
    root.addView(button("Pair this gateway") { pairGateway() })
    root.addView(button("Start sending queue from SIM") { requestPermissionsAndStart() })
    root.addView(button("Stop gateway") { stopService(Intent(this, SmsGatewayService::class.java)); setStatus("Gateway stopped.") })
    root.addView(button("Forget this gateway token") { stopService(Intent(this, SmsGatewayService::class.java)); SecureStore.clear(this); endpoint.setText(""); publishableKey.setText(""); pairingCode.setText(""); setStatus("Saved token and settings cleared.") })
    status = TextView(this).apply { textSize = 13f; setPadding(0, 22, 0, 0); text = "Not paired." }
    root.addView(status)
  }

  private fun edit(parent: LinearLayout, hintText: String, value: String): EditText {
    val field = EditText(this).apply { hint = hintText; setSingleLine(true); setText(value); textSize = 14f; setPadding(14, 12, 14, 12) }
    parent.addView(field, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = 10 })
    return field
  }

  private fun button(label: String, action: () -> Unit) = Button(this).apply {
    text = label
    setOnClickListener { action() }
  }

  private fun cleanBase(): String = endpoint.text.toString().trim().trimEnd('/')
  private fun keyValue(): String = publishableKey.text.toString().trim()

  private fun pairGateway() {
    val base = cleanBase()
    val key = keyValue()
    val code = pairingCode.text.toString().trim().uppercase()
    if (!base.startsWith("https://") || !base.endsWith(".supabase.co") || key.isBlank() || code.length != 8) {
      setStatus("Enter the project's HTTPS URL, public key and 8-character one-time pairing code."); return
    }
    saveConfig(base, key)
    setStatus("Pairing…")
    executor.execute {
      try {
        val result = postJson("$base/functions/v1/server-gateway", key, null, JSONObject().put("action", "claim").put("pairing_code", code).put("device_label", deviceLabel.text.toString().trim().ifBlank { "Server SIM Gateway" }))
        val token = result.optString("gateway_token")
        if (token.length < 32) throw IllegalStateException(result.optString("error", "Pairing failed"))
        SecureStore.putSecret(this, "gateway_token", token)
        SecureStore.putText(this, "device_id", result.optString("device_id"))
        runOnUiThread { pairingCode.setText(""); setStatus("Paired securely. Next grant SMS permission and start the foreground service.") }
      } catch (e: Exception) { runOnUiThread { setStatus("Pairing failed: ${e.message?.take(150) ?: "network error"}") } }
    }
  }

  private fun saveConfig(base: String, key: String) {
    SecureStore.putText(this, "url", base)
    SecureStore.putText(this, "key", key)
  }

  private fun requestPermissionsAndStart() {
    if (SecureStore.getSecret(this, "gateway_token").isNullOrBlank()) { setStatus("Pair the gateway first."); return }
    val needed = mutableListOf(Manifest.permission.SEND_SMS)
    if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) needed.add(Manifest.permission.POST_NOTIFICATIONS)
    val request = needed.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
    if (request.isNotEmpty()) permissions.launch(request.toTypedArray()) else startGatewayService()
  }

  private fun startGatewayService() {
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
      setStatus("SMS permission is missing. The gateway cannot send real SMS."); return
    }
    val intent = Intent(this, SmsGatewayService::class.java).setAction(SmsGatewayService.ACTION_START)
    ContextCompat.startForegroundService(this, intent)
    setStatus("Gateway requested. Keep the persistent notification visible and disable battery optimisation for this test device if allowed.")
  }

  private fun postJson(url: String, key: String, token: String?, body: JSONObject): JSONObject {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.requestMethod = "POST"
    connection.connectTimeout = 12_000
    connection.readTimeout = 12_000
    connection.doOutput = true
    connection.setRequestProperty("content-type", "application/json")
    connection.setRequestProperty("apikey", key)
    if (!token.isNullOrBlank()) connection.setRequestProperty("authorization", "Bearer $token")
    connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
    val code = connection.responseCode
    val stream = if (code in 200..299) connection.inputStream else connection.errorStream
    val text = stream?.bufferedReader()?.use { it.readText() } ?: "{}"
    connection.disconnect()
    val json = JSONObject(text)
    if (code !in 200..299) throw IllegalStateException("HTTP $code: ${json.optString("error", "request failed")}")
    return json
  }

  private fun setStatus(message: String) { if (::status.isInitialized) status.text = message }

  companion object {
    private const val DEFAULT_SUPABASE_URL = "https://hzuovekqsjtpvmbuybxs.supabase.co"
    private const val DEFAULT_PUBLISHABLE_KEY = "sb_publishable_denBmNsOLdaEYPjFr4JxTA_XgElA64E"

    fun postGateway(context: android.content.Context, action: JSONObject): JSONObject {
      val base = SecureStore.getText(context, "url")
      val key = SecureStore.getText(context, "key")
      val token = SecureStore.getSecret(context, "gateway_token") ?: throw IllegalStateException("gateway token missing")
      if (base.isBlank() || key.isBlank()) throw IllegalStateException("gateway project config missing")
      val connection = URL("$base/functions/v1/server-gateway").openConnection() as HttpURLConnection
      connection.requestMethod = "POST"; connection.connectTimeout = 12_000; connection.readTimeout = 12_000; connection.doOutput = true
      connection.setRequestProperty("content-type", "application/json"); connection.setRequestProperty("apikey", key); connection.setRequestProperty("authorization", "Bearer $token")
      connection.outputStream.use { it.write(action.toString().toByteArray(Charsets.UTF_8)) }
      val code = connection.responseCode
      val stream = if (code in 200..299) connection.inputStream else connection.errorStream
      val text = stream?.bufferedReader()?.use { it.readText() } ?: "{}"
      connection.disconnect()
      if (code !in 200..299) throw IllegalStateException("Gateway API HTTP $code")
      return JSONObject(text)
    }
  }
}
