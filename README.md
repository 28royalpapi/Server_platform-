# Server Platform

Server is a website-led onboarding and internet-calling project. The website creates a Server ID. Android's small native connector registers Server with Android Telecom; a separate optional SIM Gateway can send real SMS messages using an Android phone's SIM. Server is not a cloned SIM/eSIM and this repository does not provide a PSTN/SIP carrier bridge.

## Public service addresses

- **Server onboarding website:** https://server-onboarding-ochre.vercel.app
- **Server Backend dashboard:** https://supabase.com/dashboard/project/hzuovekqsjtpvmbuybxs
- **Server Backend URL:** `https://hzuovekqsjtpvmbuybxs.supabase.co`

The default SMS route uses Server's own Android SIM Gateway and Supabase; it does not require a separate VPS or third-party SMS provider. The two public addresses are the Server digital address (`https://server-onboarding-ochre.vercel.app`) and the Server Backend URL (`https://hzuovekqsjtpvmbuybxs.supabase.co`). The gateway uses the Backend URL; Server puts its digital address in the guest invitation SMS. Supabase/Vercel usage remains subject to plan quotas and service limits; mobile-network SMS charges are separate.

## Backend and components

| Component | Responsibility |
|---|---|
| `server-auth` | Device-bound Server ID registration, optional phone OTP verification/linking, session renewal and revocation |
| `server-calls` | Authenticated call creation, WebRTC signalling, guest invitations and push/SMS delivery orchestration |
| `server-gateway` | Secure one-time pairing, per-device gateway tokens, durable SMS queue claiming, device presence and delivery callbacks |
| `server-guest` | Secure, time-limited guest browser invitations and WebRTC signalling |
| `server-send-sms` | Optional Supabase Auth Send SMS Hook adapter; not required for Server's custom OTP flow |
| `server-handoff` | Single-use website-to-native session handoff |
| `server-health` | Protected deployment heartbeat endpoint |
| Database | Server identities, sessions, calls, guest invitations, push receivers, gateway devices, SMS jobs, OTP challenges and rate limits |
| Web/native | Website-led onboarding, Android Telecom connector, Android SIM Gateway and iOS calling integration |

## Calling someone who does not use Server

A Server call to a non-member is a **guest browser call**, not an ordinary carrier voice call. The recipient receives an invitation link, opens it in a browser, grants microphone access and joins the WebRTC call. Both sides need internet access for the conversation.

The automated first-contact alert route is:

1. **Enrolled browser push:** Server first tries a Web Push invitation if the recipient's browser previously enrolled for call alerts.
2. **Server's own SIM Gateway:** if no browser push accepted the alert, Server checks whether the caller has an enabled Android SIM Gateway paired to their Server identity and recently online. It queues an SMS containing the caller's display name and secure invitation link. The gateway sends it using the paired Android phone's real SIM.
3. **Manual share:** if no enrolled browser receiver or paired gateway accepts the invitation, Server returns the secure link for the caller to share through an app they already use.

The first-party Gateway source is in `apps/android-sim-gateway/`. It sends the queued SMS through the Android phone's SIM using `SmsManager`, then reports carrier submission/delivery/failure callbacks to Server. The sender number visible to the recipient is the Gateway phone's SIM number. The mobile operator may charge the Gateway owner for each SMS.

An invitation SMS is only an alert and link. It does **not** ring the recipient's cellular line, make a PSTN call, or let an offline recipient answer. The actual conversation remains a WebRTC internet call.

Before an SMS can be claimed, the backend rechecks that the paired Gateway belongs to the caller and that the exact call is still ringing/connecting, the call and invitation have not expired, the invitation is not revoked, and the guest has not already joined. Stale jobs are discarded instead of sending late messages. The route is rate-limited to 3 messages per caller/recipient pair per hour and 20 per caller per hour.

## Set up the optional Android SIM Gateway

The core Server ID and all recipient browser calls work without installing the Gateway. Server can use one optional, explicitly shared Android SIM Gateway to send guest-call invitation SMS for all Server callers. Only the Gateway operator installs this companion; ordinary callers and recipients do not. The operator must opt in on the device and may incur carrier SMS charges.

- **Gateway companion APK:** [Download server-sim-gateway.apk](https://github.com/28royalpapi/Server_platform-/releases/download/server-android-connector-preview/server-sim-gateway.apk)
- Install it on an Android phone with a working SIM and mobile data or Wi-Fi.
- Sign in to Server onboarding and create your Server ID.
- In the optional SIM Gateway section, generate a one-time pairing code. It expires after approximately ten minutes and can only be claimed once.
- Open the Gateway companion, use the Server Backend URL above, enter the pairing code and tap **Pair this gateway**.
- On the Gateway device, explicitly tick **I consent to share this SIM** to let this SIM send guest-call invitations on behalf of other Server users. Leave it unticked to keep this SIM private to the account that paired it.
- Grant Android's SMS permission and notification permission when asked, then start the visible foreground service. Keep its persistent notification enabled and allow background operation/battery use on that phone.
- Keep the shared Gateway online. Once a shared Gateway is paired and online, callers do not need to install this companion or pair their own SIM Gateway.

The Gateway stores its private device token in Android encrypted storage. The backend stores only a hash of that token. Realtime broadcasts carry only a wake hint; the Gateway must still authenticate to claim the durable SMS job. A low-frequency queue check remains as a recovery path if Realtime is unavailable. Shared mode is limited to guest-call invitations, is rate-limited per caller and per shared device, and does not make the shared SIM available for another user's phone-verification OTPs.

## Optional phone-number verification

A Server ID does not require a phone number or SMS OTP. Users may optionally verify and link a number to their existing Server identity. This requires a paired Gateway that is online; carrier SMS charges may apply.

1. `server-auth` generates a six-digit one-time code, stores only an HMAC of it, and applies request/attempt rate limits.
2. An SMS job is queued only for a recently online Gateway paired to that Server account.
3. The code expires after five minutes and is single-use.
4. Successful verification links the number to the existing Server identity. Number-based incoming Server calls remain disabled until the user separately opts in.
5. Private Server session tokens are not put into website-to-app deep links.

The main custom OTP flow does not require Supabase Auth Phone or the optional `server-send-sms` hook.

## Normal phone integration and platform limits

- **Android:** the installed connector opens website-led setup and bridges the OS APIs that a browser cannot access. It registers Server as a system-managed Android `PhoneAccount`; the user must enable Server in Android Calling accounts. The connector does not clone a SIM, read the SIM phone number or require SIM selection. Phone dialer choices vary by Android version and manufacturer.
- **iPhone:** the native integration uses Apple's supported calling-app/CallKit path where the OS and required entitlement permit it. iOS does not expose SIM-slot selection or create a third cellular line for Server.
- **Carrier calling:** this codebase does not provide PSTN/SIP termination. An invitation SMS is not a carrier voice call, and a failed Server internet call is not silently handed over to a SIM.

## Testing and remaining physical-device gates

CI builds and tests native packages, checks website/backend contracts, and launches the Android SIM Gateway in a hosted emulator. These tests do not prove that a physical SIM delivered an SMS or that two physical phones completed a two-way audio call.

The physical test still required is: pair the Gateway on a real Android phone with a working SIM, send one invitation to a phone number you control, verify the received message and delivery callback, open the invitation on the recipient phone, and answer the guest WebRTC call. Also test background delivery under the phone manufacturer's battery restrictions and verify calling audio across two physical devices. Do not treat Server as production-ready until those checks pass.
