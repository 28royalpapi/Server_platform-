package com.server.caller

import android.Manifest
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.rule.GrantPermissionRule
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import org.hamcrest.Matchers.containsString
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CallerSmokeTest {
  @get:Rule val microphone = GrantPermissionRule.grant(Manifest.permission.RECORD_AUDIO)

  @Test fun firstLaunchShowsPhoneVerificationAndNoFakeCode() {
    ActivityScenario.launch(MainActivity::class.java).use {
      onView(withText("SERVER")).check(matches(isDisplayed()))
      onView(withId(R.id.server_phone)).check(matches(isDisplayed()))
      onView(withId(R.id.server_send_otp)).check(matches(withText("Send real SMS code")))
      onView(withText(containsString("No code is invented by this app"))).check(matches(isDisplayed()))
    }
  }
}
