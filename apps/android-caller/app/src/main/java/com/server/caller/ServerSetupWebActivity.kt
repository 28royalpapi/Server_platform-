package com.server.caller

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.EditText
import android.widget.Toast
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.util.UUID

/**
 * Hosts customer onboarding and an operator-only managed-gateway setup page.
 * Customer calling uses Android Telecom, microphone and notifications; only the
 * internal Server gateway mode accesses the system-default SMS subscription.
 */
class ServerSetupWebActivity : Activity() {
  private lateinit var web: WebView
  private var bundledJavaScript = ""
  private var onboardingBootstrapped = false
  private val prefs by lazy { getSharedPreferences("server-session", Context.MODE_PRIVATE) }

  override fun onResume() {
    super.onResume()
    if (prefs.getString("access_token", null)?.isNotBlank() == true) {
      ServerPushRegistration.syncFcmToken(this)
    }
    if (!::web.isInitialized || !prefs.getBoolean("server_open_dialer_after_account_enable", false)) return

    // The system Calling accounts screen is a mandatory user-consent boundary for a
    // system-managed ConnectionService. Once the user enables Server and returns,
    // continue directly to the ordinary dialer; never try to bypass the system toggle.
    val enabledState = try { ServerTelecomRegistry.enabledState(this) } catch (_: Exception) { null }
    if (enabledState == true || enabledState == null) {
      // On Android 8–14 the OS deliberately hides this account state from apps
      // without the protected phone-state permission. Do not request that permission just to inspect
      // the user's calling-account toggle; proceed to the dialer and let Telecom
      // expose Server as a choice if the user enabled it.
      ServerIncomingCallService.start(this)
      prefs.edit().putBoolean("server_open_dialer_after_account_enable", false).apply()
      web.post {
        if (isFinishing || isDestroyed) return@post
        val enabled = enabledState == true
        val known = enabledState != null
        web.evaluateJavascript("window.onServerCallingAccountStatus && window.onServerCallingAccountStatus($enabled, $known)", null)
        web.postDelayed({
          if (!isFinishing && !isDestroyed) {
            startActivity(Intent(Intent.ACTION_DIAL))
            finish()
          }
        }, 250)
      }
    } else {
      web.post {
        if (!isFinishing && !isDestroyed) {
          web.evaluateJavascript("window.onServerCallingAccountStatus && window.onServerCallingAccountStatus(false, true)", null)
        }
      }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    web = WebView(this).apply {
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = true
      settings.allowFileAccess = false
      settings.allowContentAccess = false
      settings.javaScriptCanOpenWindowsAutomatically = false
      addJavascriptInterface(Bridge(), "ServerAndroid")
      webChromeClient = object : WebChromeClient() {
        override fun onConsoleMessage(message: ConsoleMessage): Boolean {
          Log.w("ServerOnboardingWeb", "${message.message()} (line ${message.lineNumber()})")
          return true
        }
      }
      webViewClient = object : WebViewClient() {
        override fun onPageFinished(view: WebView?, url: String?) {
          super.onPageFinished(view, url)
          val target = view ?: return
          val path = Uri.parse(url.orEmpty()).path.orEmpty()
          if (url.isNullOrBlank() || !url.startsWith("https://$HOST/") ||
              path !in setOf("", "/", "/index.html") || onboardingBootstrapped) return
          onboardingBootstrapped = true
          // loadBundledOnboarding already includes app.js after the HTML body. Do not
          // evaluate it a second time: global `const` declarations would throw and
          // duplicate event listeners can leave setup state out of sync.
          target.evaluateJavascript(
            "(function(){var f=document.querySelector('.step-form');if(f)f.classList.add('hidden');var n=document.querySelector('#native-setup');if(n)n.classList.remove('hidden');})()",
            null
          )
        }
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
    val platformGatewayLaunch = intent?.data?.getQueryParameter("mode") == "platform-gateway"
    loadBundledOnboarding()
    if (platformGatewayLaunch) web.post { showPlatformGatewaySetupDialog() }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (intent.data?.getQueryParameter("mode") == "platform-gateway") {
      if (::web.isInitialized) web.post { showPlatformGatewaySetupDialog() }
    }
  }

  private fun showPlatformGatewaySetupDialog() {
    val codeInput = EditText(this).apply {
      hint = "32-character one-time code"
      singleLine = true
      inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
      filters = arrayOf(android.text.InputFilter.LengthFilter(32))
    }
    val dialog = AlertDialog.Builder(this)
      .setTitle("Server-managed SMS gateway")
      .setMessage("Internal setup for a physical handset and SIM owned or funded by Server. Do not use a personal phone or personal SIM. The app will automatically use Android's default SMS subscription; no SIM is selected inside Server.")
      .setView(codeInput)
      .setNegativeButton("Cancel", null)
      .setPositiveButton("Register handset", null)
      .create()
    dialog.setOnShowListener {
      dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
        val code = codeInput.text.toString().trim().lowercase()
        if (!Regex("^[0-9a-f]{32}$").matches(code)) {
          Toast.makeText(this, "Enter the valid 32-character pairing code.", Toast.LENGTH_LONG).show()
        } else {
          dialog.dismiss()
          beginPlatformGatewayClaim(code)
        }
      }
    }
    dialog.show()
  }

  private fun showPlatformGatewayResult(title: String, message: String) {
    runOnUiThread {
      if (isFinishing || isDestroyed) return@runOnUiThread
      AlertDialog.Builder(this)
        .setTitle(title)
        .setMessage(message)
        .setPositiveButton("Done", null)
        .show()
    }
  }

  /**
   * Bundle the current website HTML/CSS/JS in the APK so the onboarding flow stays
   * consistent when the native permission bridge is opened.
   */
  private fun loadBundledOnboarding() {
    val html = assets.open("server-web/index.html").bufferedReader().use { it.readText() }
    val css = assets.open("server-web/styles.css").bufferedReader().use { it.readText() }
    bundledJavaScript = assets.open("server-web/app.js").bufferedReader().use { it.readText() }
    var page = html
      .replace("<head>", "<head>\n<meta name=\"server-native-bridge\" content=\"true\">")
      .replace("""<link rel="stylesheet" href="styles.css">""", "<style>\n$css\n</style>")
      .replace("""<script defer src="app.js"></script>""", "")
      .replace("target=\"_blank\" rel=\"noopener\"", "target=\"_self\"")
    // app.js was a deferred external script. Reinsert it after the body content so
    // native permission and account-creation controls receive their event handlers.
    val inlineScript = "<script>\n" + bundledJavaScript + "\n</script>"
    page = page.replace("</body>", inlineScript + "\n</body>")
    check(page.contains("native-setup") && page.contains("server-native-bridge") &&
      page.indexOf("id=\"native-setup\"") > page.indexOf("<body>") &&
      page.indexOf(inlineScript) > page.indexOf("id=\"native-setup\"")) {
      "Bundled Server onboarding HTML is missing the native calling bridge UI or app.js script."
    }
    web.loadDataWithBaseURL("https://$HOST/", page, "text/html", "UTF-8", null)
  }

  private var pendingSmsGatewayOption: ServerSmsGatewaySim? = null
  private var pendingPlatformGatewayPairingCode: String = ""

  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    when (requestCode) {
      REQUEST_CALL -> {
        val micGranted = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val notificationsGranted = Build.VERSION.SDK_INT < 33 ||
          checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val contactsGranted = checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED
        runJs("window.onServerCallPermissionResult && window.onServerCallPermissionResult($micGranted, $notificationsGranted, false, $contactsGranted)")
      }
      REQUEST_SMS_SIM_OPTIONS -> {
        val phoneStateGranted = checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED
        val smsGranted = checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED
        val notificationsGranted = Build.VERSION.SDK_INT < 33 ||
          checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val result = when {
          !phoneStateGranted -> JSONObject().put("ok", false).put("error", "SIM_PERMISSION_DENIED")
          !smsGranted -> JSONObject().put("ok", false).put("error", "SMS_PERMISSION_DENIED")
          !notificationsGranted -> JSONObject().put("ok", false).put("error", "GATEWAY_NOTIFICATION_PERMISSION_DENIED")
          else -> ServerSmsGatewayManager.optionsJson(this)
        }
        callbackToWebsite("onServerSmsGatewaySimOptions", result)
      }
      REQUEST_PLATFORM_GATEWAY -> {
        val phoneStateGranted = checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED
        val smsGranted = checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED
        val notificationsGranted = Build.VERSION.SDK_INT < 33 ||
          checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val pairingCode = pendingPlatformGatewayPairingCode
        pendingPlatformGatewayPairingCode = ""
        if (pairingCode.isBlank()) {
          showPlatformGatewayResult("Pairing code missing", "Open the managed gateway setup again and enter the one-time code.")
        } else if (!phoneStateGranted || !smsGranted || !notificationsGranted) {
          showPlatformGatewayResult("Android permissions required", "The Server-managed handset needs SMS, phone-state and notification permissions to operate as the platform gateway.")
        } else {
          claimPlatformGatewayWithDefaultSmsSubscription(pairingCode)
        }
      }
    }
  }

  private fun beginPlatformGatewayClaim(pairingCode: String) {
    pendingPlatformGatewayPairingCode = pairingCode
    val required = mutableListOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.SEND_SMS)
    if (Build.VERSION.SDK_INT >= 33) required.add(Manifest.permission.POST_NOTIFICATIONS)
    val missing = required.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
    if (missing.isNotEmpty()) {
      requestPermissions(missing.toTypedArray(), REQUEST_PLATFORM_GATEWAY)
    } else {
      pendingPlatformGatewayPairingCode = ""
      claimPlatformGatewayWithDefaultSmsSubscription(pairingCode)
    }
  }

  private fun claimPlatformGatewayWithDefaultSmsSubscription(pairingCode: String) {
    val sim = ServerSmsGatewayManager.defaultSmsSim(this)
    if (sim == null) {
      showPlatformGatewayResult("Default SMS SIM not set", "Set Android's system default SMS subscription on this Server-managed handset, then open the setup link again.")
      return
    }
    Thread {
      val result = try {
        ServerSmsGatewayApi.claimPlatformDevice(this, pairingCode, sim.subscriptionId, sim.slotIndex, sim.carrier)
      } catch (_: Exception) {
        JSONObject().put("ok", false).put("error", "PLATFORM_GATEWAY_PAIRING_UNAVAILABLE")
      }
      if (!result.optBoolean("ok")) {
        showPlatformGatewayResult("Gateway pairing failed", result.optString("error", "The one-time pairing could not be used."))
        return@Thread
      }
      val token = result.optString("gateway_token")
      val deviceId = result.optString("device_id")
      if (!token.matches(Regex("^[0-9a-f]{64}$")) || deviceId.isBlank()) {
        showPlatformGatewayResult("Gateway registration failed", "The registration response was invalid. Ask an operator to review the gateway record.")
        return@Thread
      }
      try {
        ServerSmsGatewaySecureStore.save(this, token, deviceId, sim.subscriptionId, sim.label)
        val serviceIntent = Intent(this, ServerSmsGatewayService::class.java).setAction(ServerSmsGatewayService.ACTION_START)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(serviceIntent) else startService(serviceIntent)
        var online = false
        var lastSeenAt = ""
        for (attempt in 0 until 10) {
          Thread.sleep(500)
          val status = try { ServerSmsGatewayApi.status(this) } catch (_: Exception) { JSONObject() }
          lastSeenAt = status.optString("last_seen_at")
          val lastSeenMs = try { java.time.Instant.parse(lastSeenAt).toEpochMilli() } catch (_: Exception) { 0L }
          if (status.optBoolean("enabled") && lastSeenMs > 0L && System.currentTimeMillis() - lastSeenMs <= 90_000L) {
            online = true
            break
          }
        }
        showPlatformGatewayResult(
          if (online) "Gateway registered and online" else "Gateway registered; heartbeat pending",
          "Device: $deviceId\\nCarrier: ${sim.carrier}\\n" +
            if (online) "Server-managed SMS gateway is online. Keep this handset powered and connected."
            else "The device record is created. Keep this Server-managed handset powered and connected while it sends its first heartbeat."
        )
      } catch (_: Exception) {
        showPlatformGatewayResult("Gateway service did not start", "The device record was created, but Android did not start the SMS service. Review permissions and battery settings on this Server-managed handset.")
      }
    }.start()
  }

  private fun completeSmsGatewayConnect(option: ServerSmsGatewaySim) {
    Thread {
      val access = prefs.getString("access_token", null).orEmpty()
      val result = if (!Regex("^[0-9a-f]{64}$").matches(access)) {
        JSONObject().put("ok", false).put("error", "SESSION_REQUIRED")
      } else {
        try { ServerSmsGatewayApi.registerDevice(this, access, option.subscriptionId, option.slotIndex, option.carrier) }
        catch (_: Exception) { JSONObject().put("ok", false).put("error", "GATEWAY_REGISTRATION_FAILED") }
      }
      if (!result.optBoolean("ok")) {
        callbackToWebsite("onServerSmsGatewayResult", result)
        return@Thread
      }
      val token = result.optString("gateway_token")
      val deviceId = result.optString("device_id")
      if (!token.matches(Regex("^[0-9a-f]{64}$")) || deviceId.isBlank()) {
        callbackToWebsite("onServerSmsGatewayResult", JSONObject().put("ok", false).put("error", "GATEWAY_REGISTRATION_INVALID"))
        return@Thread
      }
      try {
        ServerSmsGatewaySecureStore.save(this, token, deviceId, option.subscriptionId, option.label)
        startForegroundService(Intent(this, ServerSmsGatewayService::class.java).setAction(ServerSmsGatewayService.ACTION_START))
        var heartbeatConfirmed = false
        var lastSeenAt = ""
        for (attempt in 0 until 10) {
          Thread.sleep(500)
          val status = try { ServerSmsGatewayApi.status(this) } catch (_: Exception) { JSONObject() }
          lastSeenAt = status.optString("last_seen_at")
          val lastSeenMs = try { java.time.Instant.parse(lastSeenAt).toEpochMilli() } catch (_: Exception) { 0L }
          if (status.optBoolean("enabled") && lastSeenMs > 0L && System.currentTimeMillis() - lastSeenMs <= 90_000L) {
            heartbeatConfirmed = true
            break
          }
        }
        if (!heartbeatConfirmed) {
          try { stopService(Intent(this, ServerSmsGatewayService::class.java).setAction(ServerSmsGatewayService.ACTION_STOP)) } catch (_: Exception) {}
          try { ServerSmsGatewayApi.disconnect(this, access, deviceId) } catch (_: Exception) {}
          ServerSmsGatewaySecureStore.clear(this)
          callbackToWebsite("onServerSmsGatewayResult", JSONObject().put("ok", false).put("error", "GATEWAY_HEARTBEAT_NOT_CONFIRMED"))
          return@Thread
        }
        callbackToWebsite("onServerSmsGatewayResult", JSONObject()
          .put("ok", true).put("connected", true).put("device_id", deviceId)
          .put("subscription_id", option.subscriptionId).put("slot_index", option.slotIndex)
          .put("carrier", option.carrier).put("label", option.label)
          .put("last_seen_at", lastSeenAt)
          .put("message", "Your selected SIM is connected and registered with Server."))
      } catch (_: Exception) {
        try { ServerSmsGatewayApi.disconnect(this, access, deviceId) } catch (_: Exception) {}
        ServerSmsGatewaySecureStore.clear(this)
        callbackToWebsite("onServerSmsGatewayResult", JSONObject().put("ok", false).put("error", "GATEWAY_START_FAILED"))
      }
    }.start()
  }

  private fun refreshSmsGatewayStatusNative() {
    Thread {
      val token = ServerSmsGatewaySecureStore.token(this)
      if (token.isNullOrBlank()) {
        callbackToWebsite("onServerSmsGatewayStatus", JSONObject().put("ok", true).put("connected", false))
        return@Thread
      }
      val status = try { ServerSmsGatewayApi.status(this) }
        catch (_: Exception) { JSONObject().put("ok", false).put("error", "GATEWAY_STATUS_UNAVAILABLE") }
      val lastSeen = try { java.time.Instant.parse(status.optString("last_seen_at")).toEpochMilli() }
        catch (_: Exception) { 0L }
      val connected = status.optBoolean("enabled") &&
        lastSeen > 0L && System.currentTimeMillis() - lastSeen <= 90_000L
      val result = JSONObject()
        .put("ok", true).put("connected", connected)
        .put("label", ServerSmsGatewaySecureStore.label(this))
        .put("device_id", ServerSmsGatewaySecureStore.deviceId(this))
        .put("last_seen_at", status.optString("last_seen_at"))
      callbackToWebsite("onServerSmsGatewayStatus", result)
    }.start()
  }

  private fun runJs(script: String) {
    if (!::web.isInitialized) return
    runOnUiThread { web.evaluateJavascript(script, null) }
  }

  /**
   * Calls Server's custom auth endpoint. A publishable key is always sent;
   * a private device-session bearer is sent only for operations that need it.
   * Never write the OTP, bearer, or full response to logs.
   */
  private fun requestServerAuth(body: JSONObject, accessToken: String? = null): JSONObject {
    val url = BuildConfig.SUPABASE_URL.trimEnd('/') + "/functions/v1/server-auth"
    val conn = (URL(url).openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      connectTimeout = 15000
      readTimeout = 20000
      doOutput = true
      setRequestProperty("content-type", "application/json")
      setRequestProperty("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
      if (!accessToken.isNullOrBlank()) setRequestProperty("x-server-session-token", accessToken)
    }
    return try {
      conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
      val status = conn.responseCode
      val stream = if (status in 200..299) conn.inputStream else conn.errorStream
      val text = stream?.use { input -> BufferedReader(InputStreamReader(input)).readText() }.orEmpty()
      val result = try { JSONObject(text) } catch (_: Exception) { JSONObject() }
      if (status !in 200..299) {
        if (result.optString("error").isBlank()) result.put("error", "HTTP_$status")
        result.put("ok", false)
      }
      result.put("http_status", status)
    } finally {
      conn.disconnect()
    }
  }

  private fun requestServerGateway(body: JSONObject, accessToken: String): JSONObject {
    val url = BuildConfig.SUPABASE_URL.trimEnd('/') + "/functions/v1/server-gateway"
    val conn = (URL(url).openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      connectTimeout = 15000
      readTimeout = 20000
      doOutput = true
      setRequestProperty("content-type", "application/json")
      setRequestProperty("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
      setRequestProperty("x-server-session-token", accessToken)
    }
    return try {
      conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
      val status = conn.responseCode
      val stream = if (status in 200..299) conn.inputStream else conn.errorStream
      val response = stream?.use { input -> BufferedReader(InputStreamReader(input)).readText() }.orEmpty()
      val result = try { JSONObject(response) } catch (_: Exception) { JSONObject() }
      if (status !in 200..299) {
        if (result.optString("error").isBlank()) result.put("error", "HTTP_" + status)
        result.put("ok", false)
      }
      result.put("http_status", status)
    } finally {
      conn.disconnect()
    }
  }

  private fun callbackToWebsite(name: String, result: JSONObject) {
    runJs("window.$name && window.$name($result)")
  }

  private fun registerDevice(displayName: String, acceptedTerms: Boolean): JSONObject {
    val normalizedDisplayName = displayName.trim().replace(Regex("\\s+"), " ")
    if (normalizedDisplayName.length !in 2..60 || normalizedDisplayName.any { it.isISOControl() || it == '<' || it == '>' }) {
      return JSONObject().put("ok", false).put("error", "Enter a caller name between 2 and 60 characters.")
    }
    if (!acceptedTerms) return JSONObject().put("ok", false).put("error", "Accept the Terms and Privacy Notice first.")
    return try {
      val installationId = prefs.getString("installation_id", null)?.takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString()
      val deviceSecret = prefs.getString("device_secret", null)?.takeIf { it.matches(Regex("^[0-9a-f]{64}$")) }
        ?: ByteArray(32).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
      prefs.edit().putString("installation_id", installationId).putString("device_secret", deviceSecret).apply()

      val body = JSONObject()
        .put("action", "register_device")
        .put("display_name", normalizedDisplayName)
        .put("installation_id", installationId)
        .put("device_secret", deviceSecret)
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
        .putLong("access_expiry", expires).putString("server_id", serverId)
        .putString("display_name", normalizedDisplayName).remove("phone").apply()
      // Fetch/register the FCM endpoint immediately after the first Server
      // session exists. onNewToken may have fired before sign-in and correctly
      // deferred registration at that time.
      ServerPushRegistration.syncFcmToken(this)
      val accountRegistered = try {
        ServerTelecomRegistry.register(this)
        true
      } catch (_: Exception) { false }
      JSONObject().put("ok", true).put("serverId", serverId)
        .put("phoneAccountRegistered", accountRegistered)
    } catch (e: Exception) {
      JSONObject().put("ok", false).put("error", e.message ?: "Device registration failed.")
    }
  }

  private inner class Bridge {
    @JavascriptInterface fun requestCallPermissions() {
      runOnUiThread {
        val needed = arrayListOf<String>()
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) needed.add(Manifest.permission.RECORD_AUDIO)
        if (checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) needed.add(Manifest.permission.READ_CONTACTS)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
          needed.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (needed.isEmpty()) {
          val mic = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
          val notifications = Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
          val contacts = checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED
          runJs("window.onServerCallPermissionResult && window.onServerCallPermissionResult($mic, $notifications, false, $contacts)")
        } else requestPermissions(needed.toTypedArray(), REQUEST_CALL)
      }
    }

    @JavascriptInterface fun normalizePhoneNumber(raw: String): String =
      ServerPhoneNumberNormalizer.toE164(
        raw,
        ServerPhoneNumberNormalizer.deviceRegion(this@ServerSetupWebActivity)
      ).orEmpty()

    @JavascriptInterface fun completeSetup(displayName: String, acceptedTerms: Boolean) {
      Thread {
        val result = registerDevice(displayName, acceptedTerms)
        runJs("window.onServerSetupResult && window.onServerSetupResult($result)")
      }.start()
    }

    @JavascriptInterface fun requestSmsGatewaySimOptions() {
      runOnUiThread {
        val required = mutableListOf(
          Manifest.permission.READ_PHONE_STATE,
          Manifest.permission.SEND_SMS
        )
        if (Build.VERSION.SDK_INT >= 33) required.add(Manifest.permission.POST_NOTIFICATIONS)
        val missing = required.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) {
          requestPermissions(missing.toTypedArray(), REQUEST_SMS_SIM_OPTIONS)
        } else {
          callbackToWebsite("onServerSmsGatewaySimOptions", ServerSmsGatewayManager.optionsJson(this@ServerSetupWebActivity))
        }
      }
    }

    @JavascriptInterface fun connectSmsGateway(subscriptionId: Int) {
      runOnUiThread {
        val missing = checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED ||
          checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED ||
          (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
        if (missing) {
          callbackToWebsite("onServerSmsGatewayResult", JSONObject().put("ok", false).put("error", "GATEWAY_PERMISSIONS_REQUIRED"))
          return@runOnUiThread
        }
        val option = ServerSmsGatewayManager.resolve(this@ServerSetupWebActivity, subscriptionId)
        if (option == null) {
          callbackToWebsite("onServerSmsGatewayResult", JSONObject().put("ok", false).put("error", "SELECTED_SIM_UNAVAILABLE"))
          return@runOnUiThread
        }
        completeSmsGatewayConnect(option)
      }
    }

    @JavascriptInterface fun disconnectSmsGateway() {
      Thread {
        val access = prefs.getString("access_token", null).orEmpty()
        val deviceId = ServerSmsGatewaySecureStore.deviceId(this@ServerSetupWebActivity)
        val serverResult = if (access.matches(Regex("^[0-9a-f]{64}$")) && deviceId.isNotBlank()) {
          try { ServerSmsGatewayApi.disconnect(this@ServerSetupWebActivity, access, deviceId) }
          catch (_: Exception) { JSONObject().put("ok", false).put("error", "GATEWAY_DISCONNECT_UNAVAILABLE") }
        } else JSONObject().put("ok", true)
        stopService(Intent(this@ServerSetupWebActivity, ServerSmsGatewayService::class.java).setAction(ServerSmsGatewayService.ACTION_STOP))
        ServerSmsGatewaySecureStore.clear(this@ServerSetupWebActivity)
        callbackToWebsite("onServerSmsGatewayResult", JSONObject()
          .put("ok", serverResult.optBoolean("ok", false))
          .put("connected", false)
          .put("message", "The selected SIM has been disconnected from Server."))
      }.start()
    }

    @JavascriptInterface fun refreshSmsGatewayStatus() {
      refreshSmsGatewayStatusNative()
    }

    @JavascriptInterface fun requestPhoneLinkOtp(rawPhone: String) {
      Thread {
        val to = rawPhone.trim()
        val access = prefs.getString("access_token", null).orEmpty()
        val result = when {
          !Regex("^\\+[1-9][0-9]{7,14}$").matches(to) ->
            JSONObject().put("ok", false).put("error", "INVALID_PHONE_FORMAT")
          !Regex("^[0-9a-f]{64}$").matches(access) ->
            JSONObject().put("ok", false).put("error", "SESSION_REQUIRED")
          else -> try {
            requestServerAuth(JSONObject().put("action", "request_otp").put("phone", to), access)
          } catch (_: Exception) {
            JSONObject().put("ok", false).put("error", "OTP_REQUEST_UNAVAILABLE")
          }
        }
        callbackToWebsite("onServerPhoneOtpRequested", result)
      }.start()
    }

    @JavascriptInterface fun verifyAndLinkPhone(rawPhone: String, rawCode: String, allowNumberCalls: Boolean) {
      Thread {
        val to = rawPhone.trim()
        val code = rawCode.trim()
        val access = prefs.getString("access_token", null).orEmpty()
        val result = when {
          !Regex("^\\+[1-9][0-9]{7,14}$").matches(to) ->
            JSONObject().put("ok", false).put("error", "INVALID_PHONE_FORMAT")
          !Regex("^[0-9]{6}$").matches(code) ->
            JSONObject().put("ok", false).put("error", "INVALID_CODE_FORMAT")
          !Regex("^[0-9a-f]{64}$").matches(access) ->
            JSONObject().put("ok", false).put("error", "SESSION_REQUIRED")
          else -> try {
            requestServerAuth(
              JSONObject().put("action", "link_phone").put("phone", to).put("code", code).put("allow_number_based_server_calls", allowNumberCalls),
              access
            )
          } catch (_: Exception) {
            JSONObject().put("ok", false).put("error", "PHONE_LINK_UNAVAILABLE")
          }
        }
        if (result.optBoolean("ok")) {
          prefs.edit().putBoolean("server_phone_number_linked", true)
            .putString("server_linked_phone", result.optString("phone", to))
            .putBoolean("allow_number_based_server_calls", result.optBoolean("allow_number_based_server_calls", allowNumberCalls)).apply()
          try { ServerTelecomRegistry.register(this@ServerSetupWebActivity) } catch (_: Exception) {}
        }
        callbackToWebsite("onServerPhoneLinkResult", result)
      }.start()
    }

    @JavascriptInterface fun getNumberCallPreferences(): String = JSONObject()
      .put("phoneLinked", prefs.getBoolean("server_phone_number_linked", false))
      .put("phone", prefs.getString("server_linked_phone", "").orEmpty())
      .put("allowNumberCalls", prefs.getBoolean("allow_number_based_server_calls", false)).toString()

    @JavascriptInterface fun setNumberCallConsent(allowNumberCalls: Boolean) {
      Thread {
        val access = prefs.getString("access_token", null).orEmpty()
        val result = if (!Regex("^[0-9a-f]{64}$").matches(access)) {
          JSONObject().put("ok", false).put("error", "SESSION_REQUIRED")
        } else {
          try { requestServerAuth(JSONObject().put("action", "set_number_call_consent").put("allow_number_based_server_calls", allowNumberCalls), access) }
          catch (_: Exception) { JSONObject().put("ok", false).put("error", "NUMBER_CALL_CONSENT_SAVE_FAILED") }
        }
        if (result.optBoolean("ok")) {
          prefs.edit().putBoolean("allow_number_based_server_calls", result.optBoolean("allow_number_based_server_calls", allowNumberCalls)).apply()
          try { ServerTelecomRegistry.register(this@ServerSetupWebActivity) } catch (_: Exception) {}
        }
        callbackToWebsite("onServerNumberCallConsentResult", result)
      }.start()
    }

    @JavascriptInterface fun openCallingSettings() {
      runOnUiThread {
        try {
          try {
            // Register before opening system settings; otherwise there is no Server account to enable.
            ServerTelecomRegistry.register(this@ServerSetupWebActivity)
          } catch (_: Exception) {
            runJs("window.onServerSettingsError && window.onServerSettingsError()")
            return@runOnUiThread
          }
          if (ServerTelecomRegistry.enabledState(this@ServerSetupWebActivity) == true) {
            ServerIncomingCallService.start(this@ServerSetupWebActivity)
            prefs.edit().putBoolean("server_open_dialer_after_account_enable", false).apply()
            startActivity(Intent(Intent.ACTION_DIAL))
            finish()
            return@runOnUiThread
          }
          prefs.edit().putBoolean("server_open_dialer_after_account_enable", true).apply()
          startActivity(Intent("android.telecom.action.CHANGE_PHONE_ACCOUNTS"))
        } catch (_: Exception) {
          prefs.edit().putBoolean("server_open_dialer_after_account_enable", false).apply()
          runJs("window.onServerSettingsError && window.onServerSettingsError()")
        }
      }
    }

    @JavascriptInterface fun isCallingAccountEnabled(): Boolean =
      try { ServerTelecomRegistry.enabledState(this@ServerSetupWebActivity) == true } catch (_: Exception) { false }

    @JavascriptInterface fun openPhoneDialer() {
      runOnUiThread {
        ServerIncomingCallService.start(this@ServerSetupWebActivity)
        startActivity(Intent(Intent.ACTION_DIAL))
        finish()
      }
    }
  }

  private fun isRunningOnEmulator(): Boolean =
    Build.FINGERPRINT.startsWith("generic") ||
      Build.FINGERPRINT.startsWith("unknown") ||
      Build.MODEL.contains("Emulator", ignoreCase = true) ||
      Build.MODEL.contains("Android SDK built for", ignoreCase = true) ||
      Build.HARDWARE.contains("goldfish", ignoreCase = true) ||
      Build.HARDWARE.contains("ranchu", ignoreCase = true) ||
      Build.PRODUCT.contains("sdk", ignoreCase = true)

  companion object {
    private const val HOST = "server-onboarding-ochre.vercel.app"
    private const val REQUEST_CALL = 5102
    private const val REQUEST_SMS_SIM_OPTIONS = 5103
    private const val REQUEST_PLATFORM_GATEWAY = 5104
  }
}
