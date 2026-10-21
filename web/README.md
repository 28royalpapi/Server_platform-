# Server web setup

The web surface supports existing-number verification, consent/preferences and the browser guest invitation page. Ordinary calls belong in the installed native client; this setup site is not the normal dialer.

`config.js` points to the Server Backend Supabase project and contains only the public publishable key. The primary OTP flow calls `server-auth`, which rate-limits issuance, uses a five-minute HMAC-protected code and queues the real SMS to a paired Android SIM gateway. Supabase Auth phone-provider settings and the optional `server-send-sms` hook are **not** prerequisites for this custom flow.

An OTP request deliberately returns `SMS_GATEWAY_OFFLINE` until a paired gateway has checked in within the last 90 seconds. Install the Android SIM gateway on a device with a working SIM, configure this project URL and public key, claim an unexpired one-time pairing code, and keep the gateway's foreground service online. Carrier SMS fees may apply.

Guest links open `guest.html?token=...` and require HTTPS, internet access, a supported browser, microphone permission, and the remote caller to remain online. A web invitation cannot initiate a normal cellular call or reach a guest without data. Only STUN is configured; calls behind restrictive NAT may require TURN infrastructure.
