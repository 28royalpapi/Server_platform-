# Server Platform

Server is a website-led internet-calling platform. The website creates a Server ID. The single Android application contains the Android Telecom calling connector and the SMS-gateway capability used only on Server-operated gateway handsets. Server does not clone a SIM or create a new carrier number. A customer's personal SIM is never used to send Server messages.

## Public service addresses

- **Server onboarding website:** https://server-onboarding-ochre.vercel.app
- **Server Backend dashboard:** https://supabase.com/dashboard/project/hzuovekqsjtpvmbuybxs
- **Server Backend URL:** `https://hzuovekqsjtpvmbuybxs.supabase.co`

The **Server digital address** is the onboarding website. The SMS gateway uses Server Backend and Android gateway phones/SIMs owned or controlled by Server. Server pays the carrier charges and bundles for those devices. Customer handsets and mobile accounts are never used as the SMS sender. Server does not use the hosted TextBee API or a third-party per-message SMS API for this route; TextBee's source was reviewed as a reference, not copied into the Server codebase. Carrier throughput, local tariffs and anti-spam rules still apply to Server's own gateway fleet.

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
| Web/native | Website-led onboarding, one Android app with Telecom and managed gateway capability, and iOS calling integration |

## One Android app — no customer SIM gateway

The website provides one Android download. That same APK contains:
- the Server Android Telecom calling connector used by customers; and
- the SMS-gateway service, activated only on a Server-operated handset.

There is no separate consumer Gateway APK, no gateway URL, and no SIM-picker step in customer onboarding. The gateway service is not a customer feature: the company handset uses Android's default SMS subscription automatically, and the device is registered as platform-owned before it can claim message jobs. The first-party source remains in `apps/android-caller/app/src/main/java/com/server/caller/ServerSmsGatewayService.kt`.

The gateway is **not required** to create a Server ID, enable a customer's Android calling account, or make Server-to-Server internet calls. Customers never connect their SIM to send invitations. A Server-owned gateway fleet is required for automatic SMS invitations and phone-verification OTPs. If every platform gateway is offline, Server does not silently fall back to the caller's SIM: it reports that SMS was not sent and offers browser push or the share sheet instead.

The managed gateway uses Android's visible foreground-service notification, a realtime wake channel, a queue-recovery poll and batched queue draining. Android can still stop a gateway because of force-stop, OEM battery restrictions, permission revocation, reboot or network loss. Server operations must keep its managed gateway handsets powered, connected and permitted to run in the background.

## Calling someone who does not use Server

A call to a non-member is a **guest browser call**, not an ordinary carrier voice call. The invitation contains a short-lived secure link. The recipient opens it in a browser, grants microphone access, and joins the WebRTC call. Both parties need working internet for the conversation.

The available first-contact alert paths are:

1. **Enrolled browser push:** Server can send a push alert if the recipient previously enrolled their browser and granted notification permission.
2. **Server-operated SMS gateway:** Server queues the invitation for a company-owned/managed Android gateway phone and a Server-funded SIM to send. The caller's phone is never selected as the sender.
3. **Manual share:** if no platform gateway is online and no browser push is available, the app returns a secure invitation link for the caller to share using an app they already use.

An invitation SMS only alerts the recipient and carries the link. It does **not** ring their ordinary cellular phone app, make a PSTN call, or allow an offline recipient to answer. An SMS can be submitted by Android and still fail or be delayed by the mobile operator. The system distinguishes Android's send result from the operator delivery report where supported.

The gateway sends using a Server-funded carrier plan. The caller's and recipient's personal SIM balances are not used to send Server's invitation. No hourly or daily message allowance is imposed by the Server application: every distinct call attempt creates its own invitation job, including a repeat call to the same recipient a few minutes later. The queue claims batches and drains them continuously; batch size is a processing detail, not a per-user quota. Carrier throughput, account bundle limits, destination-country rules and anti-spam enforcement remain outside the app's control and are paid/managed by Server.

Each invitation expires after two minutes. Expired, revoked or already-answered invitations are discarded instead of being sent late. The queue deduplicates the same event/job; it does not deduplicate separate call attempts to the same number.

## Optional phone-number verification

A Server ID does not require a phone number or SMS OTP. Users may optionally verify and link an existing number to their Server identity. The OTP is sent only through an online Server-operated SMS gateway. A customer's SIM is never used as the sender.

1. `server-auth` generates a six-digit one-time code and stores only an HMAC of it.
2. SMS is queued only when a recently online platform-owned gateway is available.
3. The code expires after five minutes and is single-use.
4. Successful verification links the number to the existing Server identity. Number-based incoming Server calls remain disabled until the user separately opts in.
5. Private Server session tokens are not put into website-to-app deep links.

## Branded invitation SMS and Open Graph preview

Classic SMS is still plain text; it cannot render custom fonts, HTML buttons, colours or a custom message bubble. Server uses a distinctive text layout and a link at the end:

```text
SERVER CALL
[Caller display name] is calling you.
Answer over the internet. Expires in 2 minutes.
https://server-onboarding-ochre.vercel.app/c/[secure-token]
```

The `/c/[secure-token]` route is rewritten to `server-guest-preview`, which returns Open Graph metadata and a caller-specific 1200×630 incoming-call image in the initial HTML response. The page then opens the secure browser call. Compatible messaging apps may show the preview card; the app can suppress previews, so the SMS text remains understandable without it. RCS rich cards can provide genuine image-and-action cards, but they require an RCS-capable recipient and a separately configured RCS for Business channel; they are not a guaranteed property of ordinary SMS.

## Global calling and platform limits

- **Server-to-Server:** both users can call across countries over the internet, subject to internet reachability, supported app versions, regional signalling and media relay availability.
- **Non-Server browser guest:** recipient needs to open the invitation on a compatible browser, grant microphone permission and maintain internet access.
- **Ordinary cellular phone calls:** this codebase does not provide global PSTN/SIP termination. To ring a non-Server phone as a normal carrier call when the recipient has no Server internet receiver, Server needs a contracted voice-termination provider and country-by-country regulatory/numbering arrangements.
- **Android:** the user enables Server in Android Calling accounts. Customers do not select a SIM or grant SMS-send permission for Server invitations.
- **iPhone:** the native integration must use Apple's supported calling-app/CallKit path where the required OS support and entitlement permit it. iOS does not expose SIM-slot selection or create a third cellular line for Server.

## Distribution note

The managed gateway code uses Android's `SEND_SMS` permission on the Server-operated gateway handset. Google Play restricts this permission to qualifying default SMS/Phone/Assistant roles and disallows ordinary content-sharing/invitation use cases. The APK must not be assumed to pass Google Play review merely because the gateway SIM belongs to Server. A Play Store release still needs a policy-compliant invitation/verification route or an eligible default-handler product design; direct distribution can be used for controlled pilots while that policy path is resolved.

## Testing and remaining production gates

CI can verify source contracts, build the Android package, exercise Telecom compatibility and launch the single installed package in an emulator. An emulator cannot prove that a physical SIM delivered an SMS. The next physical acceptance requires a Server-owned or Server-controlled gateway handset with a Server-funded SMS-capable SIM, the combined app installed, the device marked platform-owned and online, and a fresh invitation sent to a controlled recipient number. A customer's ordinary phone must not be used as the SMS sender. Then verify receipt, delivery callback and the browser guest-call audio.

The broader call service is still a pilot, not a certified large-scale production network. Before claiming 100,000 concurrent calls, it needs measured multi-region WebSocket signalling, push delivery, regional TURN capacity, staged load tests, recovery tests and real two-device audio acceptance. GitHub source, a successful APK build or a synthetic queue drain is not proof of 100,000 concurrent voice calls.
