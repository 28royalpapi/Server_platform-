package com.server.caller

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.ContactsContract
import android.telecom.Connection
import android.telecom.PhoneAccount
import android.telecom.TelecomManager
import android.util.Log
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.StaleObjectException
import androidx.test.uiautomator.Until
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class CallerSmokeTest {
  @Test fun incomingServerCallPostsNativeCallStyleAlertWithRingtoneAndDndSettings() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    if (android.os.Build.VERSION.SDK_INT >= 33) {
      try {
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
      } catch (_: Exception) {}
      assertEquals("Incoming call alerts need notification permission",
        android.content.pm.PackageManager.PERMISSION_GRANTED,
        context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS))
    }

    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
    val callId = "notification-" + UUID.randomUUID().toString()
    val notificationId = ServerCallNotifications.notificationId(callId)
    val prefs = context.getSharedPreferences("server-session", Context.MODE_PRIVATE)
    val previousToken = prefs.getString("access_token", null)
    val needsCallStyleForegroundService = android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S
    if (needsCallStyleForegroundService) {
      val handle = ServerTelecomRegistry.handle(context)
      ServerTelecomRegistry.register(context)
      enablePhoneAccountWithTestShell(context, handle)
      val accountDeadline = System.currentTimeMillis() + 12_000
      while (!ServerTelecomRegistry.isEnabled(context) && System.currentTimeMillis() < accountDeadline) {
        Thread.sleep(100)
      }
      assertTrue("The Server PhoneAccount must be enabled before testing an incoming foreground call",
        ServerTelecomRegistry.isEnabled(context))
      prefs.edit().putString("access_token", "0".repeat(64)).commit()
    }
    try {
      if (needsCallStyleForegroundService) {
        // Match the live signed-in path: incoming CallStyle notifications are
        // posted while ServerIncomingCallService is running as a phoneCall FGS.
        ServerIncomingCallService.start(context)
        val foregroundDeadline = System.currentTimeMillis() + 8_000
        var foregroundCallListener = false
        while (!foregroundCallListener && System.currentTimeMillis() < foregroundDeadline) {
          foregroundCallListener = manager.activeNotifications.any {
            it.notification.channelId == "server-incoming-calls"
          }
          if (!foregroundCallListener) Thread.sleep(100)
        }
        assertTrue("Server's phoneCall foreground service must start before posting CallStyle",
          foregroundCallListener)
      }
      ServerCallNotifications.show(context, callId, "SVR-12AB34CD56")
      val notificationDeadline = System.currentTimeMillis() + 8_000
      var posted = manager.activeNotifications.firstOrNull {
        it.id == notificationId && it.notification.channelId == ServerCallNotifications.CHANNEL_ID
      }
      while (posted == null && System.currentTimeMillis() < notificationDeadline) {
        Thread.sleep(100)
        posted = manager.activeNotifications.firstOrNull {
          it.id == notificationId && it.notification.channelId == ServerCallNotifications.CHANNEL_ID
        }
      }
      assertNotNull("An incoming Server call must post a native ringing notification", posted)
      // CallStyle retains CATEGORY_CALL. Confirm the independent foreground-service
      // association via FLAG_FOREGROUND_SERVICE instead of inheriting the listener's
      // CATEGORY_SERVICE notification metadata.
      assertEquals("Incoming Server alerts must retain the native call notification category",
        android.app.Notification.CATEGORY_CALL, posted!!.notification.category)
      if (needsCallStyleForegroundService) {
        assertTrue("Incoming Server CallStyle must be backed by its dedicated phoneCall foreground service",
          (posted.notification.flags and android.app.Notification.FLAG_FOREGROUND_SERVICE) != 0)
      }
      assertEquals("The incoming call must use its dedicated ringtone channel", ServerCallNotifications.CHANNEL_ID,
        posted.notification.channelId)

      val channel = manager.getNotificationChannel(ServerCallNotifications.CHANNEL_ID)
      assertNotNull("The incoming-call ringtone channel was not created", channel)
      assertEquals("Incoming Server calls need high notification importance",
        android.app.NotificationManager.IMPORTANCE_HIGH, channel!!.importance)
      assertEquals("The channel must use the system's default ringtone",
        android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_RINGTONE), channel.sound)
      assertTrue("The incoming-call channel must support vibration", channel.shouldVibrate())
      assertFalse("Server must never bypass the user's Do Not Disturb settings", channel.canBypassDnd())

      if (android.os.Build.VERSION.SDK_INT >= 34) {
        assertEquals("Android 14+ must receive the incoming CallStyle type",
          android.app.Notification.CallStyle.CALL_TYPE_INCOMING,
          posted.notification.extras.getInt(android.app.Notification.EXTRA_CALL_TYPE,
            android.app.Notification.CallStyle.CALL_TYPE_UNKNOWN))
      }

      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
        ServerCallNotifications.silence(context, callId, "SVR-12AB34CD56")
        val silenceDeadline = System.currentTimeMillis() + 8_000
        var silenced = manager.activeNotifications.firstOrNull { it.id == notificationId }
        while ((silenced == null || silenced.notification.channelId != ServerCallNotifications.SILENT_CHANNEL_ID) &&
          System.currentTimeMillis() < silenceDeadline) {
          Thread.sleep(100)
          silenced = manager.activeNotifications.firstOrNull { it.id == notificationId }
        }
        assertNotNull("Silencing the ringtone must retain the incoming call notification", silenced)
        assertEquals("Silencing must move the visible call to the silent notification channel",
          ServerCallNotifications.SILENT_CHANNEL_ID, silenced!!.notification.channelId)
        assertTrue("Silence action must suppress repeat ringtone alerts",
          (silenced.notification.flags and android.app.Notification.FLAG_ONLY_ALERT_ONCE) != 0)
        val silentChannel = manager.getNotificationChannel(ServerCallNotifications.SILENT_CHANNEL_ID)
        assertNotNull("The silent incoming-call channel was not created", silentChannel)
        assertEquals("Silenced calls must not play a ringtone", null, silentChannel!!.sound)
        assertFalse("Silenced calls must not vibrate", silentChannel.shouldVibrate())
      }
    } finally {
      ServerCallNotifications.cancel(context, callId)
      if (needsCallStyleForegroundService) ServerIncomingCallService.stop(context)
      if (needsCallStyleForegroundService) {
        val restore = prefs.edit()
        if (previousToken == null) restore.remove("access_token") else restore.putString("access_token", previousToken)
        restore.commit()
      }
    }
  }

  @Test fun missedServerCallNotificationOffersQuietCallbackAction() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    if (android.os.Build.VERSION.SDK_INT >= 33) {
      try {
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
      } catch (_: Exception) {}
      assertEquals("Missed-call alerts need notification permission",
        android.content.pm.PackageManager.PERMISSION_GRANTED,
        context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS))
    }

    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
    val callId = "missed-" + UUID.randomUUID().toString()
    val notificationId = 7600 + (callId.hashCode() and 0x0000FFFF)
    try {
      assertTrue("Missed-call notification should be accepted when notification permission is granted",
        ServerCallNotifications.showMissed(context, callId, "SVR-12AB34CD56"))
      val notificationDeadline = System.currentTimeMillis() + 5_000
      var posted = manager.activeNotifications.firstOrNull { it.id == notificationId }
      while (posted == null && System.currentTimeMillis() < notificationDeadline) {
        Thread.sleep(100)
        posted = manager.activeNotifications.firstOrNull { it.id == notificationId }
      }
      assertNotNull("A call missed while offline must appear after reconnect", posted)
      assertEquals("The notification must be categorised as a missed call",
        android.app.Notification.CATEGORY_MISSED_CALL, posted!!.notification.category)
      assertTrue("The missed-call notification must offer a Call back action",
        posted.notification.actions.any { it.title.toString() == "Call back" })
      val channel = manager.getNotificationChannel(posted.notification.channelId)
      assertNotNull("The quiet missed-call channel was not created", channel)
      assertEquals("Missed-call alerts must not ring",
        android.app.NotificationManager.IMPORTANCE_DEFAULT, channel!!.importance)
      assertEquals("Missed-call alerts must be silent", null, channel.sound)
      assertFalse("Missed-call alerts must not vibrate", channel.shouldVibrate())

      val callback = ServerCallNotifications.buildMissedCallIntent(context, callId, "SVR-12AB34CD56")
      assertEquals("missed_callback", callback.getStringExtra("server_action"))
      assertEquals("SVR-12AB34CD56", callback.getStringExtra("server_caller_id"))
    } finally {
      manager.cancel(notificationId)
    }
  }

  @Test fun serverCallUsesInternetCapabilityWithoutCarrierValidationFalseNegatives() {
    assertFalse("No active network must block Server internet calling",
      isServerInternetUsable(false, false))
    assertFalse("A connected transport without INTERNET capability must not start a Server call",
      isServerInternetUsable(false, true))
    assertTrue("A mobile-data/Wi-Fi network with INTERNET capability must be tried even if Android's validation probe is false",
      isServerInternetUsable(true, false))
    assertTrue("Validated Wi-Fi or mobile data must allow Server to attempt the call",
      isServerInternetUsable(true, true))
  }

  @Test fun launcherShowsServerIdFirstOnboardingWithoutSimPermissions() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    assertEquals("Server must not request access to SIM phone numbers",
      android.content.pm.PackageManager.PERMISSION_DENIED,
      context.checkSelfPermission("android.permission.READ_PHONE_NUMBERS"))
    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
    assertNotNull("Server does not expose a launcher entry", launchIntent)
    assertEquals("The launcher must open the Server website onboarding bridge",
      ServerSetupWebActivity::class.java.name, launchIntent!!.component?.className)

    ActivityScenario.launch<ServerSetupWebActivity>(launchIntent).use {
      val device = UiDevice.getInstance(instrumentation)
      assertTrue("Server onboarding brand is not visible",
        device.wait(Until.hasObject(By.text("server")), 20_000))
      assertTrue("Server ID-first setup heading is not visible",
        device.wait(Until.hasObject(By.textContains("Create your Server identity")), 20_000))
      assertTrue("The setup must explain that SIM selection is not required",
        device.wait(Until.hasObject(By.textContains("No SIM selection and no SMS OTP are required")), 10_000))
      assertTrue("The old SIM-selection UI must not appear",
        !device.hasObject(By.textContains("Choose your SIM")))
      assertTrue("The old SIM permission button must not appear",
        !device.hasObject(By.textContains("Allow SIM access")))
      // Click the actual checkbox input rather than its surrounding label text.
      // Older Android System WebView versions may expose the label span separately
      // and a label click does not reliably toggle the input/change event.
      val termsCheckbox = device.wait(Until.findObject(By.clazz("android.widget.CheckBox")), 10_000)
      assertNotNull("The legal acceptance checkbox must be exposed by the Android WebView", termsCheckbox)
      assertTrue("Legal acceptance starts unchecked", !termsCheckbox!!.isChecked)
      termsCheckbox.click()
      assertTrue("Tapping the checkbox must set its checked state", termsCheckbox.isChecked)
      // The primary action sits below the fold on phone-sized screens.
      val createButton = findTextOnScrollableScreen(context, device, "Create my Server ID")
      assertNotNull("Server identity creation action is not visible after scrolling", createButton)
      assertTrue("Accepting the terms should enable Server ID creation", createButton!!.isEnabled)
      assertTrue("Onboarding unexpectedly opened a custom number-entry dialer",
        !device.hasObject(By.textContains("Call a number")))
    }
  }

  @Test fun enabledServerAccountRingsThroughAndroidTelecomForIncomingCalls() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    grantTelecomPermissions(context)
    val prefs = context.getSharedPreferences("server-session", Context.MODE_PRIVATE)
    val device = UiDevice.getInstance(instrumentation)
    val handle = ServerTelecomRegistry.handle(context)
    val callId = "incoming-" + UUID.randomUUID().toString()
    val callerIdentity = "SVR-ABCDEF1234"

    ServerTelecomRegistry.register(context)
    enablePhoneAccountWithTestShell(context, handle)
    try {
      // Exercise Android Telecom's actual incoming-call callback. This is not a
      // direct unit construction of ServerTelecomConnection: Telecom must invoke
      // ServerConnectionService.onCreateIncomingConnection for the assertion.
      ServerTelecomRegistry.reportIncoming(context, callId, callerIdentity)
      val deadline = System.currentTimeMillis() + 12_000
      var state: Int? = null
      while (System.currentTimeMillis() < deadline && state == null) {
        state = ServerTelecomRegistry.incomingConnectionState(callId)
        Thread.sleep(100)
      }
      assertEquals("Android Telecom did not call ServerConnectionService and start a ringing incoming connection",
        Connection.STATE_RINGING, state)

      // Verify the caller label was handed to Telecom's Connection object. Some
      // OEM/system call surfaces display "Unknown" for an internet call without a
      // shared telephone number, while still showing the Server call provider UI.
      assertEquals("Telecom did not receive the caller's Server identity as the display name",
        callerIdentity, ServerTelecomRegistry.incomingCallerDisplayName(callId))
      val serverCallUi = device.wait(Until.hasObject(By.textContains("Incoming call via Server")), 8_000)
      assertTrue("Android did not expose the incoming call through its system Phone UI", serverCallUi)
    } finally {
      ServerTelecomRegistry.markEnded(callId)
      device.pressHome()
    }
  }

  @Test fun phoneAccountCanReceiveIncomingCallThroughTelecom() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    grantTelecomPermissions(context)
    val handle = ServerTelecomRegistry.handle(context)
    val callId = "android12-incoming-" + UUID.randomUUID().toString()
    val callerIdentity = "SVR-ANDROID12"
    ServerTelecomRegistry.register(context)
    enablePhoneAccountWithTestShell(context, handle)
    try {
      assertTrue("Android 12 must expose the enabled Server PhoneAccount to Telecom", accountEnabled(context, handle))
      ServerTelecomRegistry.reportIncoming(context, callId, callerIdentity)
      val deadline = System.currentTimeMillis() + 12_000
      var state: Int? = null
      while (System.currentTimeMillis() < deadline && state == null) {
        state = ServerTelecomRegistry.incomingConnectionState(callId)
        Thread.sleep(100)
      }
      assertEquals("Android 12 Telecom did not create a ringing Server incoming Connection",
        Connection.STATE_RINGING, state)
      assertEquals("Android 12 Telecom did not retain the Server caller identity",
        callerIdentity, ServerTelecomRegistry.incomingCallerDisplayName(callId))
    } finally {
      ServerTelecomRegistry.markEnded(callId)
      UiDevice.getInstance(instrumentation).pressHome()
    }
  }

  @Test fun vanishedUnansweredIncomingCallIsDisconnectedFromSystemTelecom() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val callId = "smoke-" + UUID.randomUUID().toString()
    val connection = ServerTelecomConnection(context)
    connection.setExtras(Bundle().apply { putString("server_call_id", callId) })
    connection.setRinging()
    ServerTelecomRegistry.attach(connection, callId)

    try {
      assertEquals("A newly reported incoming call should ring", Connection.STATE_RINGING, connection.state)
      ServerTelecomRegistry.reconcileIncoming(setOf(callId))
      assertEquals("A call still present in the backend must keep ringing", Connection.STATE_RINGING, connection.state)
      ServerTelecomRegistry.reconcileIncoming(emptySet())
      assertEquals("A vanished unanswered backend call must clear the system ringing connection",
        Connection.STATE_DISCONNECTED, connection.state)
    } finally {
      ServerTelecomRegistry.markEnded(callId)
    }
  }

  private fun insertDemoContact(context: Context, displayName: String, phone: String) {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    instrumentation.uiAutomation.adoptShellPermissionIdentity(Manifest.permission.WRITE_CONTACTS)
    try {
      val operations = arrayListOf<android.content.ContentProviderOperation>()
      val rawContact = operations.size
      operations.add(android.content.ContentProviderOperation.newInsert(ContactsContract.RawContacts.CONTENT_URI)
        .withValue(ContactsContract.RawContacts.ACCOUNT_TYPE, null)
        .withValue(ContactsContract.RawContacts.ACCOUNT_NAME, null)
        .build())
      operations.add(android.content.ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
        .withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, rawContact)
        .withValue(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE)
        .withValue(ContactsContract.CommonDataKinds.StructuredName.DISPLAY_NAME, displayName)
        .build())
      operations.add(android.content.ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
        .withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, rawContact)
        .withValue(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE)
        .withValue(ContactsContract.CommonDataKinds.Phone.NUMBER, phone)
        .withValue(ContactsContract.CommonDataKinds.Phone.TYPE, ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE)
        .build())
      context.contentResolver.applyBatch(ContactsContract.AUTHORITY, operations)
    } finally {
      instrumentation.uiAutomation.dropShellPermissionIdentity()
    }
  }

  private fun clickTextWithRetry(
    device: UiDevice,
    text: String,
    exact: Boolean = false,
    timeoutMs: Long = 5000L
  ): Boolean {
    val selector = if (exact) By.text(text) else By.textContains(text)
    val deadline = System.currentTimeMillis() + timeoutMs
    while (System.currentTimeMillis() < deadline) {
      val candidate = device.findObject(selector)
      if (candidate == null) {
        Thread.sleep(100)
        continue
      }
      try {
        candidate.click()
        return true
      } catch (_: StaleObjectException) {
        // A new WebView accessibility tree is being published; re-query below.
        Thread.sleep(120)
      }
    }
    return false
  }

  private fun findTextOnScrollableScreen(
    context: Context,
    device: UiDevice,
    text: String,
    exact: Boolean = false
  ): androidx.test.uiautomator.UiObject2? {
    fun find() = if (exact) device.findObject(By.text(text)) else device.findObject(By.textContains(text))
    var result = find()
    for (attempt in 0 until 8) {
      if (result != null) return result
      // System Settings and WebView pages may place a control below the visible
      // viewport. Search every scroll position, then log the hierarchy on failure.
      device.swipe(device.displayWidth / 2, device.displayHeight * 4 / 5,
        device.displayWidth / 2, device.displayHeight / 3, 6)
      Thread.sleep(300)
      result = find()
    }
    if (result == null) {
      try {
        val hierarchy = File(context.cacheDir, "server-ui-hierarchy.txt")
        device.dumpWindowHierarchy(hierarchy)
        Log.e("ServerUITest", "Could not find [$text]; accessibility hierarchy:\n${hierarchy.readText()}")
      } catch (e: Exception) {
        Log.e("ServerUITest", "Could not capture UI hierarchy for [$text]: ${e.javaClass.simpleName}")
      }
    }
    return result
  }

  private fun runShellCommand(command: String): String {
    val descriptor = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)
    return android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).bufferedReader().use { it.readText() }
  }

  /**
   * CTS/AOSP exposes this shell command only to the test harness. Using it here
   * isolates Telecom call delivery from the separate human Settings navigation
   * test, whose layout differs across Android releases and OEM dialers.
   */
  private fun enablePhoneAccountWithTestShell(context: Context, handle: android.telecom.PhoneAccountHandle) {
    grantTelecomPermissions(context)
    val userManager = context.getSystemService(android.os.UserManager::class.java)
    val serial = userManager.getSerialNumberForUser(android.os.Process.myUserHandle())
    val component = handle.componentName.flattenToString()
    val output = runShellCommand("telecom set-phone-account-enabled " + component + " " + handle.id + " " + serial)
    // Telecom confirms the account was enabled. On API 31 the public
    // getCallCapablePhoneAccounts() list can lag the shell state change even
    // after the shell reports success. The real incoming-call callback below
    // is the acceptance test; do not fail prematurely on that cache.
    assertTrue("Telecom did not confirm Server PhoneAccount enablement. " + output,
      output.contains(" enabled."))
  }

  private fun grantTelecomPermissions(context: Context) {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    for (permission in listOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.RECORD_AUDIO)) {
      try { instrumentation.uiAutomation.grantRuntimePermission(context.packageName, permission) } catch (_: Exception) {}
    }
  }
  private fun accountEnabled(context: Context, handle: android.telecom.PhoneAccountHandle): Boolean {
    val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
    return telecom.callCapablePhoneAccounts.contains(handle)
  }

  private fun ensureAccountEnabled(
    context: Context,
    device: UiDevice,
    handle: android.telecom.PhoneAccountHandle,
    label: String
  ) {
    grantTelecomPermissions(context)
    if (accountEnabled(context, handle)) return
    context.startActivity(Intent("android.telecom.action.CHANGE_PHONE_ACCOUNTS")
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))

    // On AOSP Android 14, CHANGE_PHONE_ACCOUNTS first opens a settings landing
    // page with an "All calling accounts" row. The registered providers are one
    // level deeper; searching for Server on the landing page can never succeed.
    var accountRowVisible = device.wait(Until.hasObject(By.text(label)), 1_000)
    if (!accountRowVisible) {
      val openedAllAccounts = clickTextWithRetry(device, "All calling accounts", timeoutMs = 8_000)
      if (openedAllAccounts) {
        device.wait(Until.hasObject(By.textContains("All calling accounts")), 2_000)
        Thread.sleep(300)
      }
      accountRowVisible = device.wait(Until.hasObject(By.text(label)), 8_000)
    }
    assertTrue("Android calling-account list did not show $label. See ServerUITest hierarchy in logcat.", accountRowVisible)
    assertTrue("Could not reliably open the $label calling-account settings",
      clickTextWithRetry(device, label, exact = true, timeoutMs = 8_000))
    val deadline = System.currentTimeMillis() + 10_000
    while (System.currentTimeMillis() < deadline && !accountEnabled(context, handle)) {
      val toggle = device.findObject(By.clazz("android.widget.Switch"))
        ?: device.findObject(By.clazz("androidx.appcompat.widget.SwitchCompat"))
      if (toggle != null && !toggle.isChecked) toggle.click()
      Thread.sleep(250)
    }
    device.pressBack()
    assertTrue("Android shows $label but has not enabled it", accountEnabled(context, handle))
  }

  @Test fun preinstalledPhoneDialerOffersServerAsAnOutgoingCallChoice() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    grantTelecomPermissions(context)
    val prefs = context.getSharedPreferences("server-session", Context.MODE_PRIVATE)
    val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
    val serverHandle = ServerTelecomRegistry.handle(context)
    val testHandle = android.telecom.PhoneAccountHandle(
      android.content.ComponentName(context, ServerConnectionService::class.java),
      "server-normal-dialer-test-provider"
    )
    val previousToken = prefs.getString("access_token", null)
    val previousExpiry = prefs.getLong("access_expiry", 0L)
    val previousPhone = prefs.getString("phone", null)
    val previousEngineAt = prefs.getLong("debug_last_call_engine_entered_at", 0L)
    val previousTargetKind = prefs.getString("debug_last_call_target_kind", null)
    val previousTelecomStage = prefs.getString("debug_last_telecom_stage", null)
    val previousEngineStarted = prefs.getBoolean("debug_telecom_connection_engine_started", false)
    val previousCallFailure = prefs.getString("debug_last_call_failure", null)
    val previousDefaultOutgoing = telecom.getDefaultOutgoingPhoneAccount(PhoneAccount.SCHEME_TEL)
    val device = UiDevice.getInstance(instrumentation)
    var testAccountRegistered = false

    try {
      try { instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.RECORD_AUDIO) } catch (_: Exception) {}
      assertTrue("The test must have microphone permission before exercising a background Telecom call",
        context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED)
      prefs.edit()
        .putString("access_token", "0".repeat(64))
        .putLong("access_expiry", System.currentTimeMillis() / 1000 + 3600)
        .putString("phone", "+12025550101")
        .putString("selected_sim_phone", "+12025550101")
        .remove("debug_last_call_engine_entered_at")
        .remove("debug_last_call_target_kind")
        .remove("debug_last_telecom_stage")
        .remove("debug_telecom_connection_engine_started")
        .remove("debug_last_call_failure")
        .commit()

      ServerTelecomRegistry.register(context)
      ensureAccountEnabled(context, device, serverHandle, "Server")

      // The emulator has no physical carrier SIM. Keep this second account clearly
      // labelled as a mock while exercising the preinstalled Phone app UI.
      val testAccount = PhoneAccount.builder(testHandle, "Test call provider (mock)")
        .setCapabilities(PhoneAccount.CAPABILITY_CALL_PROVIDER)
        .setSupportedUriSchemes(listOf(PhoneAccount.SCHEME_TEL))
        .setShortDescription("Test-only calling provider; not a carrier SIM")
        .setAddress(Uri.parse("tel:+12025550101"))
        .build()
      telecom.registerPhoneAccount(testAccount)
      testAccountRegistered = true
      ensureAccountEnabled(context, device, testHandle, "Test call provider (mock)")

      // A preconfigured default SIM makes Google Phone place calls immediately and
      // bypass its outgoing-account picker. Android CTS uses the Telecom shell command
      // to select the system-supported "Ask every time" state.
      runShellCommand("telecom set-user-selected-outgoing-phone-account")
      assertEquals("Multiple enabled tel providers with Ask every time should have no default outgoing account",
        null, telecom.getDefaultOutgoingPhoneAccount(PhoneAccount.SCHEME_TEL))
      val callCapableAccounts = telecom.callCapablePhoneAccounts
      assertTrue("Server must be an enabled call-capable account before checking Phone UI", serverHandle in callCapableAccounts)
      assertTrue("The mock provider must be enabled to prove a real multi-provider picker", testHandle in callCapableAccounts)

      // Open Android's real Phone app with a test number already entered.
      // This avoids depending on the emulator's optional Contacts provider while
      // still testing the system outgoing-account chooser used after the user taps Call.
      device.pressHome()
      context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:+12025550101"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      val dialerReady = device.wait(Until.hasObject(By.textContains("555")), 12_000)
      assertTrue("Android's system Phone dialer did not open with the requested number", dialerReady)
      val callButton = device.wait(Until.findObject(By.descContains("Call")), 6_000)
        ?: device.wait(Until.findObject(By.text("Call")), 2_000)
      assertNotNull("Android's Phone dialer did not expose its Call action", callButton)
      callButton!!.click()

      val chooserDeadline = System.currentTimeMillis() + 15_000
      var serverChoice: androidx.test.uiautomator.UiObject2? = null
      var testChoice: androidx.test.uiautomator.UiObject2? = null
      while (System.currentTimeMillis() < chooserDeadline && (serverChoice == null || testChoice == null)) {
        serverChoice = device.findObject(By.text("Server"))
        testChoice = device.findObject(By.text("Test call provider (mock)"))
        Thread.sleep(200)
      }
      assertNotNull("The preinstalled Phone app did not show Server as an outgoing-call choice", serverChoice)
      assertNotNull("The preinstalled Phone app did not show a second calling provider beside Server", testChoice)
      serverChoice!!.click()
      val justOnce = device.wait(Until.findObject(By.textContains("Just once")), 2_000)
      if (justOnce != null) justOnce.click()

      val deadline = System.currentTimeMillis() + 20_000
      while (System.currentTimeMillis() < deadline && prefs.getLong("debug_last_call_engine_entered_at", 0L) == 0L) Thread.sleep(200)
      var lastTelecomStage = prefs.getString("debug_last_telecom_stage", "not-recorded")
      assertTrue("Choosing Server from the preinstalled Phone app did not reach Server’s call engine (last stage: " + lastTelecomStage + ")",
        prefs.getLong("debug_last_call_engine_entered_at", 0L) > 0L)
      assertEquals("The system dialer telephone number must enter the phone-number call path",
        "phone", prefs.getString("debug_last_call_target_kind", null))

      // This test intentionally uses an invalid session, so a real backend rejection
      // is expected. Telecom must reach its bound WebRTC engine without opening an
      // Activity over the Phone app; the backend rejection is asserted from diagnostics.
      val backendDeadline = System.currentTimeMillis() + 15_000
      while (System.currentTimeMillis() < backendDeadline &&
        prefs.getString("debug_last_telecom_stage", null) != "call_setup_failed") Thread.sleep(150)
      lastTelecomStage = prefs.getString("debug_last_telecom_stage", "not-recorded")
      assertEquals("Outgoing Telecom flow must wait for the Server backend result before returning to the Phone app",
        "call_setup_failed", lastTelecomStage)
      assertTrue("The Telecom-bound ConnectionService must own the call engine",
        prefs.getBoolean("debug_telecom_connection_engine_started", false))
      val failure = prefs.getString("debug_last_call_failure", null).orEmpty()
      assertTrue("The test must observe the expected rejected backend session", failure.isNotBlank())
      assertFalse("Server must not replace Android Phone with its internal setup page",
        device.hasObject(By.text("Calling, made natural")))
      assertTrue("No Server Activity should be launched over Android Phone",
        context.packageName != device.currentPackageName)
    } finally {
      val edit = prefs.edit()
      if (previousToken == null) edit.remove("access_token") else edit.putString("access_token", previousToken)
      edit.putLong("access_expiry", previousExpiry)
      if (previousPhone == null) edit.remove("phone") else edit.putString("phone", previousPhone)
      if (previousEngineAt == 0L) edit.remove("debug_last_call_engine_entered_at") else edit.putLong("debug_last_call_engine_entered_at", previousEngineAt)
      if (previousTargetKind == null) edit.remove("debug_last_call_target_kind") else edit.putString("debug_last_call_target_kind", previousTargetKind)
      if (previousTelecomStage == null) edit.remove("debug_last_telecom_stage") else edit.putString("debug_last_telecom_stage", previousTelecomStage)
      edit.putBoolean("debug_telecom_connection_engine_started", previousEngineStarted)
      if (previousCallFailure == null) edit.remove("debug_last_call_failure") else edit.putString("debug_last_call_failure", previousCallFailure)
      edit.commit()
      if (testAccountRegistered) try { telecom.unregisterPhoneAccount(testHandle) } catch (_: Exception) {}
      ServerTelecomRegistry.register(context)
      // Restore the emulator's effective outgoing account so the test does not
      // leave its system-level phone settings changed.
      try {
        if (previousDefaultOutgoing == null) {
          runShellCommand("telecom set-user-selected-outgoing-phone-account")
        } else {
          val serial = context.getSystemService(android.os.UserManager::class.java)
            .getSerialNumberForUser(android.os.Process.myUserHandle())
          val component = previousDefaultOutgoing.componentName.flattenToString()
          val accountId = previousDefaultOutgoing.id
          if (component.matches(Regex("^[A-Za-z0-9_.$/]+$")) && accountId.matches(Regex("^[A-Za-z0-9_.-]+$"))) {
            runShellCommand("telecom set-user-selected-outgoing-phone-account " + component + " " + accountId + " " + serial)
          }
        }
      } catch (restoreError: Exception) {
        Log.w("ServerUITest", "Could not restore the original outgoing-account preference: " + restoreError.javaClass.simpleName)
      }
      // Do not force-stop the target package from instrumentation cleanup: on
      // Android this can kill the instrumentation process before JUnit reports
      // the real call-picker assertion. Returning to Home is enough for cleanup.
      device.pressHome()
    }
  }

  @Test fun telecomHangupUsesCallIdFromSystemIntentWhenActivityHasNoCallState() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    val prefs = context.getSharedPreferences("server-session", Context.MODE_PRIVATE)
    val previousToken = prefs.getString("access_token", null)
    val previousExpiry = prefs.getLong("access_expiry", 0L)
    val previousMarker = prefs.getString("debug_last_telecom_hangup_call_id", null)
    val callId = "telecom-hangup-" + UUID.randomUUID().toString()

    // Simulate Android recreating MainActivity after the original in-memory call
    // state has disappeared. The Telecom Connection still supplies its call ID.
    prefs.edit().remove("access_token").putLong("access_expiry", 0L)
      .remove("debug_last_telecom_hangup_call_id").commit()
    val intent = Intent(context, MainActivity::class.java).apply {
      putExtra("server_action", "hangup")
      putExtra("server_call_id", callId)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }

    try {
      ActivityScenario.launch<MainActivity>(intent).use {
        val deadline = System.currentTimeMillis() + 5_000
        while (System.currentTimeMillis() < deadline &&
          prefs.getString("debug_last_telecom_hangup_call_id", null) != callId) {
          Thread.sleep(50)
        }
        assertEquals(
          "A recreated MainActivity must use the call ID supplied by Android Telecom, not a missing in-memory call ID",
          callId,
          prefs.getString("debug_last_telecom_hangup_call_id", null)
        )
      }
    } finally {
      val edit = prefs.edit()
      if (previousToken == null) edit.remove("access_token") else edit.putString("access_token", previousToken)
      edit.putLong("access_expiry", previousExpiry)
      if (previousMarker == null) edit.remove("debug_last_telecom_hangup_call_id")
      else edit.putString("debug_last_telecom_hangup_call_id", previousMarker)
      edit.commit()
    }
  }

  @Test fun serverRegistersAsSystemManagedPhoneAccountAndUsesOnlyExplicitlyLinkedNumberMetadata() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    grantTelecomPermissions(context)
    val prefs = context.getSharedPreferences("server-session", Context.MODE_PRIVATE)
    val previousNumber = prefs.getString("selected_sim_phone", null)
    val previousLinked = prefs.getBoolean("server_phone_number_linked", false)
    val previousLinkedPhone = prefs.getString("server_linked_phone", null)
    val previousNumberConsent = prefs.getBoolean("allow_number_based_server_calls", false)

    try {
      // A legacy SIM-derived number must never be silently attached to Server.
      prefs.edit().putString("selected_sim_phone", "+2348012345678")
        .putBoolean("server_phone_number_linked", false).remove("server_linked_phone").commit()
      ServerTelecomRegistry.register(context)
      var account = ServerTelecomRegistry.buildPhoneAccount(context)
      assertEquals("An unverified SIM number must not become Server calling identity metadata",
        null, account.address)

      // Only an explicitly verified-and-linked number may be shown as Telecom metadata.
      prefs.edit().putBoolean("server_phone_number_linked", true)
        .putString("server_linked_phone", "+2348012345678")
        .putBoolean("allow_number_based_server_calls", false).commit()
      ServerTelecomRegistry.register(context)
      account = ServerTelecomRegistry.buildPhoneAccount(context)
      assertEquals("Verified number must remain private until the user opts into number-based calls",
        null, account.address)

      prefs.edit().putBoolean("allow_number_based_server_calls", true).commit()
      ServerTelecomRegistry.register(context)
      account = ServerTelecomRegistry.buildPhoneAccount(context)
      assertTrue("Server account is not a call-provider account",
        (account.capabilities and PhoneAccount.CAPABILITY_CALL_PROVIDER) != 0)
      assertTrue("Server must be a system-managed call provider, not self-managed",
        (account.capabilities and PhoneAccount.CAPABILITY_SELF_MANAGED) == 0)
      assertTrue("Server must explicitly advertise tel URI support so the normal dialer can route numbers to it",
        account.supportedUriSchemes.contains(PhoneAccount.SCHEME_TEL))
      assertTrue("Server must not masquerade as a cellular SIM",
        (account.capabilities and PhoneAccount.CAPABILITY_SIM_SUBSCRIPTION) == 0)
      assertEquals("Only the explicitly linked and consented number should be exposed as account metadata",
        Uri.parse("tel:+2348012345678"), account.address)

      prefs.edit().putBoolean("allow_number_based_server_calls", false).commit()
      ServerTelecomRegistry.register(context)
      account = ServerTelecomRegistry.buildPhoneAccount(context)
      assertEquals("Revoking number-call consent must remove the number from Telecom metadata",
        null, account.address)
    } finally {
      val edit = prefs.edit()
      if (previousNumber == null) edit.remove("selected_sim_phone") else edit.putString("selected_sim_phone", previousNumber)
      edit.putBoolean("server_phone_number_linked", previousLinked)
      if (previousLinkedPhone == null) edit.remove("server_linked_phone") else edit.putString("server_linked_phone", previousLinkedPhone)
      edit.putBoolean("allow_number_based_server_calls", previousNumberConsent)
      edit.commit()
      ServerTelecomRegistry.register(context)
    }
  }

}