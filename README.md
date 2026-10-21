# Server Platform

Server is a Nigerian phone onboarding and internet-calling project. Website onboarding verifies an existing number; ordinary calls are intended to run through installed native clients. This is **not** an additional SIM/eSIM or a PSTN/carrier bridge.

## Live Supabase backend

- **Project:** [Server Backend](https://supabase.com/dashboard/project/hzuovekqsjtpvmbuybxs)
- **Project URL:** `https://hzuovekqsjtpvmbuybxs.supabase.co`
- **Organization:** Viva Aliya Baby
- **Current deployment:** 4 Edge Functions are deployed and ACTIVE; the schema migration is applied.

| Component | Current status |
|---|---|
| `server-calls` | Deployed; profile preferences, call records and WebRTC signalling |
| `server-gateway` | Deployed; one-time pairing code creation/claim, SIM SMS job polling and delivery reporting |
| `server-guest` | Deployed; time-limited guest invite join and signalling |
| `server-send-sms` | Deployed; validates Supabase Auth's signed Send SMS Hook and queues real SMS work |
| Database schema | Applied; profiles, SMS jobs, gateway pairing/devices, calls, members, guest invites, signals and rate-limit tables |
| Browser config | Uses the new project's public publishable key only |

The actual deployed TypeScript is checked into `supabase/functions/`. Database SQL is in `supabase/migrations/20261021114947_server_backend_schema.sql`.

## Required before live OTP delivery

Deploying a function does not configure Supabase Auth to call it or create a physical SMS gateway. In the new project's Dashboard:

1. Enable **Authentication → Providers → Phone**.
2. Set the **Authentication → Hooks → Send SMS Hook** URL to `https://hzuovekqsjtpvmbuybxs.supabase.co/functions/v1/server-send-sms`.
3. Set a high-entropy `SEND_SMS_HOOK_SECRET` as a Supabase Edge Function secret and configure the matching Standard Webhooks secret on that Auth hook. Do not put it in GitHub or frontend JavaScript. The deployed hook deliberately refuses OTP requests when this secret is not set.
4. Sign in through the website once OTP works, generate a one-time gateway pairing code from the setup completion screen, then pair an actual Android phone with a working SIM. Keep its foreground service and internet connection running.
5. Test delivery to a phone you control. SMS delivery must be proved by receipt on the device; an API response is not proof.

The website files are in `web/`. Its `config.js` contains only the public publishable key, which is intended for browser use. No service-role or secret key is committed.

## Calling limitations

Server-to-Server calls and guest browser calls use WebRTC. Guest calls require the guest to open the invitation while online and grant microphone access. Without TURN relay infrastructure, some networks may not connect peer-to-peer. An SMS invitation cannot cause a traditional cellular ring/audio call when the guest has no data. Background incoming calls also require platform-specific push delivery; iOS PushKit/APNs is not configured.

## Source verification

- `npm run check` — backend and web source contract assertions.
- `npm run check:web` — JavaScript syntax validation.
- Native Android/iOS builds, emulator recordings, actual carrier SMS, and end-to-end audio calls are **not yet verified** unless a CI run or device test explicitly demonstrates them.

Do not treat Server as production-ready until the SMS hook is configured, a physical SIM gateway is paired, security checks are passed, and end-to-end device tests succeed.
