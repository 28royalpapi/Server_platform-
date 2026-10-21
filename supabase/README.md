# Server backend (live project)

Supabase project: `hzuovekqsjtpvmbuybxs` in the Viva Aliya Baby organization.

## Deployed functions

- `server-auth` — custom SIM-backed OTP issuance/verification, hashed opaque session tokens, session renewal/revocation.
- `server-calls` — profile/preferences, calls, incoming-call queries and WebRTC signalling; checks Server sessions in the handler.
- `server-gateway` — one-time gateway pairing-code creation/claiming, SMS queue polling and delivery status.
- `server-guest` — time-limited browser invite-token guest join and signalling.
- `server-send-sms` — optional adapter for the Supabase Auth Send SMS Hook. The custom OTP flow does not use it.

## Custom phone verification

The applied migration `20261021124332_server_custom_phone_auth` removes the profiles/call foreign-key dependency on Supabase Auth and adds `server_otp_challenges` and `server_sessions`. A random HMAC pepper is stored in Supabase Vault. OTP challenge rows store only a salted HMAC, five-minute expiry, attempt count and consumed timestamp. Issuance is rate-limited by phone and IP hash and queues a code only if an enabled SIM gateway checked in within the preceding 90 seconds. Five failed attempts consume a challenge. Successful verification issues a 256-bit random opaque access token valid for 30 days; the database stores only its SHA-256 hash. Tokens are revocable and refreshed in place while the session remains active.

The client sends that token as the Bearer credential to `server-calls` and the pairing-code action in `server-gateway`. Because it is not a Supabase Auth JWT, `server-calls`, `server-auth`, and `server-gateway` have platform JWT verification disabled and implement their own token verification. Do not change these functions back to JWT verification without also changing the session protocol.

## Required for a real SMS test

The project currently has **zero online gateway devices**. Pair the Android SIM gateway with the project URL and public publishable key, keep it connected to the internet and allow the SMS/foreground-service permissions. Then request an OTP to a phone you control and verify receipt on that handset. Mobile carrier SMS fees may apply. No Auth hook secret or external SMS-provider API key is needed for the custom OTP route.

## Calling caveats

The signalling database passes WebRTC setup messages and does not relay call audio. STUN is configured; restrictive NAT/firewalls may require a separately hosted TURN service. A guest link still requires internet access and microphone permission. Background incoming call delivery and PSTN/carrier routing are not implemented by these functions.
