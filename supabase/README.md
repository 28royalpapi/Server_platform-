# Server backend (live project)

Supabase project: `hzuovekqsjtpvmbuybxs` in the Viva Aliya Baby organization.

## Deployed functions

- `server-calls` — Supabase Auth JWT-protected profiles/preferences, calls, and WebRTC signalling.
- `server-gateway` — one-use SIM-gateway pairing-code creation/claiming, SMS queue polling and send/delivery results.
- `server-guest` — time-limited invite-token guest join and WebRTC signalling.
- `server-send-sms` — verifies a Supabase Auth Standard Webhooks Send SMS Hook event and queues the OTP only while a gateway is online.

Database migration `20261021114947_server_backend_schema` is applied. The same SQL is checked in under `migrations/`.

## Required activation

The functions are deployed, but real SMS still requires configuring the Supabase Auth Send SMS Hook URL and matching `SEND_SMS_HOOK_SECRET`. Use a strong secret; do not commit it into GitHub or browser code. The Android SIM gateway needs a working SIM, internet, SMS permission and battery settings that allow the foreground service to remain running. Supabase must have Phone auth enabled. No secret key belongs in the web application.

The guest call endpoint is not a PSTN bridge: a guest needs mobile data/Wi-Fi and microphone permission. The current ICE response includes public STUN only. Networks that block peer-to-peer paths require a separately hosted TURN relay.
