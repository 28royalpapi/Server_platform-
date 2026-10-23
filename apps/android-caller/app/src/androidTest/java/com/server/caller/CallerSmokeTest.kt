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
  @Test fun launcherOpensWebOnboardingInsteadOfNativeNumberEntryScreen() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    // Pre-grant only the SIM metadata permissions so this UI test can exercise
    // the chooser deterministically without leaving a runtime prompt on screen.
    try { instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.READ_PHONE_STATE) } catch (_: Exception) {}
    try { instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.READ_PHONE_NUMBERS) } catch (_: Exception) {}
    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
    assertNotNull("Server does not expose a launcher entry", launchIntent)
    assertEquals("The launcher must open the web onboarding bridge",
      ServerSetupWebActivity::class.java.name, launchIntent!!.component?.className)

    ActivityScenario.launch<ServerSetupWebActivity>(launchIntent).use {
      val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
      assertTrue("Web onboarding brand is not visible",
        device.wait(Until.hasObject(By.text("SERVER")), 20_000))
      assertTrue("SIM-first web onboarding step is not visible",
        device.wait(Until.hasObject(By.textContains("Choose your SIM")), 20_000))
      assertTrue("SIM permission action is not visible",
        device.wait(Until.hasObject(By.textContains("Allow SIM access and detect SIMs")), 10_000))
      val emulatorSim = device.wait(Until.findObject(By.textContains("Emulator test SIM")), 10_000)
      assertNotNull("The debug emulator must expose a clearly-labelled test SIM fixture", emulatorSim)
      emulatorSim!!.click()
      val savedPrefs = context.getSharedPreferences("server-session", Context.MODE_PRIVATE)
      assertEquals("Selecting a SIM in the website must persist its chosen subscription id",
        -1001, savedPrefs.getInt("selected_sim_subscription_id", -1))
      assertEquals("The emulator fixture must be explicitly labelled as a mock, not a carrier line",
        "Emulator test SIM (not a real line)", savedPrefs.getString("selected_sim_carrier", ""))
      val continueButton = device.wait(Until.findObject(By.textContains("Continue to calling permissions")), 10_000)
      assertNotNull("SIM selection did not advance the web flow", continueButton)
      continueButton!!.click()
      assertTrue("The website did not advance to the calling-permission step",
        device.wait(Until.hasObject(By.textContains("Allow Server calling")), 10_000))
      assertTrue("The old native number-entry caller screen appeared",
        !device.hasObject(By.text("Call a number")))
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

  @Test fun systemOriginatedOutgoingTelCallReachesServerCallEngine() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    val prefs = context.getSharedPreferences("server-session", Context.MODE_PRIVATE)
    val previousToken = prefs.getString("access_token", null)
    val previousExpiry = prefs.getLong("access_expiry", 0L)
    val previousPhone = prefs.getString("phone", null)
    val previousSelectedPhone = prefs.getString("selected_sim_phone", null)
    val previousEngineAt = prefs.getLong("debug_last_call_engine_entered_at", 0L)
    val previousTargetKind = prefs.getString("debug_last_call_target_kind", null)
    val device = UiDevice.getInstance(instrumentation)

    try {
      try {
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.RECORD_AUDIO)
      } catch (_: Exception) {}
      // This intentionally invalid access token causes the backend to reject the
      // request before creating a call. No SMS, recipient notification or real
      // carrier call can be produced by this test.
      prefs.edit()
        .putString("access_token", "0".repeat(64))
        .putLong("access_expiry", System.currentTimeMillis() / 1000 + 3600)
        .putString("phone", "+15550001001")
        .putString("selected_sim_phone", "+15550001001")
        .remove("debug_last_call_engine_entered_at")
        .remove("debug_last_call_target_kind")
        .commit()
      ServerTelecomRegistry.register(context)
      ensureServerCallingAccountEnabled(context, device)

      val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
      val extras = Bundle().apply {
        putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, ServerTelecomRegistry.handle(context))
      }
      instrumentation.uiAutomation.adoptShellPermissionIdentity(Manifest.permission.CALL_PHONE)
      try {
        telecom.placeCall(Uri.parse("tel:+15550001001"), extras)
      } finally {
        instrumentation.uiAutomation.dropShellPermissionIdentity()
      }

      val deadline = System.currentTimeMillis() + 20_000
      while (System.currentTimeMillis() < deadline &&
        prefs.getLong("debug_last_call_engine_entered_at", 0L) == 0L) {
        Thread.sleep(200)
      }
      assertTrue(
        "Android Telecom did not route a system-originated tel: call into Server's call engine",
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
      ServerTelecomRegistry.register(context)
      // The test intentionally uses an invalid session. Stop the transient call
      // engine activity so its background polling cannot leak into other tests.
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