package com.server.caller

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
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
}