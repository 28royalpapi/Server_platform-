package com.server.gateway

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Encrypts the gateway bearer token with a non-exportable Android Keystore AES key. */
object SecureStore {
  private const val PREFS = "server_gateway_prefs"
  private const val KEY_ALIAS = "server_gateway_aes_key"

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

  fun putSecret(context: Context, name: String, value: String) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
    val packed = cipher.iv + encrypted
    prefs(context).edit().putString("secure:$name", Base64.encodeToString(packed, Base64.NO_WRAP)).apply()
  }

  fun getSecret(context: Context, name: String): String? {
    val packed = prefs(context).getString("secure:$name", null) ?: return null
    return try {
      val bytes = Base64.decode(packed, Base64.NO_WRAP)
      if (bytes.size <= 12) return null
      val iv = bytes.copyOfRange(0, 12)
      val encrypted = bytes.copyOfRange(12, bytes.size)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
      String(cipher.doFinal(encrypted), Charsets.UTF_8)
    } catch (_: Exception) { null }
  }

  fun putText(context: Context, name: String, value: String) = prefs(context).edit().putString(name, value).apply()
  fun getText(context: Context, name: String, fallback: String = "") = prefs(context).getString(name, fallback) ?: fallback
  fun clear(context: Context) { prefs(context).edit().clear().apply() }
}
