package com.server.caller

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.telecom.PhoneAccount
import android.telecom.TelecomManager
import android.util.Log
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
import java.io.File

@RunWith(AndroidJUnit4::class)
class CallerSmokeTest {
  @Test fun launcherOpensWebsiteOnboardingInsteadOfCustomDialer() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    // Explicitly grant SIM metadata access in the emulator so the test can
    // cover the selection path after permissions, not stop at the permission gate.
    try { instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.READ_PHONE_STATE) } catch (_: Exception) {}
    try { instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.READ_PHONE_NUMBERS) } catch (_: Exception) {}
    context.getSharedPreferences("server-session", Context.MODE_PRIVATE).edit()
      .putBoolean("server_open_dialer_after_account_enable", false)
      .remove("selected_sim_subscription_id")
      .remove("selected_sim_slot")
      .remove("selected_sim_carrier")
      .remove("selected_sim_phone")
      .commit()
    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
    assertNotNull("Server does not expose a launcher entry", launchIntent)
    assertEquals("The launcher must open the website onboarding bridge",
      ServerSetupWebActivity::class.java.name, launchIntent!!.component?.className)

    ActivityScenario.launch<ServerSetupWebActivity>(launchIntent).use {
      val device = UiDevice.getInstance(instrumentation)
      assertTrue("Website onboarding brand is not visible",
        device.wait(Until.hasObject(By.text("server")), 20_000))
      assertTrue("SIM-first web onboarding step is not visible",
        device.wait(Until.hasObject(By.textContains("Choose your SIM")), 20_000))
      val detectButton = device.wait(Until.findObject(By.textContains("Allow SIM access and detect SIMs")), 10_000)
      assertNotNull("SIM permission/detection button is not visible", detectButton)
      detectButton!!.click()

      val subscriptionManager = context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as android.telephony.SubscriptionManager
      val activeSim = try {
        subscriptionManager.activeSubscriptionInfoList.orEmpty().sortedBy { it.simSlotIndex }.firstOrNull()
      } catch (_: Exception) { null }
      val expectedId = activeSim?.subscriptionId ?: -1001
      val expectedSlot = activeSim?.simSlotIndex?.takeIf { it >= 0 }?.plus(1) ?: 1
      val visibleLabel = if (activeSim == null) "Emulator test SIM" else "SIM " + expectedSlot + " ·"
      val simChoice = device.wait(Until.findObject(By.textContains(visibleLabel)), 12_000)
      assertNotNull("The website did not render an active SIM or labelled emulator test SIM", simChoice)
      simChoice!!.click()

      val savedPrefs = context.getSharedPreferences("server-session", Context.MODE_PRIVATE)
      assertEquals("Selecting a SIM in the website must persist its selected subscription id",
        expectedId, savedPrefs.getInt("selected_sim_subscription_id", -1))
      assertTrue("The website did not update its visible selection status",
        device.wait(Until.hasObject(By.textContains("Selected SIM")), 5_000))
      if (activeSim == null) {
        assertEquals("The emulator fixture must be labelled as a mock rather than a carrier line",
          "Emulator test SIM (not a real line)", savedPrefs.getString("selected_sim_carrier", ""))
      } else {
        assertEquals("The selected subscription must persist its real slot",
          activeSim.simSlotIndex, savedPrefs.getInt("selected_sim_slot", -1))
      }
      val continueButton = findTextOnScrollableScreen(context, device, "Continue to calling permissions")
      assertNotNull("SIM selection did not advance the web flow. See ServerUITest hierarchy in logcat.", continueButton)
      continueButton!!.click()
      assertNotNull("The website did not advance to the calling-permission step",
        findTextOnScrollableScreen(context, device, "Allow Server calling"))
      assertTrue("A custom number-entry dialer unexpectedly appeared",
        !device.hasObject(By.text("Call a number")))
    }
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

  private fun grantPhoneMetadataPermissions(context: Context) {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    for (permission in listOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_PHONE_NUMBERS, Manifest.permission.RECORD_AUDIO)) {
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
    val accountRow = findTextOnScrollableScreen(context, device, label)
    assertNotNull("Android calling-account settings did not show $label. See ServerUITest hierarchy in logcat.", accountRow)
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
    val device = UiDevice.getInstance(instrumentation)
    var testAccountRegistered = false

    try {
      try { instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.RECORD_AUDIO) } catch (_: Exception) {}
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

      device.pressHome()
      context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:+15550001001"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))

      // Exercise the handset’s bundled Phone UI, not TelecomManager.placeCall from
      // instrumentation, so this test checks the user-visible outgoing-call path.
      val callButton = device.wait(Until.findObject(By.descContains("Call")), 12_000)
        ?: device.wait(Until.findObject(By.text("Call")), 2_000)
      assertNotNull("The preinstalled Phone app did not expose its Call action for a tel: URI", callButton)
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
      assertTrue("Choosing Server from the preinstalled Phone app did not reach Server’s call engine",
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
      // Do not force-stop the target package from instrumentation cleanup: on
      // Android this can kill the instrumentation process before JUnit reports
      // the real call-picker assertion. Returning to Home is enough for cleanup.
      device.pressHome()
    }
  }

  @Test fun serverRegistersAsSystemManagedPhoneAccountAndCarriesSelectedNumberMetadata() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    grantPhoneMetadataPermissions(context)
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
      assertTrue("Server must not masquerade as a cellular SIM",
        (account.capabilities and PhoneAccount.CAPABILITY_SIM_SUBSCRIPTION) == 0)
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