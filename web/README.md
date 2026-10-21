# Server web setup

This site is the onboarding surface only: existing-number verification, consent and preferences. It is not the ordinary calling UI. Guest invitations are opened at `guest.html?token=...` and require HTTPS, internet access, browser microphone permission, and the remote party to remain online.

The browser configuration points to the Server Backend Supabase project. Only the public publishable key is stored in `config.js`; never place service-role or secret keys in web assets.

## Before real OTP testing

1. In Supabase Authentication, enable Phone auth and configure the signed Send SMS Hook to `https://hzuovekqsjtpvmbuybxs.supabase.co/functions/v1/server-send-sms`.
2. Set a strong `SEND_SMS_HOOK_SECRET` as a Supabase Edge Function secret and use the matching Standard Webhooks secret in the Auth hook configuration.
3. Pair an always-online Android SIM gateway. A real SMS is sent through that phone's SIM; carrier SMS charges may apply.
4. Verify delivery with a phone you control. Do not treat an accepted HTTP request or a simulated code as proof of SMS delivery.
