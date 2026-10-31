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
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.StaleObjectException
import androidx.test.uiautomator.Until
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class CallerSmokeTest {
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

    ActivityScenario.launch<ServerSetupWebActivity>(launchIntent).use {
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
      val terms = device.wait(Until.findObject(By.textContains("I accept the Terms of Service")), 10_000)
      assertNotNull("Legal acceptance must remain part of account creation", terms)
      val createButton = device.wait(Until.findObject(By.textContains("Create my Server ID")), 10_000)
      assertNotNull("Server identity creation action is not visible", createButton)
      assertTrue("Server identity creation must require legal acceptance",
        createButton!!.isEnabled.not())
      terms!!.click()
      assertTrue("Accepting the terms should enable Server ID creation", createButton.isEnabled)
      assertTrue("Onboarding unexpectedly opened a custom number-entry dialer",
        !device.hasObject(By.textContains("Call a number")))
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

  private fun grantPhoneMetadataPermissions(context: Context) {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    for (permission in listOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.RECORD_AUDIO)) {
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

    // On AOSP Android 14, CHANGE_PHONE_ACCOUNTS first opens a settings landing
    // page with an "All calling accounts" row. The registered providers are one
    // level deeper; searching for Server on the landing page can never succeed.
    var accountRow = device.findObject(By.text(label))
    if (accountRow == null) {
      val allAccounts = findTextOnScrollableScreen(context, device, "All calling accounts")
      if (allAccounts != null) {
        allAccounts.click()
        device.wait(Until.hasObject(By.textContains("All calling accounts")), 2_000)
        Thread.sleep(300)
      }
      accountRow = findTextOnScrollableScreen(context, device, label)
    }
    assertNotNull("Android calling-account list did not show $label. See ServerUITest hierarchy in logcat.", accountRow)
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
    grantPhoneMetadataPermissions(context)
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
    val previousDefaultOutgoing = telecom.getDefaultOutgoingPhoneAccount(PhoneAccount.SCHEME_TEL)
    val device = UiDevice.getInstance(instrumentation)
    var testAccountRegistered = false

    try {
      try { instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.RECORD_AUDIO) } catch (_: Exception) {}
      assertTrue("The test must have microphone permission before exercising a background Telecom call",
        context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED)
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

      // A preconfigured default SIM makes Google Phone place calls immediately and
      // bypass its outgoing-account picker. Android CTS uses the Telecom shell command
      // to select the system-supported "Ask every time" state.
      runShellCommand("telecom set-user-selected-outgoing-phone-account")
      assertEquals("Multiple enabled tel providers with Ask every time should have no default outgoing account",
        null, telecom.getDefaultOutgoingPhoneAccount(PhoneAccount.SCHEME_TEL))
      val callCapableAccounts = telecom.callCapablePhoneAccounts
      assertTrue("Server must be an enabled call-capable account before checking Phone UI", serverHandle in callCapableAccounts)
      assertTrue("The mock provider must be enabled to prove a real multi-provider picker", testHandle in callCapableAccounts)

      // Create a clearly fake emulator contact and select it through the system
      // Contacts UI, matching the user's real dialer -> contact -> Server flow.
      insertDemoContact(context, "Server Demo Contact", "+15550001001")
      device.pressHome()
      context.startActivity(Intent(Intent.ACTION_VIEW, ContactsContract.Contacts.CONTENT_URI)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      val demoContact = device.wait(Until.findObject(By.text("Server Demo Contact")), 15_000)
      assertNotNull("The Android Contacts app did not show the emulator's Server Demo Contact", demoContact)
      demoContact!!.click()

      val numberRow = device.wait(Until.findObject(By.textContains("555")), 10_000)
      assertNotNull("The selected contact's phone number was not visible in Contacts", numberRow)
      numberRow!!.click()

      // Some Contacts versions open the dialer with the number populated; in
      // others the number row proceeds directly to the system outgoing-call flow.
      val callButton = device.wait(Until.findObject(By.descContains("Call")), 6_000)
        ?: device.wait(Until.findObject(By.text("Call")), 1_500)
      if (callButton != null) callButton.click()

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
      val lastTelecomStage = prefs.getString("debug_last_telecom_stage", "not-recorded")
      assertTrue("Choosing Server from the preinstalled Phone app did not reach Server’s call engine (last stage: " + lastTelecomStage + ")",
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

  @Test fun serverRegistersAsSystemManagedPhoneAccountAndUsesOnlyExplicitlyLinkedNumberMetadata() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    grantPhoneMetadataPermissions(context)
    val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
    val handle = ServerTelecomRegistry.handle(context)
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
      var account = telecom.getPhoneAccount(handle)
      assertNotNull("Android Telecom did not register the Server calling account", account)
      assertEquals("An unverified SIM number must not become Server calling identity metadata",
        null, account!!.address)

      // Only an explicitly verified-and-linked number may be shown as Telecom metadata.
      prefs.edit().putBoolean("server_phone_number_linked", true)
        .putString("server_linked_phone", "+2348012345678")
        .putBoolean("allow_number_based_server_calls", false).commit()
      ServerTelecomRegistry.register(context)
      account = telecom.getPhoneAccount(handle)
      assertNotNull("Android Telecom did not retain the Server calling account", account)
      assertEquals("Verified number must remain private until the user opts into number-based calls",
        null, account!!.address)

      prefs.edit().putBoolean("allow_number_based_server_calls", true).commit()
      ServerTelecomRegistry.register(context)
      account = telecom.getPhoneAccount(handle)
      assertNotNull("Android Telecom did not retain the Server calling account", account)
      assertTrue("Server account is not a call-provider account",
        (account!!.capabilities and PhoneAccount.CAPABILITY_CALL_PROVIDER) != 0)
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
      account = telecom.getPhoneAccount(handle)
      assertEquals("Revoking number-call consent must remove the number from Telecom metadata",
        null, account?.address)
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