package com.server.receiver

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal object WakeStore {
  private const val PREFS = "server_receiver_secure"
  private const val KEY_ALIAS = "server.receiver.offline-wake.aes"
  private const val CALLERS_KEY = "encrypted_callers"
  private const val DEVICE_ID_KEY = "encrypted_device_id"
  private const val DEVICE_SECRET_KEY = "encrypted_device_secret"
  private const val ENABLED_KEY = "wake_enabled"

  fun isEnabled(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(ENABLED_KEY, false)

  fun setEnabled(context: Context, enabled: Boolean) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(ENABLED_KEY, enabled).apply()
  }

  fun credentials(context: Context): Pair<String, String> {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val id = read(context, DEVICE_ID_KEY) ?: randomHex().also { write(context, DEVICE_ID_KEY, it) }
    val secret = read(context, DEVICE_SECRET_KEY) ?: randomHex().also { write(context, DEVICE_SECRET_KEY, it) }
    return id to secret
  }

  fun saveCaller(context: Context, caller: OfflineWakeCaller) {
    val current = callers(context).filterNot { WakeNumberMatcher.matches(it.phoneE164, caller.phoneE164) }
    val next = current + caller
    val array = JSONArray()
    next.forEach {
      array.put(JSONObject()
        .put("phone", it.phoneE164)
        .put("name", it.displayName)
        .put("server_id", it.serverId))
    }
    write(context, CALLERS_KEY, array.toString())
    setEnabled(context, true)
  }

  fun callers(context: Context): List<OfflineWakeCaller> {
    val raw = read(context, CALLERS_KEY) ?: return emptyList()
    return try {
      val array = JSONArray(raw)
      (0 until array.length()).mapNotNull { index ->
        val item = array.optJSONObject(index) ?: return@mapNotNull null
        val phone = item.optString("phone")
        val name = item.optString("name")
        if (WakeNumberMatcher.canonical(phone) == null || name.isBlank()) null
        else OfflineWakeCaller(phone, name, item.optString("server_id"))
      }
    } catch (_: Exception) {
      emptyList()
    }
  }

  fun findCaller(context: Context, incomingNumber: String): OfflineWakeCaller? =
    callers(context).firstOrNull { WakeNumberMatcher.matches(incomingNumber, it.phoneE164) }

  private fun read(context: Context, key: String): String? {
    val encoded = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key, null) ?: return null
    return try {
      val packed = Base64.decode(encoded, Base64.NO_WRAP)
      if (packed.size <= 12) return null
      val iv = packed.copyOfRange(0, 12)
      val ciphertext = packed.copyOfRange(12, packed.size)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
      String(cipher.doFinal(ciphertext), Charsets.UTF_8)
    } catch (_: Exception) {
      null
    }
  }

  private fun write(context: Context, key: String, value: String) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, secretKey())
    val packed = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString(key, Base64.encodeToString(packed, Base64.NO_WRAP)).apply()
  }

  private fun secretKey(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val existing = keyStore.getKey(KEY_ALIAS, null) as? SecretKey
    if (existing != null) return existing
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .build(),
    )
    return generator.generateKey()
  }

  private fun randomHex(): String = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }
    .joinToString("") { "%02x".format(it) }
}
