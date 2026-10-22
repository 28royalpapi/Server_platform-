package com.server.caller

import android.content.Context
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
  @Test fun firstLaunchShowsDeviceFirstSetupAndNoOtpForm() {
    ActivityScenario.launch(MainActivity::class.java).use {
      val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
      device.waitForIdle()

      assertTrue("Server onboarding brand is not visible",
        device.wait(Until.hasObject(By.text("SERVER")), 10_000))
      assertTrue("SIM-selection step is not visible",
        device.wait(Until.hasObject(By.text("Choose the SIM you want Server to use")), 10_000))
      assertNotNull("No-OTP number-cloning warning is not visible",
        device.findObject(By.textContains("does not clone its number")))
      assertNotNull("Explicit SIM-permission step is not visible",
        device.findObject(By.text("Detect SIM cards / grant permission")))
      assertNotNull("No-OTP registration action is not visible",
        device.findObject(By.text("Create Server ID — internet calling only")))
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