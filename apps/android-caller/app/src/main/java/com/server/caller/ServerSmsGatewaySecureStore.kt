package com.server.caller

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Stores the gateway bearer token encrypted with a non-exportable Android Keystore key. */
internal object ServerSmsGatewaySecureStore {
  private const val PREFS = "server-session"
  private const val KEY_ALIAS = "server_sms_gateway_aes_key"
  private const val TOKEN_KEY = "sms_gateway_secure_token"
  private const val DEVICE_ID_KEY = "sms_gateway_device_id"
  private const val SUBSCRIPTION_ID_KEY = "sms_gateway_subscription_id"
  private const val LABEL_KEY = "sms_gateway_label"

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .build()
    )
    return generator.generateKey()
  }

  fun save(context: Context, token: String, deviceId: String, subscriptionId: Int, label: String) {
    require(token.matches(Regex("^[0-9a-f]{64}$")))
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val encrypted = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
    val packed = cipher.iv + encrypted
    prefs(context).edit()
      .putString(TOKEN_KEY, Base64.encodeToString(packed, Base64.NO_WRAP))
      .putString(DEVICE_ID_KEY, deviceId)
      .putInt(SUBSCRIPTION_ID_KEY, subscriptionId)
      .putString(LABEL_KEY, label)
      .putBoolean("sms_gateway_requested", true)
      .commit()
  }

  fun token(context: Context): String? {
    val packed = prefs(context).getString(TOKEN_KEY, null) ?: return null
    return try {
      val bytes = Base64.decode(packed, Base64.NO_WRAP)
      if (bytes.size <= 12) return null
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
      String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
        .takeIf { it.matches(Regex("^[0-9a-f]{64}$")) }
    } catch (_: Exception) { null }
  }

  fun deviceId(context: Context): String = prefs(context).getString(DEVICE_ID_KEY, "").orEmpty()
  fun subscriptionId(context: Context): Int = prefs(context).getInt(SUBSCRIPTION_ID_KEY, -1)
  fun label(context: Context): String = prefs(context).getString(LABEL_KEY, "").orEmpty()
  fun isRequested(context: Context): Boolean = prefs(context).getBoolean("sms_gateway_requested", false)

  fun clear(context: Context) {
    prefs(context).edit()
      .remove(TOKEN_KEY)
      .remove(DEVICE_ID_KEY)
      .remove(SUBSCRIPTION_ID_KEY)
      .remove(LABEL_KEY)
      .remove("sms_gateway_requested")
      .commit()
    try {
      KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(KEY_ALIAS) }
    } catch (_: Exception) {}
  }
}
