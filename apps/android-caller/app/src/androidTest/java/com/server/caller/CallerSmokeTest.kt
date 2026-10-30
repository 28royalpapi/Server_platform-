package com.server.caller

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class CallerSmokeTest {
  @Test fun launcherOpensWebsiteOnboardingInsteadOfCustomDialer() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    context.getSharedPreferences("server-session", Context.MODE_PRIVATE).edit()
      .putBoolean("server_open_dialer_after_account_enable", false)
      .remove("selected_sim_subscription_id").remove("selected_sim_slot")
      .remove("selected_sim_carrier").remove("selected_sim_phone")
      .remove("server_phone_number_linked").remove("server_linked_phone")
      .remove("allow_number_based_server_calls").remove("server_id")
      .remove("access_token").remove("access_expiry").commit()

    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
    assertNotNull("Server does not expose a launcher entry", launchIntent)
    assertEquals("Server launcher entry changed", ServerSetupWebActivity::class.java.name,
      launchIntent!!.component?.className)

    val device = UiDevice.getInstance(instrumentation)
    context.startActivity(launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    assertTrue("The launcher must open Chrome", device.wait(Until.hasObject(By.pkg("com.android.chrome")), 30_000))
    val firstRunDeadline = System.currentTimeMillis() + 25_000
    while (System.currentTimeMillis() < firstRunDeadline &&
      !device.hasObject(By.textContains("Choose on your phone"))) {
      val choice = listOf("Accept & continue", "Use without an account", "No thanks",
        "Continue without an account").asSequence().mapNotNull { device.findObject(By.text(it)) }.firstOrNull()
      if (choice != null) { try { choice.click() } catch (_: StaleObjectException) {}; Thread.sleep(300) }
      else Thread.sleep(200)
    }
    assertTrue("Chrome did not display the deployed Vercel onboarding website",
      device.wait(Until.hasObject(By.textContains("Choose on your phone")), 20_000))
    assertEquals("The deployed onboarding page must be visible in Chrome", "com.android.chrome", device.currentPackageName)

    val cta = device.wait(Until.findObject(By.textContains("Continue setup on this phone")), 12_000)
    assertNotNull("The Vercel site must expose the native setup handoff", cta)
    cta!!.click()
    var nativeVisible = device.wait(Until.hasObject(By.textContains("Allow Server calling")), 5_000)
    if (!nativeVisible) {
      (device.wait(Until.findObject(By.text("Open")), 2_000)
        ?: device.wait(Until.findObject(By.text("Open in Server")), 1_000))?.click()
      nativeVisible = device.wait(Until.hasObject(By.textContains("Allow Server calling")), 20_000)
    }
    assertTrue("Chrome's server://sim-setup link did not open the native calling setup bridge", nativeVisible)

    val legal = findTextOnScrollableScreen(context, device, "I accept the Terms of Service")
    assertNotNull("Legal acceptance checkbox is missing", legal)
    legal!!.click()
    val grantCalls = findTextOnScrollableScreen(context, device, "Create Server identity and allow calling")
    assertNotNull("Calling permissions action is missing", grantCalls)
    grantCalls!!.click()

    var sawCallingPermission = false
    repeat(4) {
      val choices = listOf("While using the app", "Allow only while using the app", "Only this time", "Allow")
      val deadline = System.currentTimeMillis() + 5_000
      while (System.currentTimeMillis() < deadline) {
        val option = choices.asSequence().mapNotNull { device.findObject(By.text(it)) }.firstOrNull()
        if (option != null) { try { option.click(); sawCallingPermission = true } catch (_: StaleObjectException) {}; Thread.sleep(350); break }
        Thread.sleep(100)
      }
    }
    assertTrue("Android did not show microphone/notification permission dialogs", sawCallingPermission)
    assertTrue("The backend did not create a real Server identity",
      device.wait(Until.hasObject(By.textContains("Your Server ID:")), 45_000))
    val skipLink = findTextOnScrollableScreen(context, device, "Skip number verification")
    assertNotNull("Skipping SMS number verification must be available", skipLink)
    skipLink!!.click()
    // The website's skip action opens Calling accounts itself. Return once to the
    // bridge so the helper can navigate to that system page only once; the pending
    // handoff flag remains set and the activity opens the normal dialer after enable.
    Thread.sleep(900)
    if (device.currentPackageName.orEmpty().contains("settings", ignoreCase = true)) device.pressBack()

    ensureAccountEnabled(context, device, ServerTelecomRegistry.handle(context), "Server")
    val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
    val defaultDialer = telecom.defaultDialerPackage
    assertNotNull("Android does not expose its default phone dialer", defaultDialer)
    val deadline = System.currentTimeMillis() + 15_000
    while (System.currentTimeMillis() < deadline && device.currentPackageName != defaultDialer) Thread.sleep(200)
    assertEquals("Enabling Server must return onboarding to the normal phone dialer", defaultDialer, device.currentPackageName)
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

  private fun grantPhoneMetadataPermissions(context: Context) {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    for (permission in listOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.READ_PHONE_NUMBERS)) {
      try { instrumentation.uiAutomation.grantRuntimePermission(context.packageName, permission) } catch (_: Exception) {}
    }
  }
  private fun accountEnabled(context: Context, handle: android.telecom.PhoneAccountHandle): Boolean {
    val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
    return telecom.getPhoneAccount(handle)?.isEnabled == true
  }

  private fun ensureAccountEnabled(
    context: Context,
    device: UiDevice,
    handle: android.telecom.PhoneAccountHandle,
    label: String
  ) {
    grantPhoneMetadataPermissions(context)
    if (accountEnabled(context, handle)) return
    context.startActivity(Intent("android.telecom.action.CHANGE_PHONE_ACCOUNTS")
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))

    // On AOSP Android 14, CHANGE_PHONE_ACCOUNTS first opens a settings landing
    // page with an "All calling accounts" row. The registered providers are one
    // level deeper; searching for Server on the landing page can never succeed.
    var accountRow = device.findObject(By.text(label))
    if (accountRow == null) {
      val allAccounts = findTextOnScrollableScreen(context, device, "All calling accounts")
      if (allAccounts != null) {
        allAccounts.click()
        device.wait(Until.hasObject(By.textContains("All calling accounts")), 2_000)
        Thread.sleep(300)
      }
      accountRow = findTextOnScrollableScreen(context, device, label)
    }
    assertNotNull("Android calling-account list did not show $label. See ServerUITest hierarchy in logcat.", accountRow)
    accountRow!!.click()
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
    // The test inspects global Telecom defaults; the shipped connector does not request READ_PHONE_STATE.
    instrumentation.uiAutomation.adoptShellPermissionIdentity(Manifest.permission.READ_PHONE_STATE)
    val context = instrumentation.targetContext
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
        .putString("phone", "+15550001001")
        .remove("debug_last_call_engine_entered_at")
        .remove("debug_last_call_target_kind")
        .commit()

      ServerTelecomRegistry.register(context)
      ensureAccountEnabled(context, device, serverHandle, "Server")

      // The emulator has no physical carrier SIM. Keep this second account clearly
      // labelled as a mock while exercising the preinstalled Phone app UI.
      val testAccount = PhoneAccount.builder(testHandle, "Test call provider (mock)")
        .setCapabilities(PhoneAccount.CAPABILITY_CALL_PROVIDER)
        .setSupportedUriSchemes(listOf(PhoneAccount.SCHEME_TEL))
        .setShortDescription("Test-only calling provider; not a carrier SIM")
        .setAddress(Uri.parse("tel:+15550001001"))
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

      // Open the system Phone app with a test number and use its native call action.
      // This exercises Android's actual outgoing-account chooser without relying on
      // Contacts-provider aggregation behaviour that differs between emulator images.
      device.pressHome()
      context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:+15550001001"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      assertNotNull("The system Phone app did not display the test number",
        device.wait(Until.findObject(By.textContains("555")), 10_000))
      val callButton = device.wait(Until.findObject(By.descContains("Call")), 6_000)
        ?: device.wait(Until.findObject(By.text("Call")), 2_000)
      assertNotNull("The system Phone app did not expose its call action", callButton)
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
      val lastTelecomStage = prefs.getString("debug_last_telecom_stage", "not-recorded")
      assertTrue("Choosing Server from the preinstalled Phone app did not reach Server’s call engine (last stage: " + lastTelecomStage + ")",
        prefs.getLong("debug_last_call_engine_entered_at", 0L) > 0L)
      assertEquals("The system dialer telephone number must enter the phone-number call path",
        "phone", prefs.getString("debug_last_call_target_kind", null))
    } finally {
      val edit = prefs.edit()
      if (previousToken == null) edit.remove("access_token") else edit.putString("access_token", previousToken)
      edit.putLong("access_expiry", previousExpiry)
      if (previousPhone == null) edit.remove("phone") else edit.putString("phone", previousPhone)
      if (previousEngineAt == 0L) edit.remove("debug_last_call_engine_entered_at") else edit.putLong("debug_last_call_engine_entered_at", previousEngineAt)
      if (previousTargetKind == null) edit.remove("debug_last_call_target_kind") else edit.putString("debug_last_call_target_kind", previousTargetKind)
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
      instrumentation.uiAutomation.dropShellPermissionIdentity()
    }
  }

  @Test fun serverRegistersAsSystemManagedPhoneAccountWithoutCellularSIMMetadata() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    grantPhoneMetadataPermissions(context)
    val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
    val handle = ServerTelecomRegistry.handle(context)
    val prefs = context.getSharedPreferences("server-session", Context.MODE_PRIVATE)
    try {
      prefs.edit().remove("selected_sim_phone").commit()
      ServerTelecomRegistry.register(context)
      val account = telecom.getPhoneAccount(handle)

      assertNotNull("Android Telecom did not register the Server calling account", account)
      assertTrue("Server account is not a call-provider account",
        (account!!.capabilities and PhoneAccount.CAPABILITY_CALL_PROVIDER) != 0)
      assertTrue("Server must be a system-managed call provider, not self-managed",
        (account.capabilities and PhoneAccount.CAPABILITY_SELF_MANAGED) == 0)
      assertTrue("Server must explicitly advertise tel URI support so the normal dialer can route numbers to it",
        account.supportedUriSchemes.contains(PhoneAccount.SCHEME_TEL))
      assertTrue("Server must not masquerade as a cellular SIM",
        (account.capabilities and PhoneAccount.CAPABILITY_SIM_SUBSCRIPTION) == 0)
      assertEquals("No cellular SIM address is required for Server internet calling", null, account.address)
    } finally {
      prefs.edit().remove("selected_sim_phone").commit()
      ServerTelecomRegistry.register(context)
    }
  }
}