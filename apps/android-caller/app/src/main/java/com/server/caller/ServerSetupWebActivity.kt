package com.server.caller

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.telephony.SubscriptionInfo
import android.telephony.SubscriptionManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.util.UUID

/**
 * Hosts the same Server onboarding website with a narrowly-scoped Android SIM/permission bridge.
 * It exists for setup only; actual calls are routed through Android Telecom and the system dialer.
 */
class ServerSetupWebActivity : Activity() {
  private lateinit var web: WebView
  private val prefs by lazy { getSharedPreferences("server-session", Context.MODE_PRIVATE) }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    web = WebView(this).apply {
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = true
      settings.allowFileAccess = false
      settings.allowContentAccess = false
      settings.javaScriptCanOpenWindowsAutomatically = false
      addJavascriptInterface(Bridge(), "ServerAndroid")
      webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
          val uri = request?.url ?: return true
          val isTrustedHost = uri.scheme == "https" && uri.host == HOST
          val isTrustedPage = uri.path in setOf("/", "/index.html", "/terms.html", "/privacy.html")
          if (isTrustedHost && isTrustedPage) return false
          // Do not expose the native bridge to other sites or other Server pages.
          try { view?.removeJavascriptInterface("ServerAndroid") } catch (_: Exception) {}
          if (uri.scheme == "https" || uri.scheme == "http") {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
          }
          return true
        }
      }
    }
    setContentView(FrameLayout(this).apply { addView(web, FrameLayout.LayoutParams(-1, -1)) })
    loadBundledOnboarding()
  }

  /**
   * The phone's first-party site may still be on an older deployment. Bundle the
   * current HTML/CSS/JS in the APK so the SIM flow works immediately after the
   * website's "Open Server" hand-off, without depending on deployment propagation.
   */
  private fun loadBundledOnboarding() {
    val html = assets.open("server-web/index.html").bufferedReader().use { it.readText() }
    val css = assets.open("server-web/styles.css").bufferedReader().use { it.readText() }
    val js = assets.open("server-web/app.js").bufferedReader().use { it.readText() }
    var page = html
      .replace("""<link rel="stylesheet" href="styles.css">""", "<style>\n$css\n</style>")
      .replace("""<script defer src="app.js"></script>""", "<script>\n$js\n</script>")
      .replace("target=\"_blank\" rel=\"noopener\"", "target=\"_self\"")
    check(page.contains("native-setup") && page.contains("ServerAndroid")) {
      "Bundled Server onboarding HTML is missing the SIM-first bridge UI."
    }
    web.loadDataWithBaseURL("https://$HOST/", page, "text/html", "UTF-8", null)
  }

  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    when (requestCode) {
      REQUEST_SIM -> {
        val granted = hasSimPermissions()
        runJs("window.onServerSimPermissionResult && window.onServerSimPermissionResult($granted)")
      }
      REQUEST_CALL -> {
        val micGranted = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val notificationsGranted = Build.VERSION.SDK_INT < 33 ||
          checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        runJs("window.onServerCallPermissionResult && window.onServerCallPermissionResult($micGranted, $notificationsGranted)")
      }
    }
  }

  private fun runJs(script: String) {
    if (!::web.isInitialized) return
    runOnUiThread { web.evaluateJavascript(script, null) }
  }

  private fun hasSimPermissions(): Boolean =
    checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED &&
    checkSelfPermission(Manifest.permission.READ_PHONE_NUMBERS) == PackageManager.PERMISSION_GRANTED

  private fun simChoicesJson(): JSONObject {
    if (!hasSimPermissions()) return JSONObject().put("permissionNeeded", true).put("sims", JSONArray())
    @Suppress("DEPRECATION", "MissingPermission")
    val manager = getSystemService(TELEPHONY_SUBSCRIPTION_SERVICE) as SubscriptionManager
    @Suppress("DEPRECATION", "MissingPermission")
    val subscriptions = try { manager.activeSubscriptionInfoList.orEmpty().sortedBy { it.simSlotIndex } }
      catch (_: SecurityException) { emptyList() }
    val selectedId = prefs.getInt("selected_sim_subscription_id", -1)
    val rows = JSONArray()
    subscriptions.forEachIndexed { index, info ->
      val carrier = info.carrierName?.toString()?.trim().takeUnless { it.isNullOrBlank() } ?: "Unknown carrier"
      val phone = readPhoneNumber(manager, info)
      val slot = if (info.simSlotIndex >= 0) info.simSlotIndex + 1 else index + 1
      rows.put(JSONObject()
        .put("id", info.subscriptionId)
        .put("slot", slot)
        .put("carrier", carrier)
        .put("number", phone)
        .put("numberAvailable", phone.isNotBlank())
        .put("selected", info.subscriptionId == selectedId))
    }
    return JSONObject().put("permissionNeeded", false).put("sims", rows)
  }

  @Suppress("DEPRECATION", "MissingPermission")
  private fun readPhoneNumber(manager: SubscriptionManager, info: SubscriptionInfo): String =
    try {
      (if (Build.VERSION.SDK_INT >= 33) manager.getPhoneNumber(info.subscriptionId) else info.number)
        ?.trim().orEmpty().take(32)
    } catch (_: Exception) { "" }

  private fun chooseSim(subscriptionId: Int): Boolean {
    if (!hasSimPermissions()) return false
    @Suppress("DEPRECATION", "MissingPermission")
    val manager = getSystemService(TELEPHONY_SUBSCRIPTION_SERVICE) as SubscriptionManager
    @Suppress("DEPRECATION", "MissingPermission")
    val subs = try { manager.activeSubscriptionInfoList.orEmpty().sortedBy { it.simSlotIndex } }
      catch (_: SecurityException) { emptyList() }
    val info = subs.firstOrNull { it.subscriptionId == subscriptionId } ?: return false
    val slot = if (info.simSlotIndex >= 0) info.simSlotIndex else subs.indexOf(info)
    val carrier = info.carrierName?.toString()?.trim().takeUnless { it.isNullOrBlank() } ?: "Unknown carrier"
    val phone = readPhoneNumber(manager, info)
    prefs.edit()
      .putInt("selected_sim_subscription_id", info.subscriptionId)
      .putInt("selected_sim_slot", slot)
      .putString("selected_sim_carrier", carrier)
      .putString("selected_sim_phone", phone)
      .apply()
    return true
  }

  private fun registerDevice(acceptedTerms: Boolean): JSONObject {
    if (!acceptedTerms) return JSONObject().put("ok", false).put("error", "Accept the Terms and Privacy Notice first.")
    if (prefs.getInt("selected_sim_subscription_id", -1) < 0) {
      return JSONObject().put("ok", false).put("error", "Choose an active SIM before continuing.")
    }
    return try {
      val installationId = prefs.getString("installation_id", null)?.takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString()
      val deviceSecret = prefs.getString("device_secret", null)?.takeIf { it.matches(Regex("^[0-9a-f]{64}$")) }
        ?: ByteArray(32).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
      prefs.edit().putString("installation_id", installationId).putString("device_secret", deviceSecret).apply()

      val body = JSONObject()
        .put("action", "register_device")
        .put("installation_id", installationId)
        .put("device_secret", deviceSecret)
        .put("selected_sim_slot", prefs.getInt("selected_sim_slot", 0))
        .put("selected_sim_carrier", prefs.getString("selected_sim_carrier", "Unknown carrier"))
        .put("accepted_terms", true)
        .put("terms_version", "server-terms-1.0")
        .put("privacy_version", "server-privacy-1.0")
      val url = BuildConfig.SUPABASE_URL.trimEnd('/') + "/functions/v1/server-auth"
      val conn = (URL(url).openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"; connectTimeout = 15000; readTimeout = 20000; doOutput = true
        setRequestProperty("content-type", "application/json")
        setRequestProperty("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
      }
      val result = try {
        conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        val status = conn.responseCode
        val stream = if (status in 200..299) conn.inputStream else conn.errorStream
        val text = stream?.use { input -> BufferedReader(InputStreamReader(input)).readText() }.orEmpty()
        val json = try { JSONObject(text) } catch (_: Exception) { JSONObject() }
        if (status !in 200..299) {
          val reason = json.optString("message", json.optString("error", "HTTP $status"))
          return JSONObject().put("ok", false).put("error", reason)
        }
        json
      } finally { conn.disconnect() }

      val access = result.optString("access_token")
      val user = result.optJSONObject("user") ?: JSONObject()
      val serverId = user.optString("server_id")
      if (!access.matches(Regex("^[0-9a-f]{64}$")) || !serverId.matches(Regex("^SVR-[0-9A-F]{10}$"))) {
        return JSONObject().put("ok", false).put("error", "Server did not return a valid device session.")
      }
      val expires = try { java.time.Instant.parse(result.optString("expires_at")).epochSecond }
        catch (_: Exception) { System.currentTimeMillis() / 1000 + 30L * 24 * 60 * 60 }
      prefs.edit().putString("access_token", access).remove("refresh_token")
        .putLong("access_expiry", expires).putString("server_id", serverId).remove("phone").apply()
      val accountRegistered = try {
        ServerTelecomRegistry.register(this)
        true
      } catch (_: Exception) { false }
      JSONObject().put("ok", true).put("serverId", serverId)
        .put("phoneAccountRegistered", accountRegistered)
        .put("selectedSimNumber", prefs.getString("selected_sim_phone", "").orEmpty())
    } catch (e: Exception) {
      JSONObject().put("ok", false).put("error", e.message ?: "Device registration failed.")
    }
  }

  private inner class Bridge {
    @JavascriptInterface fun getSimChoices(): String = simChoicesJson().toString()

    @JavascriptInterface fun requestSimPermissions() {
      runOnUiThread {
        if (hasSimPermissions()) {
          val data = simChoicesJson().toString()
          runJs("window.onServerSimPermissionResult && window.onServerSimPermissionResult(true, $data)")
        } else {
          val needed = arrayListOf<String>()
          if (checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) needed.add(Manifest.permission.READ_PHONE_STATE)
          if (checkSelfPermission(Manifest.permission.READ_PHONE_NUMBERS) != PackageManager.PERMISSION_GRANTED) needed.add(Manifest.permission.READ_PHONE_NUMBERS)
          requestPermissions(needed.toTypedArray(), REQUEST_SIM)
        }
      }
    }

    @JavascriptInterface fun selectSim(subscriptionId: Int): Boolean = chooseSim(subscriptionId)

    @JavascriptInterface fun requestCallPermissions() {
      runOnUiThread {
        val needed = arrayListOf<String>()
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) needed.add(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
          needed.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (needed.isEmpty()) {
          val mic = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
          val notifications = Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
          runJs("window.onServerCallPermissionResult && window.onServerCallPermissionResult($mic, $notifications)")
        } else requestPermissions(needed.toTypedArray(), REQUEST_CALL)
      }
    }

    @JavascriptInterface fun completeSetup(acceptedTerms: Boolean) {
      Thread {
        val result = registerDevice(acceptedTerms)
        runJs("window.onServerSetupResult && window.onServerSetupResult($result)")
      }.start()
    }

    @JavascriptInterface fun openCallingSettings() {
      runOnUiThread {
        try { startActivity(Intent("android.telecom.action.CHANGE_PHONE_ACCOUNTS")) }
        catch (_: Exception) { runJs("window.onServerSettingsError && window.onServerSettingsError()") }
      }
    }

    @JavascriptInterface fun isCallingAccountEnabled(): Boolean =
      try { ServerTelecomRegistry.isEnabled(this@ServerSetupWebActivity) } catch (_: Exception) { false }

    @JavascriptInterface fun openPhoneDialer() {
      runOnUiThread {
        startActivity(Intent(Intent.ACTION_DIAL))
        finish()
      }
    }
  }

  companion object {
    private const val HOST = "server-onboarding-ochre.vercel.app"
    private const val REQUEST_SIM = 5101
    private const val REQUEST_CALL = 5102
  }
}
