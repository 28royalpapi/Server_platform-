package com.server.receiver

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WakeNumberMatcherTest {
  @Test fun normalizesNigerianNationalNumbers() {
    assertTrue(WakeNumberMatcher.matches("08031234567", "+2348031234567"))
  }

  @Test fun normalizesInternationalNumbers() {
    assertTrue(WakeNumberMatcher.matches("+2348031234567", "2348031234567"))
  }

  @Test fun doesNotMatchDifferentNumbers() {
    assertFalse(WakeNumberMatcher.matches("+2348031234567", "+2348031234568"))
  }

  @Test fun rejectsMalformedNumbers() {
    assertFalse(WakeNumberMatcher.matches("unknown", "+2348031234567"))
  }
}
