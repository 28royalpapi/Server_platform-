package com.server.caller

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.ContactsContract
import android.telecom.Connection
import android.telecom.PhoneAccount
import android.telecom.TelecomManager
import android.util.Log
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.StaleObjectException
import androidx.test.uiautomator.Until
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import com.google.i18n.phonenumbers.PhoneNumberUtil
import org.junit.Test
import org.webrtc.AudioTrack
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.RTCStatsCollectorCallback
import org.webrtc.RTCStatsReport
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.audio.JavaAudioDeviceModule
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import java.util.Collections

@RunWith(AndroidJUnit4::class)
class CallerSmokeTest {
  @Test fun internationalNumberingMetadataCoversEverySupportedRegion() {
    val phoneUtil = PhoneNumberUtil.getInstance()
    val regions = phoneUtil.supportedRegions
    assertTrue("libphonenumber must include worldwide geographical numbering metadata", regions.size > 200)

    var examplesChecked = 0
    regions.sorted().forEach { region ->
      assertTrue("Every bundled region must have a valid calling code: $region",
        phoneUtil.getCountryCodeForRegion(region) > 0)
      val example = phoneUtil.getExampleNumber(region) ?: return@forEach
      val national = phoneUtil.format(example, PhoneNumberUtil.PhoneNumberFormat.NATIONAL)
      val expectedE164 = phoneUtil.format(example, PhoneNumberUtil.PhoneNumberFormat.E164)
      assertEquals("The national number example must round-trip for region $region",
        expectedE164, ServerPhoneNumberNormalizer.toE164(national, region))
      examplesChecked++
    }
    assertTrue("The bundled worldwide metadata should provide examples for at least 150 regions",
      examplesChecked >= 150)
  }

  @Test fun destinationCountryFromSavedContactMetadataBeatsCallerRegion() {
    val phoneUtil = PhoneNumberUtil.getInstance()
    val ukExample = phoneUtil.getExampleNumber("GB")
    assertNotNull("A UK test number must exist in the worldwide metadata", ukExample)
    val ukNational = phoneUtil.format(ukExample, PhoneNumberUtil.PhoneNumberFormat.NATIONAL)
    val ukE164 = phoneUtil.format(ukExample, PhoneNumberUtil.PhoneNumberFormat.E164)

    assertEquals("An Android-inferred NORMALIZED_NUMBER without independent contact country is rejected",
      null, ServerPhoneNumberNormalizer.toE164WithContactMetadata(ukNational, "NG", ukE164, null))
    assertEquals("A literal + prefixed saved contact number is trusted without postal country metadata",
      ukE164, ServerPhoneNumberNormalizer.toE164WithContactMetadata(ukNational, "NG", ukE164, null, normalizedNumberIsExplicitInternational = true))
    assertEquals("A provider-normalized number conflicting with contact country is ignored in favour of the contact country",
      ukE164, ServerPhoneNumberNormalizer.toE164WithContactMetadata(ukNational, "NG", "+2348012345678", "United Kingdom"))
    assertEquals("The contact postal country supplies the destination region when provider normalization is absent",
      ukE164, ServerPhoneNumberNormalizer.toE164WithContactMetadata(ukNational, "NG", null, "United Kingdom"))
    assertEquals("The contact country can also be supplied as an ISO region code",
      ukE164, ServerPhoneNumberNormalizer.toE164WithContactMetadata(ukNational, "NG", null, "GB"))

    val egyptExample = phoneUtil.getExampleNumber("EG")
    assertNotNull("Egypt must be included in the same global metadata set", egyptExample)
    val egyptNational = phoneUtil.format(egyptExample, PhoneNumberUtil.PhoneNumberFormat.NATIONAL)
    val egyptE164 = phoneUtil.format(egyptExample, PhoneNumberUtil.PhoneNumberFormat.E164)
    assertEquals("Egyptian contact country is independent of the caller's Nigerian region",
      egyptE164, ServerPhoneNumberNormalizer.toE164WithContactMetadata(egyptNational, "NG", null, "Egypt"))

    val indiaExample = phoneUtil.getExampleNumber("IN")
    assertNotNull("India must be included in the same global metadata set", indiaExample)
    val indiaNational = phoneUtil.format(indiaExample, PhoneNumberUtil.PhoneNumberFormat.NATIONAL)
    val indiaE164 = phoneUtil.format(indiaExample, PhoneNumberUtil.PhoneNumberFormat.E164)
    assertEquals("Indian contact country is independent of the caller's Nigerian region",
      indiaE164, ServerPhoneNumberNormalizer.toE164WithContactMetadata(indiaNational, "NG", null, "India"))
  }

  @Test fun explicitInternationalNumbersAndCallerRegionFallbackRemainSupported() {
    assertEquals("Nigerian national format still works when the number is local to the caller's region",
      "+2348012345678", ServerPhoneNumberNormalizer.toE164("08012345678", "NG"))
    assertEquals("International + format does not depend on caller country",
      "+447911123456", ServerPhoneNumberNormalizer.toE164("+447911123456", "EG"))
    assertEquals("Nigeria's actual 009 international access prefix resolves a UK destination",
      "+447911123456", ServerPhoneNumberNormalizer.toE164("00944 7911 123456", "NG"))
    assertEquals("The 00 international access prefix works for a region that uses it",
      "+447911123456", ServerPhoneNumberNormalizer.toE164("0044 7911 123456", "GB"))
    assertEquals("UK national format remains supported when the caller/default region is GB",
      "+447911123456", ServerPhoneNumberNormalizer.toE164("07911 123456", "GB"))
    assertEquals("A matched national-format contact without independent country metadata is rejected",
      null, ServerPhoneNumberNormalizer.toE164WithContactMetadata("07911123456", "NG", "+2347911123456", null, contactMatched = true))
    assertEquals("A manual number with no matching saved contact may use the caller's region",
      "+2348012345678", ServerPhoneNumberNormalizer.toE164WithContactMetadata("08012345678", "NG", null, null, contactMatched = false))
    assertEquals("A number with non-phone text is rejected",
      null, ServerPhoneNumberNormalizer.toE164("not a phone number", "NG"))
  }

  @Test fun guestCallInvitationNotificationOffersExplicitShareAndSmsActions() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    if (android.os.Build.VERSION.SDK_INT >= 33 &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
      instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
    }

    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
    val callId = "guest-share-" + UUID.randomUUID().toString()
    val phone = "+2348012345678"
    val invitation = "SVR-ABCDEF1234 is calling you. Open https://server-onboarding-ochre.vercel.app/guest.html#token=" +
      "a".repeat(64) + " and tap Answer."
    try {
      assertTrue("A guest invitation must be shareable through a native reminder notification",
        ServerGuestInviteNotifications.show(context, callId, phone, invitation))
      val notificationId = ServerGuestInviteNotifications.notificationId(callId)
      val deadline = System.currentTimeMillis() + 5_000
      var posted = manager.activeNotifications.firstOrNull { it.id == notificationId }
      while (posted == null && System.currentTimeMillis() < deadline) {
        Thread.sleep(100)
        posted = manager.activeNotifications.firstOrNull { it.id == notificationId }
      }
      assertNotNull("The secure guest invitation notification was not posted", posted)
      assertTrue("The notification must offer an explicit Share invitation action",
        posted!!.notification.actions.any { it.title.toString() == "Share invitation" })
      assertTrue("The guest notification must also offer the caller-confirmed carrier flash-call handoff",
        posted!!.notification.actions.any { it.title.toString() == "Try carrier flash call" })
      val carrierIntent = ServerCarrierDialer.createIntent(phone)
      assertEquals("The carrier fallback must open Android's native dialler, not place a call silently",
        Intent.ACTION_DIAL, carrierIntent?.action)
      assertEquals("The carrier dialler must target the intended E.164 number",
        phone, carrierIntent?.data?.schemeSpecificPart)
      assertNotNull("Tapping the notification must open the native share activity", posted.notification.contentIntent)

      val chooser = ServerGuestInviteShareActivity.createShareChooserIntent(phone, invitation)
      assertEquals("The activity must open Android's native chooser", Intent.ACTION_CHOOSER, chooser.action)
      val shareIntent = chooser.getParcelableExtra(Intent.EXTRA_INTENT) as? Intent
      assertEquals("The general share target must use ACTION_SEND", Intent.ACTION_SEND, shareIntent?.action)
      assertEquals("The invitation must be plain text", "text/plain", shareIntent?.type)
      assertEquals("The secure browser invite must be included unchanged", invitation, shareIntent?.getStringExtra(Intent.EXTRA_TEXT))
      val initialIntents = chooser.getParcelableArrayExtra(Intent.EXTRA_INITIAL_INTENTS)
        ?.filterIsInstance<Intent>().orEmpty()
      val smsIntent = initialIntents.firstOrNull { it.action == Intent.ACTION_SENDTO }
      assertNotNull("The chooser must offer an optional addressed SMS composer", smsIntent)
      assertEquals("The SMS composer must target the original saved-contact number", phone, smsIntent!!.data?.schemeSpecificPart)
      assertEquals("The SMS body must contain the secure guest invitation", invitation, smsIntent.getStringExtra("sms_body"))
    } finally {
      ServerGuestInviteNotifications.cancel(context, callId)
    }
  }

  @Test fun incomingServerCallPostsNativeCallStyleAlertWithRingtoneAndDndSettings() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    if (android.os.Build.VERSION.SDK_INT >= 33) {
      try {
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
      } catch (_: Exception) {}
      assertEquals("Incoming call alerts need notification permission",
        android.content.pm.PackageManager.PERMISSION_GRANTED,
        context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS))
    }

    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
    val callId = "notification-" + UUID.randomUUID().toString()
    val notificationId = ServerCallNotifications.notificationId(callId)
    val prefs = context.getSharedPreferences("server-session", Context.MODE_PRIVATE)
    val previousToken = prefs.getString("access_token", null)
    val needsCallStyleForegroundService = android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S
    if (needsCallStyleForegroundService) {
      val handle = ServerTelecomRegistry.handle(context)
      ServerTelecomRegistry.register(context)
      enablePhoneAccountWithTestShell(context, handle)
      val accountDeadline = System.currentTimeMillis() + 12_000
      while (!ServerTelecomRegistry.isEnabled(context) && System.currentTimeMillis() < accountDeadline) {
        Thread.sleep(100)
      }
      assertTrue("The Server PhoneAccount must be enabled before testing an incoming foreground call",
        ServerTelecomRegistry.isEnabled(context))
      prefs.edit().putString("access_token", "0".repeat(64)).commit()
    }
    try {
      if (needsCallStyleForegroundService) {
        // Match the live signed-in path: incoming CallStyle notifications are
        // posted while ServerIncomingCallService is running as a phoneCall FGS.
        ServerIncomingCallService.start(context)
        val foregroundDeadline = System.currentTimeMillis() + 8_000
        var foregroundCallListener = false
        while (!foregroundCallListener && System.currentTimeMillis() < foregroundDeadline) {
          foregroundCallListener = manager.activeNotifications.any {
            it.notification.channelId == "server-incoming-calls"
          }
          if (!foregroundCallListener) Thread.sleep(100)
        }
        assertTrue("Server's phoneCall foreground service must start before posting CallStyle",
          foregroundCallListener)
      }
      ServerCallNotifications.show(context, callId, "SVR-12AB34CD56")
      val notificationDeadline = System.currentTimeMillis() + 8_000
      var posted = manager.activeNotifications.firstOrNull {
        it.id == notificationId && it.notification.channelId == ServerCallNotifications.CHANNEL_ID
      }
      while (posted == null && System.currentTimeMillis() < notificationDeadline) {
        Thread.sleep(100)
        posted = manager.activeNotifications.firstOrNull {
          it.id == notificationId && it.notification.channelId == ServerCallNotifications.CHANNEL_ID
        }
      }
      assertNotNull("An incoming Server call must post a native ringing notification", posted)
      // CallStyle retains CATEGORY_CALL. Confirm the independent foreground-service
      // association via FLAG_FOREGROUND_SERVICE instead of inheriting the listener's
      // CATEGORY_SERVICE notification metadata.
      assertEquals("Incoming Server alerts must retain the native call notification category",
        android.app.Notification.CATEGORY_CALL, posted!!.notification.category)
      if (needsCallStyleForegroundService) {
        assertTrue("Incoming Server CallStyle must be backed by its dedicated phoneCall foreground service",
          (posted.notification.flags and android.app.Notification.FLAG_FOREGROUND_SERVICE) != 0)
      }
      assertEquals("The incoming call must use its dedicated ringtone channel", ServerCallNotifications.CHANNEL_ID,
        posted.notification.channelId)

      val channel = manager.getNotificationChannel(ServerCallNotifications.CHANNEL_ID)
      assertNotNull("The incoming-call ringtone channel was not created", channel)
      assertEquals("Incoming Server calls need high notification importance",
        android.app.NotificationManager.IMPORTANCE_HIGH, channel!!.importance)
      assertEquals("The channel must use the system's default ringtone",
        android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_RINGTONE), channel.sound)
      assertTrue("The incoming-call channel must support vibration", channel.shouldVibrate())
      assertFalse("Server must never bypass the user's Do Not Disturb settings", channel.canBypassDnd())

      if (android.os.Build.VERSION.SDK_INT >= 34) {
        assertEquals("Android 14+ must receive the incoming CallStyle type",
          android.app.Notification.CallStyle.CALL_TYPE_INCOMING,
          posted.notification.extras.getInt(android.app.Notification.EXTRA_CALL_TYPE,
            android.app.Notification.CallStyle.CALL_TYPE_UNKNOWN))
      }

      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
        ServerCallNotifications.silence(context, callId, "SVR-12AB34CD56")
        val silenceDeadline = System.currentTimeMillis() + 8_000
        var silenced = manager.activeNotifications.firstOrNull { it.id == notificationId }
        while ((silenced == null || silenced.notification.channelId != ServerCallNotifications.SILENT_CHANNEL_ID) &&
          System.currentTimeMillis() < silenceDeadline) {
          Thread.sleep(100)
          silenced = manager.activeNotifications.firstOrNull { it.id == notificationId }
        }
        assertNotNull("Silencing the ringtone must retain the incoming call notification", silenced)
        assertEquals("Silencing must move the visible call to the silent notification channel",
          ServerCallNotifications.SILENT_CHANNEL_ID, silenced!!.notification.channelId)
        assertTrue("Silence action must suppress repeat ringtone alerts",
          (silenced.notification.flags and android.app.Notification.FLAG_ONLY_ALERT_ONCE) != 0)
        val silentChannel = manager.getNotificationChannel(ServerCallNotifications.SILENT_CHANNEL_ID)
        assertNotNull("The silent incoming-call channel was not created", silentChannel)
        assertEquals("Silenced calls must not play a ringtone", null, silentChannel!!.sound)
        assertFalse("Silenced calls must not vibrate", silentChannel.shouldVibrate())
      }
    } finally {
      ServerCallNotifications.cancel(context, callId)
      if (needsCallStyleForegroundService) ServerIncomingCallService.stop(context)
      if (needsCallStyleForegroundService) {
        val restore = prefs.edit()
        if (previousToken == null) restore.remove("access_token") else restore.putString("access_token", previousToken)
        restore.commit()
      }
    }
  }

  @Test fun missedServerCallNotificationOffersQuietCallbackAction() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    if (android.os.Build.VERSION.SDK_INT >= 33) {
      try {
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
      } catch (_: Exception) {}
      assertEquals("Missed-call alerts need notification permission",
        android.content.pm.PackageManager.PERMISSION_GRANTED,
        context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS))
    }

    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
    val callId = "missed-" + UUID.randomUUID().toString()
    val notificationId = 7600 + (callId.hashCode() and 0x0000FFFF)
    try {
      assertTrue("Missed-call notification should be accepted when notification permission is granted",
        ServerCallNotifications.showMissed(context, callId, "SVR-12AB34CD56"))
      val notificationDeadline = System.currentTimeMillis() + 5_000
      var posted = manager.activeNotifications.firstOrNull { it.id == notificationId }
      while (posted == null && System.currentTimeMillis() < notificationDeadline) {
        Thread.sleep(100)
        posted = manager.activeNotifications.firstOrNull { it.id == notificationId }
      }
      assertNotNull("A call missed while offline must appear after reconnect", posted)
      assertEquals("The notification must be categorised as a missed call",
        android.app.Notification.CATEGORY_MISSED_CALL, posted!!.notification.category)
      assertTrue("The missed-call notification must offer a Call back action",
        posted.notification.actions.any { it.title.toString() == "Call back" })
      val channel = manager.getNotificationChannel(posted.notification.channelId)
      assertNotNull("The quiet missed-call channel was not created", channel)
      assertEquals("Missed-call alerts must not ring",
        android.app.NotificationManager.IMPORTANCE_DEFAULT, channel!!.importance)
      assertEquals("Missed-call alerts must be silent", null, channel.sound)
      assertFalse("Missed-call alerts must not vibrate", channel.shouldVibrate())

      val callback = ServerCallNotifications.buildMissedCallIntent(context, callId, "SVR-12AB34CD56")
      assertEquals("missed_callback", callback.getStringExtra("server_action"))
      assertEquals("SVR-12AB34CD56", callback.getStringExtra("server_caller_id"))
    } finally {
      manager.cancel(notificationId)
    }
  }

  @Test fun telecomCallTargetRoutesServerIdsWithoutPhoneNumberNormalization() {
    var phoneNormalizationAttempted = false
    val target = ServerCallTarget.parse(" svr-abcdef1234 ") {
      phoneNormalizationAttempted = true
      null
    }
    assertNotNull("A Server ID must be accepted as a first-class call identity", target)
    assertEquals("SVR-ABCDEF1234", target!!.serverId)
    assertEquals(null, target.phoneNumber)
    val payload = target.toStartPayload("android_telecom")
    assertEquals("SVR-ABCDEF1234", payload.optString("to_server_id"))
    assertFalse("A Server-ID call must not be converted into a phone-number lookup", payload.has("to_phone"))
    assertFalse("Server IDs must bypass E.164 phone normalisation", phoneNormalizationAttempted)
  }

  @Test fun serverCallUsesInternetCapabilityWithoutCarrierValidationFalseNegatives() {
    assertFalse("No active network must block Server internet calling",
      isServerInternetUsable(false, false))
    assertFalse("A connected transport without INTERNET capability must not start a Server call",
      isServerInternetUsable(false, true))
    assertTrue("A mobile-data/Wi-Fi network with INTERNET capability must be tried even if Android's validation probe is false",
      isServerInternetUsable(true, false))
    assertTrue("Validated Wi-Fi or mobile data must allow Server to attempt the call",
      isServerInternetUsable(true, true))
  }

  private fun evaluateSetupWebView(
    scenario: ActivityScenario<ServerSetupWebActivity>,
    javascript: String
  ): String {
    val value = AtomicReference("null")
    val completed = CountDownLatch(1)
    scenario.onActivity { activity ->
      val field = ServerSetupWebActivity::class.java.getDeclaredField("web")
      field.isAccessible = true
      val web = field.get(activity) as WebView
      web.evaluateJavascript(javascript) { result ->
        value.set(result ?: "null")
        completed.countDown()
      }
    }
    assertTrue("Server onboarding WebView did not return its DOM state", completed.await(5, TimeUnit.SECONDS))
    return value.get().trim('"')
  }

  /**
   * Taps the actual HTML element at its rendered WebView coordinates.
   * WebView accessibility nodes for HTML checkboxes can cover the whole label
   * on older Android releases, making UiObject2.click() land on nearby links.
   * This keeps the acceptance test a real screen tap, not a JavaScript state change.
   */
  private fun tapWebViewElement(scenario: ActivityScenario<ServerSetupWebActivity>, selector: String): Boolean {
    val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    // First tap the actual input. If a device-specific WebView hit target is too
    // small, tap its associated label as a second real screen gesture; do not use
    // HTMLElement.click() or mutate checkbox state from JavaScript.
    val targets = if (selector == "#native-terms") {
      listOf(selector, "label[for='native-terms']")
    } else listOf(selector)

    for (target in targets) {
      for (attempt in 0 until 3) {
        evaluateSetupWebView(
          scenario,
          "(function(){var e=document.querySelector(\"$target\");if(!e)return 'missing';e.scrollIntoView({block:'center',inline:'center',behavior:'instant'});return 'ready';})()"
        )
        Thread.sleep(180)
        val point = evaluateSetupWebView(
          scenario,
          "(function(){var e=document.querySelector(\"$target\");if(!e)return 'missing';var r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,window.devicePixelRatio||1].join(',');})()"
        )
        val coordinates = point.split(',').mapNotNull { it.trim().toFloatOrNull() }
        if (coordinates.size != 3) return false

        val screenLocation = IntArray(2)
        scenario.onActivity { activity ->
          val field = ServerSetupWebActivity::class.java.getDeclaredField("web")
          field.isAccessible = true
          val web = field.get(activity) as WebView
          web.getLocationOnScreen(screenLocation)
        }

        // DOMRect values are CSS pixels. devicePixelRatio maps them to the
        // physical screen coordinate space used by UiDevice across densities.
        val scale = coordinates[2]
        val x = screenLocation[0] + (coordinates[0] * scale).toInt()
        val y = screenLocation[1] + (coordinates[1] * scale).toInt()
        device.click(x, y)
        Thread.sleep(180)
        if (evaluateSetupWebView(
            scenario,
            "(function(){var e=document.querySelector('#native-terms');return !!e && e.checked;})()"
          ) == "true") return true
      }
    }
    return false
  }

  @Test fun launcherShowsServerIdFirstOnboardingWithoutSimPermissions() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    assertEquals("Server must not request access to SIM phone numbers",
      android.content.pm.PackageManager.PERMISSION_DENIED,
      context.checkSelfPermission("android.permission.READ_PHONE_NUMBERS"))
    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
    assertNotNull("Server does not expose a launcher entry", launchIntent)
    assertEquals("The launcher must open the Server website onboarding bridge",
      ServerSetupWebActivity::class.java.name, launchIntent!!.component?.className)

    ActivityScenario.launch<ServerSetupWebActivity>(launchIntent).use { scenario ->
      val device = UiDevice.getInstance(instrumentation)
      assertTrue("Server onboarding brand is not visible",
        device.wait(Until.hasObject(By.text("server")), 20_000))
      assertTrue("Server ID-first setup heading is not visible",
        device.wait(Until.hasObject(By.textContains("Create your Server identity")), 20_000))
      assertTrue("The setup must explain that SIM selection is not required",
        device.wait(Until.hasObject(By.textContains("No SIM selection and no SMS OTP are required")), 10_000))
      assertTrue("The old SIM-selection UI must not appear",
        !device.hasObject(By.textContains("Choose your SIM")))
      assertTrue("The old SIM permission button must not appear",
        !device.hasObject(By.textContains("Allow SIM access")))

      val initialTerms = evaluateSetupWebView(
        scenario,
        "(function(){var e=document.querySelector('#native-terms');return !!e && !e.checked;})()"
      )
      assertEquals("Legal acceptance must start unchecked in the actual onboarding page", "true", initialTerms)

      // Tap the centre of the real HTML input, not the larger accessibility
      // label projection. This avoids accidentally activating the adjacent legal links.
      assertTrue("The actual HTML consent checkbox must be visible and tappable",
        tapWebViewElement(scenario, "#native-terms"))
      var termsAccepted = false
      val termsDeadline = System.currentTimeMillis() + 5_000
      while (System.currentTimeMillis() < termsDeadline && !termsAccepted) {
        termsAccepted = evaluateSetupWebView(
          scenario,
          "(function(){var e=document.querySelector('#native-terms');var b=document.querySelector('#grant-call-permissions');return !!e && e.checked && !!b && !b.disabled;})()"
        ) == "true"
        if (!termsAccepted) Thread.sleep(120)
      }
      assertTrue("A real tap on the legal checkbox must check the HTML input and enable Create my Server ID",
        termsAccepted)

      val createButtonVisible = evaluateSetupWebView(
        scenario,
        "(function(){var b=document.querySelector('#grant-call-permissions');if(!b)return false;b.scrollIntoView({block:'center'});var r=b.getBoundingClientRect();return !b.disabled && getComputedStyle(b).display!=='none' && r.width>0 && r.height>0 && r.bottom>0 && r.top<window.innerHeight;})()"
      )
      assertEquals("Accepting legal terms must reveal an enabled Create my Server ID button in the viewport",
        "true", createButtonVisible)
      assertTrue("Onboarding unexpectedly opened a custom number-entry dialer",
        !device.hasObject(By.textContains("Call a number")))
    }
  }

  @Test fun enabledServerAccountRingsThroughAndroidTelecomForIncomingCalls() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    grantTelecomPermissions(context)
    val prefs = context.getSharedPreferences("server-session", Context.MODE_PRIVATE)
    val device = UiDevice.getInstance(instrumentation)
    val handle = ServerTelecomRegistry.handle(context)
    val callId = "incoming-" + UUID.randomUUID().toString()
    val callerIdentity = "SVR-ABCDEF1234"

    ServerTelecomRegistry.register(context)
    enablePhoneAccountWithTestShell(context, handle)
    try {
      // Exercise Android Telecom's actual incoming-call callback. This is not a
      // direct unit construction of ServerTelecomConnection: Telecom must invoke
      // ServerConnectionService.onCreateIncomingConnection for the assertion.
      ServerTelecomRegistry.reportIncoming(context, callId, callerIdentity)
      val deadline = System.currentTimeMillis() + 12_000
      var state: Int? = null
      while (System.currentTimeMillis() < deadline && state == null) {
        state = ServerTelecomRegistry.incomingConnectionState(callId)
        Thread.sleep(100)
      }
      assertEquals("Android Telecom did not call ServerConnectionService and start a ringing incoming connection",
        Connection.STATE_RINGING, state)

      // Verify the caller label was handed to Telecom's Connection object. Some
      // OEM/system call surfaces display "Unknown" for an internet call without a
      // shared telephone number, while still showing the Server call provider UI.
      assertEquals("Telecom did not receive the caller's Server identity as the display name",
        callerIdentity, ServerTelecomRegistry.incomingCallerDisplayName(callId))
      // The default dialer may render a Telecom call as full-screen, heads-up
      // or notification UI depending on Android/OEM. Do not require one exact
      // English string in one surface. The real system Telecom RINGING state and
      // caller identity above are the stable incoming-call acceptance contract;
      // Server's separate native CallStyle alert is verified by its own test.
    } finally {
      ServerTelecomRegistry.markEnded(callId)
      device.pressHome()
    }
  }

  @Test fun phoneAccountCanReceiveIncomingCallThroughTelecom() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    grantTelecomPermissions(context)
    val handle = ServerTelecomRegistry.handle(context)
    val callId = "telecom-incoming-" + UUID.randomUUID().toString()
    val callerIdentity = "SVR-ANDROID-COMPAT"
    ServerTelecomRegistry.register(context)
    enablePhoneAccountWithTestShell(context, handle)
    try {
      assertTrue("Android must expose the enabled Server PhoneAccount to Telecom", accountEnabled(context, handle))
      ServerTelecomRegistry.reportIncoming(context, callId, callerIdentity)
      val deadline = System.currentTimeMillis() + 12_000
      var state: Int? = null
      while (System.currentTimeMillis() < deadline && state == null) {
        state = ServerTelecomRegistry.incomingConnectionState(callId)
        Thread.sleep(100)
      }
      assertEquals("Android Telecom did not create a ringing Server incoming Connection",
        Connection.STATE_RINGING, state)
      assertEquals("Android Telecom did not retain the Server caller identity",
        callerIdentity, ServerTelecomRegistry.incomingCallerDisplayName(callId))
    } finally {
      ServerTelecomRegistry.markEnded(callId)
      UiDevice.getInstance(instrumentation).pressHome()
    }
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

  private fun insertDemoContact(context: Context, displayName: String, phone: String) {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    instrumentation.uiAutomation.adoptShellPermissionIdentity(Manifest.permission.WRITE_CONTACTS)
    try {
      val operations = arrayListOf<android.content.ContentProviderOperation>()
      val rawContact = operations.size
      operations.add(android.content.ContentProviderOperation.newInsert(ContactsContract.RawContacts.CONTENT_URI)
        .withValue(ContactsContract.RawContacts.ACCOUNT_TYPE, null)
        .withValue(ContactsContract.RawContacts.ACCOUNT_NAME, null)
        .build())
      operations.add(android.content.ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
        .withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, rawContact)
        .withValue(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE)
        .withValue(ContactsContract.CommonDataKinds.StructuredName.DISPLAY_NAME, displayName)
        .build())
      operations.add(android.content.ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
        .withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, rawContact)
        .withValue(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE)
        .withValue(ContactsContract.CommonDataKinds.Phone.NUMBER, phone)
        .withValue(ContactsContract.CommonDataKinds.Phone.TYPE, ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE)
        .build())
      context.contentResolver.applyBatch(ContactsContract.AUTHORITY, operations)
    } finally {
      instrumentation.uiAutomation.dropShellPermissionIdentity()
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

  /**
   * CTS/AOSP exposes this shell command only to the test harness. Using it here
   * isolates Telecom call delivery from the separate human Settings navigation
   * test, whose layout differs across Android releases and OEM dialers.
   */
  private fun enablePhoneAccountWithTestShell(context: Context, handle: android.telecom.PhoneAccountHandle) {
    grantTelecomPermissions(context)
    val userManager = context.getSystemService(android.os.UserManager::class.java)
    val serial = userManager.getSerialNumberForUser(android.os.Process.myUserHandle())
    val component = handle.componentName.flattenToString()
    val output = runShellCommand("telecom set-phone-account-enabled " + component + " " + handle.id + " " + serial)
    // Telecom confirms the account was enabled. On API 31 the public
    // getCallCapablePhoneAccounts() list can lag the shell state change even
    // after the shell reports success. The real incoming-call callback below
    // is the acceptance test; do not fail prematurely on that cache.
    assertTrue("Telecom did not confirm Server PhoneAccount enablement. " + output,
      output.contains(" enabled."))
  }

  private fun grantTelecomPermissions(context: Context) {
    // UiAutomation.grantRuntimePermission is not present on API 26 (Android 8).
    // The instrumentation shell permission grant works on every supported test
    // image and keeps these test-only grants out of the app's runtime flow.
    for (permission in listOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.RECORD_AUDIO, Manifest.permission.READ_CONTACTS)) {
      runShellCommand("pm grant ${context.packageName} $permission")
    }
    if (android.os.Build.VERSION.SDK_INT >= 33) {
      runShellCommand("pm grant ${context.packageName} ${Manifest.permission.POST_NOTIFICATIONS}")
    }
  }
  private fun accountEnabled(context: Context, handle: android.telecom.PhoneAccountHandle): Boolean {
    val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
    return telecom.callCapablePhoneAccounts.contains(handle)
  }

  private fun ensureAccountEnabled(
    context: Context,
    device: UiDevice,
    handle: android.telecom.PhoneAccountHandle,
    label: String
  ) {
    grantTelecomPermissions(context)
    if (accountEnabled(context, handle)) return
    context.startActivity(Intent("android.telecom.action.CHANGE_PHONE_ACCOUNTS")
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))

    // On AOSP Android 14, CHANGE_PHONE_ACCOUNTS first opens a settings landing
    // page with an "All calling accounts" row. The registered providers are one
    // level deeper; searching for Server on the landing page can never succeed.
    var accountRowVisible = device.wait(Until.hasObject(By.text(label)), 1_000)
    if (!accountRowVisible) {
      val openedAllAccounts = clickTextWithRetry(device, "All calling accounts", timeoutMs = 8_000)
      if (openedAllAccounts) {
        device.wait(Until.hasObject(By.textContains("All calling accounts")), 2_000)
        Thread.sleep(300)
      }
      accountRowVisible = device.wait(Until.hasObject(By.text(label)), 8_000)
    }
    assertTrue("Android calling-account list did not show $label. See ServerUITest hierarchy in logcat.", accountRowVisible)
    assertTrue("Could not reliably open the $label calling-account settings",
      clickTextWithRetry(device, label, exact = true, timeoutMs = 8_000))
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
    val e2eArguments = InstrumentationRegistry.getArguments()
    val e2eToken = e2eArguments.getString("server_test_token")?.takeIf { it.matches(Regex("^[0-9a-f]{64}$")) }
    val guestE2e = e2eToken != null
    val dialledNumber = if (guestE2e) "+12025550147" else "+2348012345678"
    val expectedDialledDigits = dialledNumber.filter { it.isDigit() }
    val e2eExpiry = e2eArguments.getString("server_test_expiry")?.toLongOrNull()
      ?: System.currentTimeMillis() / 1000 + 3600
    val e2eServerId = e2eArguments.getString("server_test_server_id").orEmpty()
    grantTelecomPermissions(context)
    val prefs = context.getSharedPreferences("server-session", Context.MODE_PRIVATE)
    val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
    val serverHandle = ServerTelecomRegistry.handle(context)
    val testHandle = android.telecom.PhoneAccountHandle(
      android.content.ComponentName(context, ServerConnectionService::class.java),
      "server-normal-dialer-test-provider"
    )
    val previousToken = prefs.getString("access_token", null)
    val previousExpiry = prefs.getLong("access_expiry", 0L)
    val previousServerId = prefs.getString("server_id", null)
    val previousPhone = prefs.getString("phone", null)
    val previousSelectedSimPhone = prefs.getString("selected_sim_phone", null)
    val previousConnectionServiceEnteredAt = prefs.getLong("debug_last_telecom_connection_service_entered_at", 0L)
    val previousRequestScheme = prefs.getString("debug_last_telecom_request_scheme", null)
    val previousRequestTargetLength = prefs.getInt("debug_last_telecom_request_target_length", -1)
    val previousEngineAt = prefs.getLong("debug_last_call_engine_entered_at", 0L)
    val previousTargetKind = prefs.getString("debug_last_call_target_kind", null)
    val previousTelecomStage = prefs.getString("debug_last_telecom_stage", null)
    val previousEngineStarted = prefs.getBoolean("debug_telecom_connection_engine_started", false)
    val previousCallFailure = prefs.getString("debug_last_call_failure", null)
    val previousDefaultOutgoing = telecom.getDefaultOutgoingPhoneAccount(PhoneAccount.SCHEME_TEL)
    val device = UiDevice.getInstance(instrumentation)
    var testAccountRegistered = false

    try {
      grantTelecomPermissions(context)
      assertTrue("The test must have microphone permission before exercising a background Telecom call",
        context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED)
      prefs.edit()
        .putString("access_token", e2eToken ?: "0".repeat(64))
        .putLong("access_expiry", e2eExpiry)
        .putString("server_id", e2eServerId)
        .putString("phone", dialledNumber)
        .putString("selected_sim_phone", dialledNumber)
        .remove("debug_last_call_engine_entered_at")
        .remove("debug_last_telecom_connection_service_entered_at")
        .remove("debug_last_telecom_request_scheme")
        .remove("debug_last_telecom_request_target_length")
        .remove("debug_last_call_target_kind")
        .remove("debug_last_telecom_stage")
        .remove("debug_telecom_connection_engine_started")
        .remove("debug_last_call_failure")
        .commit()

      ServerTelecomRegistry.register(context)
      enablePhoneAccountWithTestShell(context, serverHandle)
      val serverAccountDeadline = System.currentTimeMillis() + 5_000
      while (!accountEnabled(context, serverHandle) && System.currentTimeMillis() < serverAccountDeadline) {
        Thread.sleep(100)
      }
      assertTrue("Telecom did not expose the test-enabled Server PhoneAccount", accountEnabled(context, serverHandle))

      // The emulator has no physical carrier SIM. Keep this second account clearly
      // labelled as a mock while exercising the preinstalled Phone app UI.
      val testAccount = PhoneAccount.builder(testHandle, "Test call provider (mock)")
        .setCapabilities(PhoneAccount.CAPABILITY_CALL_PROVIDER)
        .setSupportedUriSchemes(listOf(PhoneAccount.SCHEME_TEL))
        .setShortDescription("Test-only calling provider; not a carrier SIM")
        .setAddress(Uri.parse("tel:+2348012345678"))
        .build()
      telecom.registerPhoneAccount(testAccount)
      testAccountRegistered = true
      enablePhoneAccountWithTestShell(context, testHandle)
      val mockAccountDeadline = System.currentTimeMillis() + 5_000
      while (!accountEnabled(context, testHandle) && System.currentTimeMillis() < mockAccountDeadline) {
        Thread.sleep(100)
      }
      assertTrue("Telecom did not expose the test-enabled mock PhoneAccount", accountEnabled(context, testHandle))

      // A preconfigured default SIM makes Google Phone place calls immediately and
      // bypass its outgoing-account picker. Android CTS uses the Telecom shell command
      // to select the system-supported "Ask every time" state.
      runShellCommand("telecom set-user-selected-outgoing-phone-account")
      assertEquals("Multiple enabled tel providers with Ask every time should have no default outgoing account",
        null, telecom.getDefaultOutgoingPhoneAccount(PhoneAccount.SCHEME_TEL))
      val callCapableAccounts = telecom.callCapablePhoneAccounts
      assertTrue("Server must be an enabled call-capable account before checking Phone UI", serverHandle in callCapableAccounts)
      assertTrue("The mock provider must be enabled to prove a real multi-provider picker", testHandle in callCapableAccounts)

      // Open Android's real Phone app with its normal dialpad. The API 31
      // Google/AOSP Dialer build used by CI logs "Nothing to show" for ACTION_DIAL
      // with a tel: URI, so enter the test destination through the dialpad input
      // path exactly as a user does instead of treating the URI as prefilled text.
      device.pressHome()
      val dialerIntent = Intent(Intent.ACTION_DIAL)
      val dialerPackage = telecom.defaultDialerPackage
        ?: context.packageManager.resolveActivity(dialerIntent, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY)
          ?.activityInfo?.packageName
      assertNotNull("Android did not expose a default system Phone dialer for ACTION_DIAL", dialerPackage)
      val resolvedDialerPackage = dialerPackage!!
      assertTrue("The default Phone app must not be the Server connector itself", resolvedDialerPackage != context.packageName)
      context.startActivity(dialerIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      val dialerReady = device.wait(Until.hasObject(By.pkg(resolvedDialerPackage)), 12_000)
      assertTrue("Android's system Phone dialer did not open (resolved package: " + resolvedDialerPackage + ")", dialerReady)
      val digitsField = device.wait(
        Until.findObject(By.res(resolvedDialerPackage, "digits")), 5_000
      ) ?: device.wait(Until.findObject(By.clazz("android.widget.EditText")), 2_000)
      if (digitsField == null) {
        try {
          val hierarchy = File(context.cacheDir, "server-phone-dialer-digits-field-hierarchy.txt")
          device.dumpWindowHierarchy(hierarchy)
          Log.e("ServerUITest", "Phone dialpad number field was not exposed; hierarchy:\\n" + hierarchy.readText())
        } catch (error: Exception) {
          Log.e("ServerUITest", "Could not capture number-field hierarchy: " + error.javaClass.simpleName)
        }
      }
      assertNotNull("Android Phone did not expose an editable destination field", digitsField)
      // Set the actual dialpad EditText rather than typing into whichever
      // search field the OEM Phone app happens to display first.
      // This test verifies Telecom provider selection, not national-number
      // country inference. Use explicit E.164 so the emulator's locale/SIM does
      // not change the dialled destination.
      digitsField!!.setText(dialledNumber)
      fun displayedDestinationDigits(): String {
        val field = device.findObject(By.res(resolvedDialerPackage, "digits")) ?: digitsField
        return field.text?.toString().orEmpty().filter { it.isDigit() }
      }
      var enteredDigits = ""
      val entryDeadline = System.currentTimeMillis() + 8_000
      while (System.currentTimeMillis() < entryDeadline) {
        enteredDigits = displayedDestinationDigits()
        if (enteredDigits == expectedDialledDigits) break
        Thread.sleep(100)
      }
      if (enteredDigits != "2348012345678") {
        try {
          val hierarchy = File(context.cacheDir, "server-phone-dialer-number-hierarchy.txt")
          device.dumpWindowHierarchy(hierarchy)
          Log.e("ServerUITest", "Phone dialpad did not retain the complete E.164 digits; hierarchy:\\n" + hierarchy.readText())
        } catch (error: Exception) {
          Log.e("ServerUITest", "Could not capture Phone number hierarchy: " + error.javaClass.simpleName)
        }
      }
      assertEquals("Android Phone must retain every digit of the E.164 destination regardless of visual formatting",
        expectedDialledDigits, enteredDigits)

      // Close only Gboard's navigation-bar IME button. Android Phone's own
      // Back action hides the dialpad itself, so never fall back to pressBack().
      val hideIme = device.wait(
        Until.findObject(By.res("android", "input_method_nav_back")), 1_500
      ) ?: device.findObject(By.res("com.google.android.inputmethod.latin", "input_method_nav_back"))
        ?: device.findObject(By.desc("Hide keyboard"))
        ?: device.findObject(By.res("com.android.systemui", "ime_nav_btn"))
      val imeVisible = listOf(
        "com.google.android.inputmethod.latin",
        "com.android.inputmethod.latin"
      ).any { imePackage -> device.hasObject(By.pkg(imePackage)) }
      when {
        hideIme != null -> hideIme.click()
        imeVisible -> device.pressBack() // BACK is consumed by the visible IME first.
        else -> Log.i("ServerUITest", "No software keyboard is visible; preserving the Phone dialpad.")
      }
      Thread.sleep(350)
      // UiAutomator.setText() can populate an EditText without opening an IME.
      // Never send BACK when no keyboard is visible: that exits the dialpad.
      // The exact destination is checked again at the actual Telecom hand-off below.

      // Google Phone exposes the green dial action under this resource ID on
      // AOSP images. Do not collapse the Phone dialpad to dismiss Gboard.
      val callButton = device.wait(
        Until.findObject(By.res(resolvedDialerPackage, "dialpad_floating_action_button")), 6_000
      ) ?: device.wait(Until.findObject(By.descContains("dial")), 2_000)
        ?: device.wait(Until.findObject(By.descContains("Call")), 2_000)
        ?: device.wait(Until.findObject(By.text("Call")), 2_000)
      if (callButton == null) {
        try {
          val hierarchy = File(context.cacheDir, "server-phone-dialer-call-action-hierarchy.txt")
          device.dumpWindowHierarchy(hierarchy)
          Log.e("ServerUITest", "Phone dialer still has no visible Call action after IME dismissal; hierarchy:\\n" + hierarchy.readText())
          Log.e("ServerUITest", "Phone app package=$resolvedDialerPackage")
        } catch (error: Exception) {
          Log.e("ServerUITest", "Could not capture Phone Call action hierarchy: " + error.javaClass.simpleName)
        }
      }
      assertNotNull("Android's Phone dialer did not expose its Call action after the keyboard closed", callButton)
      callButton!!.click()

      val chooserDeadline = System.currentTimeMillis() + 15_000
      var serverChoice: androidx.test.uiautomator.UiObject2? = null
      var testChoice: androidx.test.uiautomator.UiObject2? = null
      while (System.currentTimeMillis() < chooserDeadline && (serverChoice == null || testChoice == null)) {
        val serverLabel = if (BuildConfig.DEBUG) "Server Preview" else "Server"
        serverChoice = device.findObject(By.text(serverLabel))
        testChoice = device.findObject(By.text("Test call provider (mock)"))
        Thread.sleep(200)
      }
      if (serverChoice == null || testChoice == null) {
        try {
          val hierarchy = File(context.cacheDir, "server-outgoing-account-chooser-hierarchy.txt")
          device.dumpWindowHierarchy(hierarchy)
          Log.e("ServerUITest", "The system Phone app did not expose both call-provider choices.\\n" +
            "defaultDialerPackage=" + telecom.defaultDialerPackage + "\\n" +
            "defaultOutgoing=" + telecom.getDefaultOutgoingPhoneAccount(PhoneAccount.SCHEME_TEL) + "\\n" +
            "callCapableAccounts=" + telecom.callCapablePhoneAccounts + "\\n" +
            "hierarchy:\\n" + hierarchy.readText())
          Log.e("ServerUITest", "Telecom state:\\n" + runShellCommand("dumpsys telecom").take(22000))
        } catch (error: Exception) {
          Log.e("ServerUITest", "Could not capture outgoing-account chooser diagnostics: " + error.javaClass.simpleName)
        }
      }
      assertNotNull("The preinstalled Phone app did not show Server as an outgoing-call choice", serverChoice)
      assertNotNull("The preinstalled Phone app did not show a second calling provider beside Server", testChoice)
      serverChoice!!.click()
      val justOnce = device.wait(Until.findObject(By.textContains("Just once")), 2_000)
      if (justOnce != null) justOnce.click()

      val deadline = System.currentTimeMillis() + 20_000
      while (System.currentTimeMillis() < deadline && prefs.getLong("debug_last_call_engine_entered_at", 0L) == 0L) Thread.sleep(200)
      var lastTelecomStage = prefs.getString("debug_last_telecom_stage", "not-recorded")
      val engineEnteredAt = prefs.getLong("debug_last_call_engine_entered_at", 0L)
      var failure = prefs.getString("debug_last_call_failure", null).orEmpty()
      val connectionServiceEnteredAt = prefs.getLong("debug_last_telecom_connection_service_entered_at", 0L)
      if (engineEnteredAt == 0L) {
        try {
          val hierarchy = File(context.cacheDir, "server-telecom-handoff-hierarchy.txt")
          device.dumpWindowHierarchy(hierarchy)
          Log.e("ServerUITest", "The user chose Server but Telecom did not enter ConnectionService.\\n" +
            "currentPackage=" + device.currentPackageName + "\\n" +
            "defaultOutgoing=" + telecom.getDefaultOutgoingPhoneAccount(PhoneAccount.SCHEME_TEL) + "\\n" +
            "callCapableAccounts=" + telecom.callCapablePhoneAccounts + "\\n" +
            "hierarchy:\\n" + hierarchy.readText())
          Log.e("ServerUITest", "Telecom state after selecting Server:\\n" + runShellCommand("dumpsys telecom").take(22000))
          Log.e("ServerUITest", "Activity state after selecting Server:\\n" + runShellCommand("dumpsys activity activities").take(12000))
        } catch (error: Exception) {
          Log.e("ServerUITest", "Could not capture Telecom handoff diagnostics: " + error.javaClass.simpleName)
        }
      }
      assertTrue("Choosing Server from the preinstalled Phone app did not complete phone-target validation (last stage: " + lastTelecomStage + "; failure: " + failure.ifBlank { "not recorded" } + "; ConnectionService entry: " + connectionServiceEnteredAt + ")",
        engineEnteredAt > 0L)
      assertEquals("The system dialer telephone number must enter the phone-number call path",
        "phone", prefs.getString("debug_last_call_target_kind", null))
      assertEquals("Outgoing Android Telecom request must use the telephone URI scheme",
        "tel", prefs.getString("debug_last_telecom_request_scheme", null))
      assertEquals("Android Telecom must preserve the complete E.164 destination including the + prefix",
        dialledNumber.length, prefs.getInt("debug_last_telecom_request_target_length", -1))

      if (guestE2e) {
        // This branch performs a real phone-dialler -> Server ConnectionService ->
        // Supabase guest invitation -> browser-answer -> two-way audio -> hang-up.
        // The browser script runs beside this instrumentation process on the CI host.
        val inviteDeadline = System.currentTimeMillis() + 60_000
        var invitation = prefs.getString("debug_last_guest_invitation_text", null).orEmpty()
        while (invitation.isBlank() && System.currentTimeMillis() < inviteDeadline) {
          if (prefs.getString("debug_last_telecom_stage", null) == "call_setup_failed") break
          invitation = prefs.getString("debug_last_guest_invitation_text", null).orEmpty()
          Thread.sleep(150)
        }
        val callId = prefs.getString("debug_last_guest_call_id", null).orEmpty()
        val failureReason = prefs.getString("debug_last_call_failure", null).orEmpty()
        assertTrue("The real Server backend did not return a secure guest invitation (stage=" +
          prefs.getString("debug_last_telecom_stage", "unknown") + "; failure=" + failureReason + ")",
          invitation.contains("/guest.html#token=") &&
            Regex("#token=[0-9a-f]{64}").containsMatchIn(invitation))
        assertTrue("The guest call did not produce a backend call ID", callId.isNotBlank())
        val outputDir = context.getExternalFilesDir(null) ?: context.cacheDir
        File(outputDir, "server-guest-invitation.txt").writeText(invitation)
        File(outputDir, "server-guest-call-id.txt").writeText(callId)
        Log.i("ServerGuestE2E", "SERVER_GUEST_INVITATION_READY: native Android Telecom created the guest call and secure browser invitation.")

        val mediaDeadline = System.currentTimeMillis() + 120_000
        var stage = prefs.getString("debug_last_telecom_stage", "not-recorded").orEmpty()
        while (System.currentTimeMillis() < mediaDeadline &&
          stage != "two_way_audio_media_ready" && stage != "call_setup_failed") {
          stage = prefs.getString("debug_last_telecom_stage", "not-recorded").orEmpty()
          Thread.sleep(200)
        }
        val receivedPackets = prefs.getLong("debug_last_inbound_audio_rtp_packets", 0L)
        val mediaFailure = prefs.getString("debug_last_call_failure", null).orEmpty()
        assertEquals("The Android native WebRTC engine must receive guest audio RTP and mark the call active (failure=" +
          mediaFailure + "; packets=" + receivedPackets + ")", "two_way_audio_media_ready", stage)
        assertTrue("Android did not receive guest audio RTP packets", receivedPackets > 0L)
        Log.i("ServerGuestE2E", "SERVER_GUEST_ANDROID_AUDIO_PASS: Android Telecom received inbound audio RTP packets=" + receivedPackets + ".")

        val hangupDeadline = System.currentTimeMillis() + 60_000
        while (System.currentTimeMillis() < hangupDeadline &&
          prefs.getString("debug_last_telecom_stage", null) != "remote_call_ended") {
          Thread.sleep(200)
        }
        assertEquals("Ending the guest browser call must tear down the Android Telecom call",
          "remote_call_ended", prefs.getString("debug_last_telecom_stage", null))
        Log.i("ServerGuestE2E", "SERVER_GUEST_HANGUP_PASS: remote hang-up cleared the Android Telecom connection.")
        return
      }

      // This test intentionally uses an invalid session, so a real backend rejection
      // is expected. Telecom must reach its bound WebRTC engine without opening an
      // Activity over the Phone app; the backend rejection is asserted from diagnostics.
      val backendDeadline = System.currentTimeMillis() + 15_000
      while (System.currentTimeMillis() < backendDeadline &&
        prefs.getString("debug_last_telecom_stage", null) != "call_setup_failed") Thread.sleep(150)
      lastTelecomStage = prefs.getString("debug_last_telecom_stage", "not-recorded")
      failure = prefs.getString("debug_last_call_failure", null).orEmpty()
      assertEquals("Outgoing Telecom flow must wait for the Server backend result before returning to the Phone app",
        "call_setup_failed", lastTelecomStage)
      assertTrue("The Telecom-bound ConnectionService must own the call engine",
        prefs.getBoolean("debug_telecom_connection_engine_started", false))
      assertTrue("The test must observe the expected rejected backend session (failure: " + failure.ifBlank { "not recorded" } + ")", failure.isNotBlank())
      assertFalse("Server must not replace Android Phone with its internal setup page",
        device.hasObject(By.text("Calling, made natural")))
      assertTrue("No Server Activity should be launched over Android Phone",
        context.packageName != device.currentPackageName)
    } finally {
      val edit = prefs.edit()
      if (previousToken == null) edit.remove("access_token") else edit.putString("access_token", previousToken)
      edit.putLong("access_expiry", previousExpiry)
      if (previousServerId == null) edit.remove("server_id") else edit.putString("server_id", previousServerId)
      if (previousPhone == null) edit.remove("phone") else edit.putString("phone", previousPhone)
      if (previousSelectedSimPhone == null) edit.remove("selected_sim_phone") else edit.putString("selected_sim_phone", previousSelectedSimPhone)
      if (previousConnectionServiceEnteredAt == 0L) edit.remove("debug_last_telecom_connection_service_entered_at") else edit.putLong("debug_last_telecom_connection_service_entered_at", previousConnectionServiceEnteredAt)
      if (previousRequestScheme == null) edit.remove("debug_last_telecom_request_scheme") else edit.putString("debug_last_telecom_request_scheme", previousRequestScheme)
      if (previousRequestTargetLength < 0) edit.remove("debug_last_telecom_request_target_length") else edit.putInt("debug_last_telecom_request_target_length", previousRequestTargetLength)
      if (previousEngineAt == 0L) edit.remove("debug_last_call_engine_entered_at") else edit.putLong("debug_last_call_engine_entered_at", previousEngineAt)
      if (previousTargetKind == null) edit.remove("debug_last_call_target_kind") else edit.putString("debug_last_call_target_kind", previousTargetKind)
      if (previousTelecomStage == null) edit.remove("debug_last_telecom_stage") else edit.putString("debug_last_telecom_stage", previousTelecomStage)
      edit.putBoolean("debug_telecom_connection_engine_started", previousEngineStarted)
      if (previousCallFailure == null) edit.remove("debug_last_call_failure") else edit.putString("debug_last_call_failure", previousCallFailure)
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
    }
  }

  @Test fun telecomHangupUsesCallIdFromSystemIntentWhenActivityHasNoCallState() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    val prefs = context.getSharedPreferences("server-session", Context.MODE_PRIVATE)
    val previousToken = prefs.getString("access_token", null)
    val previousExpiry = prefs.getLong("access_expiry", 0L)
    val previousMarker = prefs.getString("debug_last_telecom_hangup_call_id", null)
    val callId = "telecom-hangup-" + UUID.randomUUID().toString()

    // Simulate Android recreating MainActivity after the original in-memory call
    // state has disappeared. The Telecom Connection still supplies its call ID.
    prefs.edit().remove("access_token").putLong("access_expiry", 0L)
      .remove("debug_last_telecom_hangup_call_id").commit()
    val intent = Intent(context, MainActivity::class.java).apply {
      putExtra("server_action", "hangup")
      putExtra("server_call_id", callId)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }

    try {
      ActivityScenario.launch<MainActivity>(intent).use {
        val deadline = System.currentTimeMillis() + 5_000
        while (System.currentTimeMillis() < deadline &&
          prefs.getString("debug_last_telecom_hangup_call_id", null) != callId) {
          Thread.sleep(50)
        }
        assertEquals(
          "A recreated MainActivity must use the call ID supplied by Android Telecom, not a missing in-memory call ID",
          callId,
          prefs.getString("debug_last_telecom_hangup_call_id", null)
        )
      }
    } finally {
      val edit = prefs.edit()
      if (previousToken == null) edit.remove("access_token") else edit.putString("access_token", previousToken)
      edit.putLong("access_expiry", previousExpiry)
      if (previousMarker == null) edit.remove("debug_last_telecom_hangup_call_id")
      else edit.putString("debug_last_telecom_hangup_call_id", previousMarker)
      edit.commit()
    }
  }

  @Test fun webRtcPeersExchangeAudioTracksAndConnectOnAndroidDevice() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    val hadMicPermission = context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
      android.content.pm.PackageManager.PERMISSION_GRANTED
    if (!hadMicPermission) runShellCommand("pm grant ${context.packageName} android.permission.RECORD_AUDIO")

    val remoteAudioA = CountDownLatch(1)
    val remoteAudioB = CountDownLatch(1)
    val connectedA = CountDownLatch(1)
    val connectedB = CountDownLatch(1)
    val gatheredA = CountDownLatch(1)
    val gatheredB = CountDownLatch(1)
    val pendingForA = Collections.synchronizedList(mutableListOf<IceCandidate>())
    val pendingForB = Collections.synchronizedList(mutableListOf<IceCandidate>())
    val peerARef = AtomicReference<PeerConnection?>()
    val peerBRef = AtomicReference<PeerConnection?>()

    fun observer(
      remotePeer: AtomicReference<PeerConnection?>,
      pending: MutableList<IceCandidate>,
      remoteAudio: CountDownLatch,
      connected: CountDownLatch,
      gatheringComplete: CountDownLatch
    ) = object : PeerConnection.Observer {
      override fun onSignalingChange(state: PeerConnection.SignalingState) {}
      override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
        if (state == PeerConnection.IceConnectionState.CONNECTED ||
            state == PeerConnection.IceConnectionState.COMPLETED) connected.countDown()
      }
      override fun onIceConnectionReceivingChange(receiving: Boolean) {}
      override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {
        if (state == PeerConnection.IceGatheringState.COMPLETE) gatheringComplete.countDown()
      }
      override fun onIceCandidate(candidate: IceCandidate) {
        val target = remotePeer.get()
        if (target != null && target.remoteDescription != null) {
          target.addIceCandidate(candidate)
        } else {
          pending.add(candidate)
        }
      }
      override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
      override fun onAddStream(stream: org.webrtc.MediaStream) {
        if (stream.audioTracks.isNotEmpty()) remoteAudio.countDown()
      }
      override fun onRemoveStream(stream: org.webrtc.MediaStream) {}
      override fun onDataChannel(dataChannel: DataChannel) {}
      override fun onRenegotiationNeeded() {}
      override fun onAddTrack(receiver: RtpReceiver, mediaStreams: Array<out org.webrtc.MediaStream>) {
        (receiver.track() as? AudioTrack)?.setEnabled(true)
        if (receiver.track()?.kind() == "audio") remoteAudio.countDown()
      }
    }

    var audioModule: JavaAudioDeviceModule? = null
    var factory: PeerConnectionFactory? = null
    var sourceA: org.webrtc.AudioSource? = null
    var sourceB: org.webrtc.AudioSource? = null
    var trackA: AudioTrack? = null
    var trackB: AudioTrack? = null
    var peerA: PeerConnection? = null
    var peerB: PeerConnection? = null

    fun createDescription(peer: PeerConnection, offer: Boolean): SessionDescription {
      val latch = CountDownLatch(1)
      val value = AtomicReference<SessionDescription?>()
      val failure = AtomicReference<String?>()
      val callback = object : SdpObserver {
        override fun onCreateSuccess(description: SessionDescription) {
          value.set(description)
          latch.countDown()
        }
        override fun onSetSuccess() {}
        override fun onCreateFailure(error: String) { failure.set(error); latch.countDown() }
        override fun onSetFailure(error: String) { failure.set(error); latch.countDown() }
      }
      if (offer) peer.createOffer(callback, MediaConstraints())
      else peer.createAnswer(callback, MediaConstraints())
      assertTrue("WebRTC did not create ${if (offer) "an offer" else "an answer"}", latch.await(10, TimeUnit.SECONDS))
      assertEquals("SDP creation failed", null, failure.get())
      return value.get() ?: throw AssertionError("WebRTC returned no SDP")
    }

    fun setDescription(peer: PeerConnection, description: SessionDescription, local: Boolean) {
      val latch = CountDownLatch(1)
      val failure = AtomicReference<String?>()
      val callback = object : SdpObserver {
        override fun onCreateSuccess(p0: SessionDescription?) {}
        override fun onSetSuccess() { latch.countDown() }
        override fun onCreateFailure(error: String) { failure.set(error); latch.countDown() }
        override fun onSetFailure(error: String) { failure.set(error); latch.countDown() }
      }
      if (local) peer.setLocalDescription(callback, description)
      else peer.setRemoteDescription(callback, description)
      assertTrue("WebRTC did not set ${if (local) "local" else "remote"} SDP", latch.await(10, TimeUnit.SECONDS))
      assertEquals("SDP application failed", null, failure.get())
    }

    fun inboundAudioPackets(peer: PeerConnection): Long {
      val statsReady = CountDownLatch(1)
      val packets = AtomicReference(0L)
      peer.getStats(object : RTCStatsCollectorCallback {
        override fun onStatsDelivered(report: RTCStatsReport) {
          val received = report.getStatsMap().values
            .filter { it.type == "inbound-rtp" }
            .filter {
              (it.getMembers()["kind"] ?: it.getMembers()["mediaType"])?.toString() == "audio"
            }
            .mapNotNull { it.getMembers()["packetsReceived"]?.toString()?.toLongOrNull() }
            .sum()
          packets.set(received)
          statsReady.countDown()
        }
      })
      assertTrue("WebRTC inbound RTP statistics were not delivered", statsReady.await(8, TimeUnit.SECONDS))
      return packets.get()
    }

    try {
      PeerConnectionFactory.initialize(
        PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions()
      )
      audioModule = JavaAudioDeviceModule.builder(context).createAudioDeviceModule()
      factory = PeerConnectionFactory.builder().setAudioDeviceModule(audioModule).createPeerConnectionFactory()
      val config = PeerConnection.RTCConfiguration(emptyList()).apply {
        sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
      }
      val observerA = observer(peerBRef, pendingForB, remoteAudioA, connectedA, gatheredA)
      val observerB = observer(peerARef, pendingForA, remoteAudioB, connectedB, gatheredB)
      peerA = factory!!.createPeerConnection(config, observerA)
      peerB = factory!!.createPeerConnection(config, observerB)
      assertNotNull("First WebRTC peer was not created", peerA)
      assertNotNull("Second WebRTC peer was not created", peerB)
      peerARef.set(peerA)
      peerBRef.set(peerB)

      sourceA = factory!!.createAudioSource(MediaConstraints())
      sourceB = factory!!.createAudioSource(MediaConstraints())
      trackA = factory!!.createAudioTrack("server-audio-a", sourceA)
      trackB = factory!!.createAudioTrack("server-audio-b", sourceB)
      trackA!!.setEnabled(true)
      trackB!!.setEnabled(true)
      assertNotNull("First peer rejected its local audio track", peerA!!.addTrack(trackA, listOf("server-audio-a")))
      assertNotNull("Second peer rejected its local audio track", peerB!!.addTrack(trackB, listOf("server-audio-b")))

      val offer = createDescription(peerA!!, true)
      setDescription(peerA!!, offer, true)
      assertTrue("First peer did not complete ICE gathering", gatheredA.await(15, TimeUnit.SECONDS))
      val gatheredOffer = peerA!!.localDescription ?: offer
      setDescription(peerB!!, gatheredOffer, false)
      synchronized(pendingForB) { pendingForB.toList().forEach { peerB!!.addIceCandidate(it) }; pendingForB.clear() }

      val answer = createDescription(peerB!!, false)
      setDescription(peerB!!, answer, true)
      assertTrue("Second peer did not complete ICE gathering", gatheredB.await(15, TimeUnit.SECONDS))
      val gatheredAnswer = peerB!!.localDescription ?: answer
      setDescription(peerA!!, gatheredAnswer, false)
      synchronized(pendingForA) { pendingForA.toList().forEach { peerA!!.addIceCandidate(it) }; pendingForA.clear() }

      assertTrue("First peer never reached ICE CONNECTED/COMPLETED", connectedA.await(25, TimeUnit.SECONDS))
      assertTrue("Second peer never reached ICE CONNECTED/COMPLETED", connectedB.await(25, TimeUnit.SECONDS))
      assertTrue("First peer never received the remote audio track", remoteAudioA.await(10, TimeUnit.SECONDS))
      assertTrue("Second peer never received the remote audio track", remoteAudioB.await(10, TimeUnit.SECONDS))
      assertTrue("Both sides must have local audio tracks enabled", trackA!!.enabled() && trackB!!.enabled())
      var packetsAtA = 0L
      var packetsAtB = 0L
      val mediaDeadline = System.currentTimeMillis() + 12_000L
      while (System.currentTimeMillis() < mediaDeadline && (packetsAtA < 1L || packetsAtB < 1L)) {
        packetsAtA = inboundAudioPackets(peerA!!)
        packetsAtB = inboundAudioPackets(peerB!!)
        if (packetsAtA < 1L || packetsAtB < 1L) Thread.sleep(250)
      }
      assertTrue("Caller received no inbound audio RTP packets", packetsAtA > 0L)
      assertTrue("Recipient received no inbound audio RTP packets", packetsAtB > 0L)
    } finally {
      try { peerA?.close() } catch (_: Exception) {}
      try { peerB?.close() } catch (_: Exception) {}
      trackA?.dispose()
      trackB?.dispose()
      sourceA?.dispose()
      sourceB?.dispose()
      factory?.dispose()
      audioModule?.release()
      if (!hadMicPermission) runShellCommand("pm revoke ${context.packageName} android.permission.RECORD_AUDIO")
    }
  }

  @Test fun serverRegistersAsSystemManagedPhoneAccountAndUsesOnlyExplicitlyLinkedNumberMetadata() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    grantTelecomPermissions(context)
    val prefs = context.getSharedPreferences("server-session", Context.MODE_PRIVATE)
    val previousNumber = prefs.getString("selected_sim_phone", null)
    val previousLinked = prefs.getBoolean("server_phone_number_linked", false)
    val previousLinkedPhone = prefs.getString("server_linked_phone", null)
    val previousNumberConsent = prefs.getBoolean("allow_number_based_server_calls", false)

    try {
      // A legacy SIM-derived number must never be silently attached to Server.
      prefs.edit().putString("selected_sim_phone", "+2348012345678")
        .putBoolean("server_phone_number_linked", false).remove("server_linked_phone").commit()
      ServerTelecomRegistry.register(context)
      var account = ServerTelecomRegistry.buildPhoneAccount(context)
      assertEquals("An unverified SIM number must not become Server calling identity metadata",
        null, account.address)

      // Only an explicitly verified-and-linked number may be shown as Telecom metadata.
      prefs.edit().putBoolean("server_phone_number_linked", true)
        .putString("server_linked_phone", "+2348012345678")
        .putBoolean("allow_number_based_server_calls", false).commit()
      ServerTelecomRegistry.register(context)
      account = ServerTelecomRegistry.buildPhoneAccount(context)
      assertEquals("Verified number must remain private until the user opts into number-based calls",
        null, account.address)

      prefs.edit().putBoolean("allow_number_based_server_calls", true).commit()
      ServerTelecomRegistry.register(context)
      account = ServerTelecomRegistry.buildPhoneAccount(context)
      assertTrue("Server account is not a call-provider account",
        (account.capabilities and PhoneAccount.CAPABILITY_CALL_PROVIDER) != 0)
      assertTrue("Server must be a system-managed call provider, not self-managed",
        (account.capabilities and PhoneAccount.CAPABILITY_SELF_MANAGED) == 0)
      assertTrue("Server must explicitly advertise tel URI support so the normal dialer can route numbers to it",
        account.supportedUriSchemes.contains(PhoneAccount.SCHEME_TEL))
      assertTrue("Server must not masquerade as a cellular SIM",
        (account.capabilities and PhoneAccount.CAPABILITY_SIM_SUBSCRIPTION) == 0)
      assertEquals("Only the explicitly linked and consented number should be exposed as account metadata",
        Uri.parse("tel:+2348012345678"), account.address)

      prefs.edit().putBoolean("allow_number_based_server_calls", false).commit()
      ServerTelecomRegistry.register(context)
      account = ServerTelecomRegistry.buildPhoneAccount(context)
      assertEquals("Revoking number-call consent must remove the number from Telecom metadata",
        null, account.address)
    } finally {
      val edit = prefs.edit()
      if (previousNumber == null) edit.remove("selected_sim_phone") else edit.putString("selected_sim_phone", previousNumber)
      edit.putBoolean("server_phone_number_linked", previousLinked)
      if (previousLinkedPhone == null) edit.remove("server_linked_phone") else edit.putString("server_linked_phone", previousLinkedPhone)
      edit.putBoolean("allow_number_based_server_calls", previousNumberConsent)
      edit.commit()
      ServerTelecomRegistry.register(context)
    }
  }

}