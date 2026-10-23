package com.server.caller

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
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

    ActivityScenario.launch(launchIntent).use {
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


  @Test fun registeredServerAccountAppearsInSystemCallingAccountSettings() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    ServerTelecomRegistry.register(context)
    val settings = Intent("android.telecom.action.CHANGE_PHONE_ACCOUNTS")
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(settings)

    val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    val serverEntry = device.wait(Until.findObject(By.text("Server")), 15_000)
    assertNotNull("Android calling-account settings did not show Server", serverEntry)
    // Exercise the real system consent toggle instead of treating registration or
    // APK installation as proof that the calling account is available.
    if (!ServerTelecomRegistry.isEnabled(context)) {
      serverEntry!!.click()
      val deadline = System.currentTimeMillis() + 10_000
      while (System.currentTimeMillis() < deadline && !ServerTelecomRegistry.isEnabled(context)) {
        Thread.sleep(250)
      }
    }
    assertTrue("Server is listed but has not been enabled in Android calling-account settings",
      ServerTelecomRegistry.isEnabled(context))
    device.pressBack()
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