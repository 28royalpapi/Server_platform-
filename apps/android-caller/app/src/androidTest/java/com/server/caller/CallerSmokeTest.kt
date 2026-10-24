package com.server.caller

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.telecom.PhoneAccount
import android.telecom.TelecomManager
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CallerSmokeTest {
  @Test fun launcherOpensSavaCallDialerWithContactsAndCallingChoices() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
    assertNotNull("Sava Call does not expose a launcher entry", launchIntent)
    assertEquals("The launcher must open the native Sava Call dialer",
      DialerActivity::class.java.name, launchIntent!!.component?.className)

    ActivityScenario.launch<DialerActivity>(launchIntent).use {
      val device = UiDevice.getInstance(instrumentation)
      assertTrue("Sava Call brand is not visible",
        device.wait(Until.hasObject(By.text("SAVA CALL")), 10_000))
      assertTrue("The keypad is not visible",
        device.wait(Until.hasObject(By.text("Keypad")), 10_000))
      assertTrue("Contacts access is not available from the dialer",
        device.wait(Until.hasObject(By.text("Contacts")), 10_000))
      assertTrue("The caller cannot choose a call route",
        device.wait(Until.hasObject(By.text("Choose how to call")), 10_000))
      assertTrue("Setup entry is not reachable from the dialer",
        device.wait(Until.hasObject(By.text("Set up Sava Call")), 10_000))
    }
  }

  @Test fun websiteEntryOpensSimSelectionInsideNativeBridge() {
    val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    ActivityScenario.launch(ServerSetupWebActivity::class.java).use {
      assertTrue("Website did not switch into the SIM-first setup in the native bridge",
        device.wait(Until.hasObject(By.textContains("Choose your SIM")), 20_000))
      assertTrue("Native website bridge did not expose the SIM permission action",
        device.wait(Until.hasObject(By.textContains("Allow SIM access and detect SIMs")), 10_000))
    }
  }


  private fun ensureServerCallingAccountEnabled(context: Context, device: UiDevice) {
    ServerTelecomRegistry.register(context)
    if (ServerTelecomRegistry.isEnabled(context)) return

    context.startActivity(Intent("android.telecom.action.CHANGE_PHONE_ACCOUNTS")
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    assertTrue("Android calling-account settings did not show Server",
      device.wait(Until.hasObject(By.text("Server")), 15_000))
    device.findObject(By.text("Server")).click()

    // Android builds vary: some expose an inline switch, others open an account
    // detail page. Try the detail-page switch if clicking the row did not enable it.
    val deadline = System.currentTimeMillis() + 10_000
    while (System.currentTimeMillis() < deadline && !ServerTelecomRegistry.isEnabled(context)) {
      val toggle = device.findObject(By.clazz("android.widget.Switch"))
        ?: device.findObject(By.clazz("androidx.appcompat.widget.SwitchCompat"))
      if (toggle != null && !toggle.isChecked) toggle.click()
      Thread.sleep(250)
    }
    device.pressBack()
    assertTrue("Server is listed but has not been enabled in Android calling-account settings",
      ServerTelecomRegistry.isEnabled(context))
  }

  @Test fun registeredServerAccountAppearsInSystemCallingAccountSettings() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    ensureServerCallingAccountEnabled(context, device)
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
    if (accountEnabled(context, handle)) return
    context.startActivity(Intent("android.telecom.action.CHANGE_PHONE_ACCOUNTS")
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    assertTrue("Android calling-account settings did not show $label",
      device.wait(Until.hasObject(By.text(label)), 15_000))
    device.findObject(By.text(label)).click()
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

  @Test fun systemDialerOffersServerBesideTestOnlySimAndRoutesCallToEngine() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    val prefs = context.getSharedPreferences("server-session", Context.MODE_PRIVATE)
    val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
    val serverHandle = ServerTelecomRegistry.handle(context)
    val mockSimHandle = android.telecom.PhoneAccountHandle(
      android.content.ComponentName(context, ServerConnectionService::class.java),
      "server-emulator-test-sim-1"
    )
    val previousToken = prefs.getString("access_token", null)
    val previousExpiry = prefs.getLong("access_expiry", 0L)
    val previousPhone = prefs.getString("phone", null)
    val previousSelectedPhone = prefs.getString("selected_sim_phone", null)
    val previousEngineAt = prefs.getLong("debug_last_call_engine_entered_at", 0L)
    val previousTargetKind = prefs.getString("debug_last_call_target_kind", null)
    val device = UiDevice.getInstance(instrumentation)
    var mockSimRegistered = false

    try {
      try {
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.RECORD_AUDIO)
      } catch (_: Exception) {}
      // This deliberately invalid token makes the backend reject the attempt before
      // it can create a call or send an SMS. The OS chooser and native routing still run.
      prefs.edit()
        .putString("access_token", "0".repeat(64))
        .putLong("access_expiry", System.currentTimeMillis() / 1000 + 3600)
        .putString("phone", "+15550001001")
        .putString("selected_sim_phone", "+15550001001")
        .remove("debug_last_call_engine_entered_at")
        .remove("debug_last_call_target_kind")
        .commit()

      ServerTelecomRegistry.register(context)
      ensureAccountEnabled(context, device, serverHandle, "Server")

      // The stock Android emulator has no carrier-backed SubscriptionInfo, so a
      // clearly labelled mock calling account exercises the OS account chooser.
      // It is not a real SIM or cellular subscription.
      val mockAccount = PhoneAccount.builder(mockSimHandle, "Test SIM 1 (mock)")
        .setCapabilities(PhoneAccount.CAPABILITY_CALL_PROVIDER)
        .setSupportedUriSchemes(listOf(PhoneAccount.SCHEME_TEL))
        .setShortDescription("Test-only simulated SIM account; not a carrier line")
        .setAddress(Uri.parse("tel:+15550001001"))
        .build()
      telecom.registerPhoneAccount(mockAccount)
      mockSimRegistered = true
      ensureAccountEnabled(context, device, mockSimHandle, "Test SIM 1 (mock)")

      val callCapable = telecom.callCapablePhoneAccounts
      assertTrue("Server is not a call-capable account in Android Telecom",
        callCapable.any { it == serverHandle })
      assertTrue("The test-only SIM account is missing from Android Telecom",
        callCapable.any { it == mockSimHandle })

      device.pressHome()
      Thread.sleep(500)
      // Deliberately omit EXTRA_PHONE_ACCOUNT_HANDLE so Android must offer the
      // available accounts instead of routing directly to Server by test instruction.
      instrumentation.uiAutomation.adoptShellPermissionIdentity(Manifest.permission.CALL_PHONE)
      try {
        telecom.placeCall(Uri.parse("tel:+15550001001"), Bundle())
      } finally {
        instrumentation.uiAutomation.dropShellPermissionIdentity()
      }

      val chooserDeadline = System.currentTimeMillis() + 12_000
      var serverChoice: androidx.test.uiautomator.UiObject2? = null
      var mockChoice: androidx.test.uiautomator.UiObject2? = null
      while (System.currentTimeMillis() < chooserDeadline && (serverChoice == null || mockChoice == null)) {
        serverChoice = device.findObject(By.text("Server"))
        mockChoice = device.findObject(By.text("Test SIM 1 (mock)"))
        Thread.sleep(200)
      }
      assertNotNull("Android did not show Server as an option in the system calling-account chooser", serverChoice)
      assertNotNull("Android did not show the test-only SIM beside Server", mockChoice)
      serverChoice!!.click()
      val justOnce = device.wait(Until.findObject(By.textContains("Just once")), 2_000)
      if (justOnce != null) justOnce.click()

      val deadline = System.currentTimeMillis() + 20_000
      while (System.currentTimeMillis() < deadline &&
        prefs.getLong("debug_last_call_engine_entered_at", 0L) == 0L) {
        Thread.sleep(200)
      }
      assertTrue(
        "Choosing Server in the system account chooser did not reach Server's call engine",
        prefs.getLong("debug_last_call_engine_entered_at", 0L) > 0L
      )
      assertEquals("A normal telephone URI must reach the phone-number call path",
        "phone", prefs.getString("debug_last_call_target_kind", null))
    } finally {
      val edit = prefs.edit()
      if (previousToken == null) edit.remove("access_token") else edit.putString("access_token", previousToken)
      edit.putLong("access_expiry", previousExpiry)
      if (previousPhone == null) edit.remove("phone") else edit.putString("phone", previousPhone)
      if (previousSelectedPhone == null) edit.remove("selected_sim_phone") else edit.putString("selected_sim_phone", previousSelectedPhone)
      if (previousEngineAt == 0L) edit.remove("debug_last_call_engine_entered_at") else edit.putLong("debug_last_call_engine_entered_at", previousEngineAt)
      if (previousTargetKind == null) edit.remove("debug_last_call_target_kind") else edit.putString("debug_last_call_target_kind", previousTargetKind)
      edit.commit()
      if (mockSimRegistered) {
        try { telecom.unregisterPhoneAccount(mockSimHandle) } catch (_: Exception) {}
      }
      ServerTelecomRegistry.register(context)
      device.executeShellCommand("am force-stop " + context.packageName)
    }
  }

  @Test fun serverRegistersAsSystemManagedPhoneAccountAndCarriesSelectedNumberMetadata() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
    val handle = ServerTelecomRegistry.handle(context)
    val prefs = context.getSharedPreferences("server-session", Context.MODE_PRIVATE)
    val previousNumber = prefs.getString("selected_sim_phone", null)

    try {
      prefs.edit().putString("selected_sim_phone", "+2348012345678").commit()
      ServerTelecomRegistry.register(context)
      val account = telecom.getPhoneAccount(handle)

      assertNotNull("Android Telecom did not register the Server calling account", account)
      assertTrue("Server account is not a call-provider account",
        (account!!.capabilities and PhoneAccount.CAPABILITY_CALL_PROVIDER) != 0)
      assertTrue("Server must be a system-managed call provider, not self-managed",
        (account.capabilities and PhoneAccount.CAPABILITY_SELF_MANAGED) == 0)
      assertTrue("Server must explicitly advertise tel URI support so the normal dialer can route numbers to it",
        account.supportedUriSchemes.contains(PhoneAccount.SCHEME_TEL))
      assertEquals("The selected SIM number must be carried as account metadata",
        Uri.parse("tel:+2348012345678"), account.address)
    } finally {
      val edit = prefs.edit()
      if (previousNumber == null) edit.remove("selected_sim_phone") else edit.putString("selected_sim_phone", previousNumber)
      edit.commit()
      ServerTelecomRegistry.register(context)
    }
  }
}