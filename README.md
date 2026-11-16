# Server Platform

Server is a website-led internet-calling platform. The website creates a Server ID. The Android application contains both the Android Telecom calling connector and an **optional** SIM SMS gateway in one installable package. Server does not clone a SIM or create a new carrier number.

## Public service addresses

- **Server onboarding website:** https://server-onboarding-ochre.vercel.app
- **Server Backend dashboard:** https://supabase.com/dashboard/project/hzuovekqsjtpvmbuybxs
- **Server Backend URL:** `https://hzuovekqsjtpvmbuybxs.supabase.co`

The **Server digital address** is the onboarding website. The SMS gateway uses Server Backend and the Android phone's own SIM. Server does not need a third-party per-message SMS API account or API key for this route. The mobile operator's SMS allowance, international messaging tariffs, roaming charges and fair-use terms still apply.

## Backend and components

| Component | Responsibility |
|---|---|
| `server-auth` | Device-bound Server ID registration, optional phone OTP verification/linking, session renewal and revocation |
| `server-calls` | Authenticated call creation, WebRTC signalling, guest invitations and push/SMS delivery orchestration |
| `server-gateway` | Secure device registration, per-device gateway tokens, durable SMS queue claiming, device presence and delivery callbacks |
| `server-guest` | Secure, time-limited guest browser invitations and WebRTC signalling |
| `server-send-sms` | Optional Supabase Auth Send SMS Hook adapter; not required for Server's custom OTP flow |
| `server-handoff` | Single-use website-to-native session handoff |
| `server-health` | Protected deployment heartbeat endpoint |
| Database | Server identities, sessions, calls, guest invitations, push receivers, gateway devices, SMS jobs, OTP challenges and rate limits |
| Web/native | Website-led onboarding, combined Android Telecom/SIM gateway app, and iOS calling integration |

## One Android app — gateway is optional

The website provides one Android download. That APK contains:
- the Server Android Telecom calling connector; and
- the optional SIM SMS gateway service.

There is no separate consumer Gateway APK, no manual gateway URL, and no pairing PIN in this flow. The first-party Gateway source is in `apps/android-caller/app/src/main/java/com/server/caller/ServerSmsGatewayService.kt`. The gateway sends through Android's `SmsManager` using the subscription the phone owner explicitly selected.

The gateway is **not required** to create a Server ID, enable the Android calling account, or make Server-to-Server internet calls. A user may connect a SIM in onboarding to enable automatic first-contact SMS invitations. If it is not connected or goes offline, Server can use a previously enrolled browser push receiver or show the system share sheet. The rest of Server calling remains usable.

The gateway uses a visible foreground-service notification, a realtime wake channel and a low-frequency queue recovery check. Android can still stop services because of user force-stop, OEM battery restrictions, permissions being revoked, reboot or loss of network. For dependable sending, the user must keep the app installed, grant the requested permissions and allow its background operation.

## Calling someone who does not use Server

A call to a non-member is a **guest browser call**, not an ordinary carrier voice call. The invitation contains a short-lived secure link. The recipient opens it in a browser, grants microphone access, and joins the WebRTC call. Both parties need working internet for the conversation.

The available first-contact alert paths are:

1. **Enrolled browser push:** Server can send a push alert if the recipient previously enrolled their browser and granted notification permission.
2. **The caller's own SIM:** if the caller has connected the optional Android gateway and it is online, Server queues an invitation SMS for that phone to send through its selected SIM.
3. **Manual share:** if neither automatic route is available, the app returns a secure invitation link for the caller to share using an app they already use.

An invitation SMS only alerts the recipient and carries the link. It does **not** ring their ordinary cellular phone app, make a PSTN call, or allow an offline recipient to answer. An SMS can be submitted by Android and still fail or be delayed by the mobile operator. The system distinguishes Android's send result from the operator delivery report where supported.

The gateway sends using the subscriber's own carrier plan. Server does not add a per-message SMS gateway fee to this first-party route, but Server cannot waive the carrier's SMS charges or override a plan's international SMS/fair-use limits. The user should check their carrier plan before enabling automatic SMS.

Guest-invitation delivery has anti-abuse protection and each invitation expires quickly. Expired, revoked or already-answered invitations are discarded rather than sent late. These controls protect users and the carrier SIM from SMS abuse; they are not a hosted gateway account quota.

## Optional phone-number verification

A Server ID does not require a phone number or SMS OTP. Users may optionally verify and link an existing number to their Server identity. The OTP needs an available SMS send route, such as the user's connected Android SIM gateway or a separately configured verification provider.

1. `server-auth` generates a six-digit one-time code and stores only an HMAC of it.
2. SMS is queued only for a recently online gateway authorized for that account.
3. The code expires after five minutes and is single-use.
4. Successful verification links the number to the existing Server identity. Number-based incoming Server calls remain disabled until the user separately opts in.
5. Private Server session tokens are not put into website-to-app deep links.

## Global calling and platform limits

- **Server-to-Server:** both users can call across countries over the internet, subject to internet reachability, supported app versions, regional signalling and media relay availability.
- **Non-Server browser guest:** recipient needs to open the invitation on a compatible browser, grant microphone permission and maintain internet access.
- **Ordinary cellular phone calls:** this codebase does not provide global PSTN/SIP termination. To ring a non-Server phone as a normal carrier call when the recipient has no Server internet receiver, Server needs a contracted voice-termination provider and country-by-country regulatory/numbering arrangements.
- **Android:** the user enables Server in Android Calling accounts. SIM selection in the optional SMS gateway is separate from Server voice calling.
- **iPhone:** the native integration must use Apple's supported calling-app/CallKit path where the required OS support and entitlement permit it. iOS does not expose SIM-slot selection or create a third cellular line for Server.

## Distribution note

The combined APK currently requests Android's `SEND_SMS` permission so the optional gateway can send invitations directly from the selected SIM. Google Play restricts this permission to qualifying default SMS/Phone/Assistant roles and disallows ordinary content-sharing/invitation use cases. A directly distributed preview APK can be used for controlled testing, but the current SMS invitation implementation should not be assumed to pass Google Play review. A Play Store release requires a policy-compliant invitation/verification route or an eligible default-handler product design.

## Testing and remaining production gates

CI can verify source contracts, build the Android package, exercise Telecom compatibility and launch the single installed package in an emulator. An emulator cannot prove that a physical SIM delivered an SMS. The next physical acceptance requires a real phone with an active SMS-capable SIM, the combined app installed, the gateway enabled and online, and a fresh invitation sent to a phone number the tester controls. Then verify receipt, delivery callback and the browser guest-call audio.

The broader call service is still a pilot, not a certified large-scale production network. Before claiming 100,000 concurrent calls, it needs measured multi-region WebSocket signalling, push delivery, regional TURN capacity, staged load tests, recovery tests and real two-device audio acceptance. GitHub source, a successful APK build or a synthetic queue drain is not proof of 100,000 concurrent voice calls.
