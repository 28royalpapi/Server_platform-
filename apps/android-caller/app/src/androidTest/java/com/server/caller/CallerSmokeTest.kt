package com.server.caller

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import org.hamcrest.Matchers.containsString
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CallerSmokeTest {
  @Test fun firstLaunchShowsDeviceFirstSetupAndNoOtpForm() {
    ActivityScenario.launch(MainActivity::class.java).use {
      onView(withText("SERVER")).check(matches(isDisplayed()))
      onView(withText("Choose the SIM you want Server to use")).check(matches(isDisplayed()))
      onView(withText(containsString("does not clone its number"))).check(matches(isDisplayed()))
      onView(withText("Detect SIM cards / grant permission")).check(matches(isDisplayed()))
      onView(withText("Create Server ID — internet calling only")).check(matches(isDisplayed()))
    }
  }
}