package com.server.receiver

import android.content.Context
import android.app.NotificationManager
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

@RunWith(AndroidJUnit4::class)
class OfflineWakeReceiverSmokeTest {
  private val phone = "+2348012345678"
  private val serverId = "SVR-EMULATOR-A1"
  private val displayName = "Server Caller A"
  private val secret = "a".repeat(64)

  @Test
  fun seedKnownServerCallerAndVerifyLocalMatch() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    assertTrue("Android Call Screening role and notification/Contacts permissions must be enabled",
      ServerReceiverRoster.isReady(context))

    ServerReceiverRoster.saveSecret(context, secret)
    val row = JSONObject()
      .put("caller_hash", hmac(secret, phone))
      .put("server_id", serverId)
      .put("display_name", displayName)
    context.getSharedPreferences("server_receiver_companion", Context.MODE_PRIVATE)
      .edit()
      .putString("caller_roster_json", JSONArray().put(row).toString())
      .commit()

    val matched = ServerReceiverRoster.match(context, phone)
    assertNotNull("Known verified Server caller must match the local roster", matched)
    assertEquals(serverId, matched?.serverId)
    assertEquals(displayName, matched?.displayName)
  }

  @Test
  fun gsmWakeCallProducesServerNotification() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    assertTrue("Test requires a phone with cellular voice but no validated internet",
      !ServerReceiverRoster.hasInternet(context))

    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(12)
    var found: android.service.notification.StatusBarNotification? = null
    while (System.nanoTime() < deadline && found == null) {
      found = manager.activeNotifications.firstOrNull {
        it.notification.channelId == "server-offline-wakeup-v1"
      }
      if (found == null) Thread.sleep(250)
    }
    assertNotNull("Recognised incoming GSM wake call must create a Server wake notification", found)
    val title = found?.notification?.extras?.getCharSequence("android.title")?.toString().orEmpty()
    assertEquals("$displayName is trying to reach you", title)
  }

  private fun hmac(key: String, value: String): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key.toByteArray(Charsets.UTF_8), "HmacSHA256"))
    return mac.doFinal(value.toByteArray(Charsets.UTF_8))
      .joinToString("") { "%02x".format(it) }
  }
}
