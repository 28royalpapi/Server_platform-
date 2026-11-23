package com.server.receiver

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class WakeActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val caller = intent.getStringExtra(EXTRA_CALLER_NAME).orEmpty().ifBlank { "Your Server contact" }
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setPadding(28, 32, 28, 32)
      setBackgroundColor(0xFF07121B.toInt())
    }
    root.addView(TextView(this).apply {
      text = "SERVER"
      textSize = 13f
      setTextColor(0xFF65D6AE.toInt())
      gravity = Gravity.CENTER
    })
    root.addView(TextView(this).apply {
      text = caller + " is trying to reach you"
      textSize = 25f
      setTextColor(0xFFFFFFFF.toInt())
      gravity = Gravity.CENTER
      setPadding(0, 22, 0, 14)
    })
    root.addView(TextView(this).apply {
      text = "Your internet connection is unavailable. Turn on mobile data or Wi-Fi, then continue in Server. The short cellular signal has ended; the actual conversation will use WebRTC."
      textSize = 16f
      setTextColor(0xFFCAD5DF.toInt())
      gravity = Gravity.CENTER
      setPadding(0, 0, 0, 28)
    })
    root.addView(Button(this).apply {
      text = "Turn on data and open Server"
      setOnClickListener {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://server-onboarding-ochre.vercel.app/receiver.html")))
        finish()
      }
    }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    setContentView(root)
  }

  companion object {
    const val EXTRA_CALLER_NAME = "server.receiver.caller_name"
    const val EXTRA_CALLER_PHONE = "server.receiver.caller_phone"
  }
}
