package com.server.caller

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import android.provider.ContactsContract
import android.telecom.PhoneAccount
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts

/**
 * Sava Call's own dialer surface.
 * Contacts are queried locally and never sent to the Server backend.
 * Sava Call launches the existing Server/WebRTC engine for internet calls.
 * Carrier calls are handed to Android Telecom with the account selected by the user.
 */
class DialerActivity : ComponentActivity() {
  private data class ContactRow(val name: String, val number: String)
  private data class CarrierChoice(val label: String, val handle: PhoneAccountHandle)

  private lateinit var root: LinearLayout
  private lateinit var numberInput: EditText
  private lateinit var searchInput: EditText
  private lateinit var contactPanel: LinearLayout
  private lateinit var keypadPanel: LinearLayout
  private lateinit var contactRows: LinearLayout
  private lateinit var statusText: TextView

  private var contacts: List<ContactRow> = emptyList()
  private var carrierChoices: List<CarrierChoice> = emptyList()
  private var showRouteAfterPermission = false
  private var pendingContactCall = false
  private var pendingCarrierCall: Pair<String, PhoneAccountHandle>? = null

  private val permissionRequest = registerForActivityResult(
    ActivityResultContracts.RequestMultiplePermissions()
  ) { result ->
    if (result[Manifest.permission.READ_CONTACTS] == true) {
      pendingContactCall = false
      loadContacts()
    }
    else if (pendingContactCall) {
      pendingContactCall = false
      setStatus("Contacts permission was not granted. You can still enter a number on the keypad.")
    }
    if (result[Manifest.permission.READ_PHONE_STATE] == true && showRouteAfterPermission) {
      showRouteAfterPermission = false
      showCallChoices()
    }
    val pending = pendingCarrierCall
    if (result[Manifest.permission.CALL_PHONE] == true && pending != null) {
      pendingCarrierCall = null
      placeCarrierCall(pending.first, pending.second)
    } else if (result.containsKey(Manifest.permission.CALL_PHONE) && result[Manifest.permission.CALL_PHONE] == false) {
      pendingCarrierCall = null
      setStatus("Phone-call permission was not granted. No carrier call was placed.")
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    title = "Sava Call"
    window.statusBarColor = 0xFF08111D.toInt()
    window.navigationBarColor = 0xFF08111D.toInt()
    buildUi()
  }

  private fun buildUi() {
    val scroll = ScrollView(this)
    root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(20), dp(20), dp(20), dp(24))
      setBackgroundColor(0xFF08111D.toInt())
    }
    scroll.addView(root)
    setContentView(scroll)

    root.addView(TextView(this).apply {
      text = "SAVA CALL"
      textSize = 13f
      letterSpacing = .22f
      setTextColor(0xFF32D583.toInt())
    }, matchWrap())
    root.addView(TextView(this).apply {
      text = "Your calls. Your choice."
      textSize = 28f
      setTextColor(0xFFF3F7FB.toInt())
      setPadding(0, dp(5), 0, dp(3))
    }, matchWrap())
    root.addView(TextView(this).apply {
      text = "Choose a carrier SIM for a normal mobile call, or Sava Call for an internet call."
      textSize = 14f
      setTextColor(0xFF9AABBC.toInt())
      setPadding(0, 0, 0, dp(16))
    }, matchWrap())

    statusText = TextView(this).apply {
      textSize = 13f
      setTextColor(0xFFFFDFA3.toInt())
      setPadding(dp(12), dp(10), dp(12), dp(10))
      visibility = View.GONE
    }
    root.addView(statusText, matchWrap())

    numberInput = EditText(this).apply {
      hint = "Enter a number or SVR-… ID"
      textSize = 20f
      setSingleLine(true)
      setTextColor(0xFFF3F7FB.toInt())
      setHintTextColor(0xFF718397.toInt())
      setPadding(dp(14), dp(12), dp(14), dp(12))
      setBackgroundColor(0xFF142235.toInt())
    }
    root.addView(numberInput, matchWrap())

    val tabRow = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      setPadding(0, dp(12), 0, dp(8))
    }
    tabRow.addView(button("Keypad") { showKeypad() }, weighted())
    tabRow.addView(button("Contacts") { showContacts() }, weighted())
    root.addView(tabRow, matchWrap())

    keypadPanel = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(0, dp(4), 0, dp(8))
    }
    val keys = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "⌫")
    for (rowStart in keys.indices step 3) {
      val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
      for (key in keys.subList(rowStart, rowStart + 3)) {
        row.addView(button(key) {
          if (key == "⌫") {
            val current = numberInput.text.toString()
            if (current.isNotEmpty()) numberInput.setText(current.dropLast(1))
            numberInput.setSelection(numberInput.text.length)
          } else {
            numberInput.append(key)
          }
        }.apply { textSize = 22f }, weighted().apply { height = dp(58) })
      }
      keypadPanel.addView(row, matchWrap())
    }
    root.addView(keypadPanel, matchWrap())

    contactPanel = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      visibility = View.GONE
      setPadding(0, dp(4), 0, dp(8))
    }
    searchInput = EditText(this).apply {
      hint = "Search contacts"
      textSize = 15f
      setSingleLine(true)
      setTextColor(0xFFF3F7FB.toInt())
      setHintTextColor(0xFF718397.toInt())
      setPadding(dp(12), dp(10), dp(12), dp(10))
      setBackgroundColor(0xFF142235.toInt())
      addTextChangedListener(object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { renderContacts() }
        override fun afterTextChanged(s: Editable?) {}
      })
    }
    contactPanel.addView(searchInput, matchWrap())
    contactPanel.addView(TextView(this).apply {
      text = "Your contacts are read on this phone only; Sava Call does not upload your address book."
      textSize = 12f
      setTextColor(0xFF9AABBC.toInt())
      setPadding(0, dp(8), 0, dp(8))
    }, matchWrap())
    contactRows = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    contactPanel.addView(contactRows, matchWrap())
    contactPanel.addView(button("Allow access to contacts") { requestContacts() }, matchWrap())
    root.addView(contactPanel, matchWrap())

    root.addView(button("Choose how to call") {
      val target = numberInput.text.toString().trim()
      if (target.isBlank()) setStatus("Choose a contact or enter a number first.")
      else ensureRoutingPermission()
    }.apply {
      textSize = 17f
      setPadding(dp(14), dp(14), dp(14), dp(14))
      setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xFF17B76A.toInt()))
      setTextColor(0xFF04140C.toInt())
    }, matchWrap())

    root.addView(button("Set up Sava Call") {
      startActivity(Intent(this, ServerSetupWebActivity::class.java).apply {
        data = Uri.parse("server://sim-setup")
      })
    }, matchWrap())

    root.addView(TextView(this).apply {
      text = "Sava Call is an internet-calling service, not a copied SIM. Carrier calls use the selected mobile subscription. Internet calls require an active Sava Call identity and internet access."
      textSize = 12f
      setTextColor(0xFF718397.toInt())
      setPadding(0, dp(14), 0, 0)
    }, matchWrap())
  }

  private fun showKeypad() {
    keypadPanel.visibility = View.VISIBLE
    contactPanel.visibility = View.GONE
  }

  private fun showContacts() {
    keypadPanel.visibility = View.GONE
    contactPanel.visibility = View.VISIBLE
    if (checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) {
      if (contacts.isEmpty()) loadContacts() else renderContacts()
    } else requestContacts()
  }

  private fun requestContacts() {
    if (checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) {
      loadContacts()
      return
    }
    pendingContactCall = true
    permissionRequest.launch(arrayOf(Manifest.permission.READ_CONTACTS))
  }

  private fun loadContacts() {
    if (checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return
    val rows = mutableListOf<ContactRow>()
    val seen = mutableSetOf<String>()
    val projection = arrayOf(
      ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
      ContactsContract.CommonDataKinds.Phone.NUMBER
    )
    try {
      contentResolver.query(
        ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
        projection, null, null,
        ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " COLLATE LOCALIZED ASC"
      )?.use { c ->
        val nameIndex = c.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
        val numberIndex = c.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.NUMBER)
        while (c.moveToNext()) {
          val name = c.getString(nameIndex)?.trim().orEmpty().ifBlank { "Unknown contact" }
          val number = c.getString(numberIndex)?.trim().orEmpty()
          val key = name + "|" + number.filter { it.isDigit() }
          if (number.isNotBlank() && seen.add(key)) rows.add(ContactRow(name, number))
        }
      }
    } catch (e: SecurityException) {
      setStatus("Android denied contacts access. Grant Contacts permission and try again.")
    } catch (e: Exception) {
      setStatus("Could not read contacts: " + (e.message ?: "unknown error"))
    }
    contacts = rows
    renderContacts()
    if (rows.isEmpty()) setStatus("No phone-number contacts were found. You can still enter a number on the keypad.")
    else setStatus("Loaded " + rows.size + " phone-number entries from this device. They remain on this device.")
  }

  private fun renderContacts() {
    if (!::contactRows.isInitialized) return
    contactRows.removeAllViews()
    val query = if (::searchInput.isInitialized) searchInput.text.toString().trim() else ""
    val filtered = contacts.filter {
      query.isBlank() || it.name.contains(query, ignoreCase = true) || it.number.contains(query, ignoreCase = true)
    }.take(300)
    for (contact in filtered) {
      contactRows.addView(button(contact.name + "\n" + contact.number) {
        numberInput.setText(contact.number)
        numberInput.setSelection(numberInput.text.length)
        ensureRoutingPermission()
      }.apply {
        gravity = Gravity.START or Gravity.CENTER_VERTICAL
        textSize = 15f
        setPadding(dp(12), dp(10), dp(12), dp(10))
      }, matchWrap())
    }
    if (filtered.isEmpty()) {
      contactRows.addView(TextView(this).apply {
        text = if (contacts.isEmpty()) "Tap Allow access to contacts to load your address book." else "No matching contacts."
        setTextColor(0xFF9AABBC.toInt())
        setPadding(dp(4), dp(12), dp(4), dp(12))
      }, matchWrap())
    }
  }

  private fun ensureRoutingPermission() {
    if (checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
      showRouteAfterPermission = true
      permissionRequest.launch(arrayOf(Manifest.permission.READ_PHONE_STATE))
    } else showCallChoices()
  }

  @Suppress("DEPRECATION", "MissingPermission")
  private fun carrierAccounts(): List<CarrierChoice> {
    val telecom = getSystemService(TELECOM_SERVICE) as TelecomManager
    return try {
      telecom.callCapablePhoneAccounts.mapNotNull { handle ->
        val account = telecom.getPhoneAccount(handle) ?: return@mapNotNull null
        if ((account.capabilities and PhoneAccount.CAPABILITY_SIM_SUBSCRIPTION) == 0) return@mapNotNull null
        CarrierChoice(account.label?.toString()?.trim().takeUnless { it.isNullOrBlank() } ?: "Mobile carrier", handle)
      }.distinctBy { it.handle }
    } catch (_: SecurityException) {
      emptyList()
    } catch (_: Exception) {
      emptyList()
    }
  }

  private fun showCallChoices() {
    val target = numberInput.text.toString().trim()
    if (target.isBlank()) return
    carrierChoices = carrierAccounts()
    val labels = mutableListOf("Sava Call · Internet calling")
    labels.addAll(carrierChoices.mapIndexed { index, choice -> "SIM " + (index + 1) + " · " + choice.label })
    if (carrierChoices.isEmpty()) {
      setStatus("No carrier SIM calling accounts are currently exposed by Android. Sava Call remains available; check that a SIM is active for carrier calls.")
    }
    android.app.AlertDialog.Builder(this)
      .setTitle("Call " + target + " using…")
      .setItems(labels.toTypedArray()) { _, which ->
        if (which == 0) placeSavaCall(target)
        else carrierChoices.getOrNull(which - 1)?.let { placeCarrierCall(target, it.handle) }
      }
      .setNegativeButton("Cancel", null)
      .show()
  }

  private fun placeSavaCall(target: String) {
    startActivity(Intent(this, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      putExtra("server_action", "dial")
      putExtra("server_dialed_number", target)
      putExtra("sava_dialer_launch", true)
    })
  }

  private fun placeCarrierCall(target: String, handle: PhoneAccountHandle) {
    val number = target.filter { it.isDigit() || it == '+' || it == '*' || it == '#' }
    if (number.isBlank() || target.startsWith("SVR-", ignoreCase = true)) {
      setStatus("Carrier calls require a telephone number, not a Server ID.")
      return
    }
    if (checkSelfPermission(Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) {
      pendingCarrierCall = number to handle
      permissionRequest.launch(arrayOf(Manifest.permission.CALL_PHONE))
      return
    }
    try {
      val telecom = getSystemService(TELECOM_SERVICE) as TelecomManager
      val extras = Bundle().apply { putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, handle) }
      telecom.placeCall(Uri.fromParts("tel", number, null), extras)
    } catch (_: SecurityException) {
      setStatus("Android denied the carrier-call request. No call was placed.")
    } catch (e: Exception) {
      setStatus("Could not start the selected SIM call: " + (e.message ?: "unknown error"))
    }
  }

  private fun button(textValue: String, action: () -> Unit): Button =
    Button(this).apply {
      text = textValue
      isAllCaps = false
      textSize = 14f
      setTextColor(0xFFF3F7FB.toInt())
      setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xFF1B3046.toInt()))
      setOnClickListener { action() }
    }

  private fun matchWrap() = LinearLayout.LayoutParams(
    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
  ).apply { bottomMargin = dp(7) }

  private fun weighted() = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
    .apply { marginEnd = dp(5) }

  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

  private fun setStatus(message: String) {
    statusText.text = message
    statusText.visibility = View.VISIBLE
  }
}
