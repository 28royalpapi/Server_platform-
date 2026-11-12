# Server Reach: first-contact transport decision

**Decision date:** 11 November 2026  
**Status:** TextBee REST adapter is implemented on `android-finish`, but remains inactive until a TextBee API key and Android gateway are configured in the Server Backend Supabase project. No SMS has been sent and no production secret has been set.

## Product requirement

A Server caller enters an ordinary E.164 phone number and starts a call. The recipient may have no Server account and no Server native app. The first-contact route sends a caller-identified SMS invitation; tapping its link opens the guest browser and connects the recipient to the caller by WebRTC.

This is distinct from **native phone ringing with no link**. That experience requires a carrier voice call and a media bridge between the caller's WebRTC session and a PSTN/SIP leg. SMS cannot make the recipient's normal Phone app ring.

## Existing caller identity and Open Graph preview
The SMS now uses the short public route `https://server-onboarding-ochre.vercel.app/c/{token}`. Vercel rewrites that path to the Supabase `server-guest-preview` Edge Function without changing the URL shown to the recipient. The preview endpoint remains the source of truth for caller-specific HTML metadata and the 1200 × 630 PNG. This short form reduces SMS length and gives the link preview a stable Server-domain URL; it does not change the underlying invite token or call-authentication checks.

The repository already has a dynamic `server-guest-preview` endpoint. It validates the invite and call state, obtains the caller's Server profile display name, generates a 1200 × 630 caller-specific PNG, and supplies `og:title`, `og:description`, `og:image`, image dimensions, alt text and Twitter card metadata. The title is phrased as “{caller name} is calling you through Server”; the image includes the caller's name and an incoming-call label. The preview page then opens the secure guest call page with an Answer action.

The preview uses the caller's **Server profile display name**. It cannot read the recipient's private Android Contacts database from an SMS preview or ordinary browser. If the recipient has saved the gateway/caller number, Android may show a saved contact name in its own interface, but that is separate from Open Graph metadata and is not guaranteed.

Rich preview rendering is controlled by the receiving SMS app, link-preview settings, network access and link scanners. Some apps display the image and title; others show only the SMS text and URL. Server supplies valid OG metadata but cannot force every messaging app to render the card.

## First-party caller-owned Android SIM Gateway — default SMS route

Server's own Android SIM Gateway is the default first-contact SMS transport when the caller has paired a gateway that was active in the last 90 seconds. It pairs to the caller's Server account, runs an explicitly started foreground service, polls the Server SMS queue, sends with Android `SmsManager`, and reports carrier send/delivery callbacks.

This is the key cost decision: **the default route does not need a separate TextBee VPS, TextBee API subscription, MongoDB, Redis or a second SMS platform.** The queue and authenticated gateway API already run in the existing Server Backend Supabase project. The Android phone is the SIM gateway; the mobile operator carries and charges for the SMS. The Android device must be online, powered, and allowed to run the foreground service.

The checked-in gateway code is in `apps/android-sim-gateway/`; its backend is `supabase/functions/server-gateway/`. The guest call backend looks up only a fresh gateway owned by the caller, applies per-sender/per-recipient rate limits, and queues the invitation. The database claim guard rechecks caller ownership, active call state, invite expiry, revocation and prior join before the SMS can be claimed.

The caller's SIM number is the SMS sender. The Open Graph card separately displays the caller's Server profile name. To make Android's SMS sender header resolve to a name the recipient saved, the gateway SIM number must be the number saved in the recipient's contacts; the OG metadata cannot read the recipient's private Contacts database.

## Optional TextBee fallback adapter

Server retains a server-side TextBee adapter for controlled experiments or as a fallback when a caller has no usable first-party gateway. It is **not required** for the default self-operated route.

The SMS text remains concise:

`{caller name} is calling: {invitation URL}`

The guest-call transport order is:

1. If Web Push is accepted for an already-enrolled guest browser, use Web Push and do not send an SMS.
2. Otherwise, apply the existing per-caller/per-recipient and per-caller rate limits, then use the caller-owned Server SIM Gateway if it is online.
3. Only when our own gateway cannot accept the job, try TextBee if `TEXTBEE_API_KEY` is configured.
4. If TextBee times out or returns a 5xx response, report an uncertain result and do **not** send a second SMS automatically. This prevents duplicate invitations when the first request may have reached TextBee.
5. Report TextBee API acceptance separately from carrier `sent` / `delivered` confirmation. A successful API response is not proof that the handset received the message.

Optional TextBee configuration (store only as Supabase Edge Function secrets in **Server Backend**, never in Git, website JavaScript, the Android APK or chat):

- `TEXTBEE_API_KEY` — enables the external fallback.
- `TEXTBEE_BASE_URL` — optional; defaults to `https://api.textbee.dev/api/v1`, or set this to a separate self-hosted TextBee API.
- `TEXTBEE_DEVICE_ID` — optional; pins the request to one TextBee gateway device.
- `TEXTBEE_SIM_SUBSCRIPTION_ID` — optional numeric Android SIM subscription ID; it must be configured together with `TEXTBEE_DEVICE_ID`.

The hosted TextBee Free plan is limited to one active Android device, 50 messages per day and 300 per month. Hosted TextBee receives the recipient's phone number and SMS body, including the invitation URL. Carrier plan/bundle and international-SMS charges still apply. Self-hosting TextBee removes its hosted-plan cap but adds an independently operated API/dashboard/database/Redis/FCM/SMTP stack and server maintenance. TextBee source is AGPL-3.0; review the licence before modifying or incorporating it into Server.

The database restricts a `guest_invite` job to a gateway owned by that call's caller. Before a job is claimed, the database rechecks caller ownership, ringing/connecting state, call expiry, invitation expiry, revocation and prior join state; stale invitations are discarded.

This is an Android-only optional route. Google Play restricts `SEND_SMS` for non-default SMS/Phone apps, especially for invitation/content-sharing use. Do not silently bundle the gateway into the normal Play-distributed caller app without an approved distribution/permissions path. iOS does not expose a background third-party SIM SMS API; use a user-approved message composer or a separately provisioned messaging service.

## First-contact transport findings

### Browser Web Push

**Useful for repeat calls after enrolment.** The browser creates a push subscription after the person opens the guest page and grants permission. The resulting endpoint is addressable by the push service. A phone number on its own is not a Web Push endpoint.

On iOS, background Web Push requires the supported Home Screen web-app flow and user permission. It is not universal background reachability from an ordinary, never-opened Safari tab.

### Other Android SIM gateway options

**httpSMS is a genuine alternative, not a magic free carrier route.** Its Android app can send through a phone SIM and it documents a hosted HTTP API plus a Docker self-host path. It is also AGPL-3.0. Its self-host stack requires Firebase, SMTP, Cloudflare Turnstile, a database and an API server. We should benchmark its Android reliability, delivery reports, SIM selection, E2E-encryption model and install experience against TextBee before replacing the current adapter. The Server transport boundary is deliberately provider-specific so this can be swapped without changing call or WebRTC logic.

Neither TextBee nor httpSMS can create free carrier SMS. A self-hosted backend may remove provider subscription caps, but the SIM still needs an active SMS plan and the backend still needs infrastructure.

### Operator or aggregator A2P SMS

**Can deliver a first-time URL, but is a paid carrier messaging path.**

- MTN's developer catalogue publishes an SMS API for Nigeria with an OAuth-protected send operation. Production access is permissioned; the public API document does not establish free sending or a price for Server.
- MTN's product labelled "RCS Communication" must not be treated as proof of a rich-card RCS send API: its published message schema is SMS, email, and mobile-app push. MTN's separate RCS capability-check operation only checks whether a number can receive RCS.
- An Android SIM gateway can send an invitation SMS from a user's linked handset, but the SIM's carrier plan is charged. It is not a no-cost network bypass.
- Jasmin and Kannel are open-source SMS gateway software. They need a connection to an SMSC/operator/aggregator and valid account capacity/credit. Installing them does not create carrier access or free messages.

Do not silently enable SMS for call invitations. A production adapter needs an explicit account, price/budget control, sender approval, destination rules, delivery receipts, rate limits, consent handling, and an opt-out/compliance policy.

### RCS for Business

**A rich caller card and Answer URL button are technically possible for eligible, opted-in RCS recipients.** Google's RCS for Business API supports rich cards and URL actions. The recipient must have explicitly opted in to the agent's messages, and agent launch/brand approval and carrier coverage apply. It is therefore not a lawful universal cold-contact route to arbitrary numbers. The MTN capability check is not the send operation.

### Native carrier voice / SIP

**Best match for "just ring the other phone, no link", but it is a different audio path and is not free.**

- MTN Nigeria advertises a corporate SIP Trunking service that connects an IP PBX to its voice network.
- Airtel Nigeria also advertises business SIP trunking.
- Signals by PressOne documents a Nigerian Programmable Voice API and managed SIP access. Its published Base plan is ₦500,000/year excluding VAT and Nigerian outbound calls are ₦14–₦19.50/minute including VAT. SIP Access requires separate technical provisioning.
- Signals' `<Connect><Stream>` supports two-way call audio over a WebSocket. A Server media bridge could connect that carrier media stream to the caller's WebRTC session. The provider's `<Dial>` verb bridges phone-call legs; it does not, by itself, connect a browser WebRTC peer.
- Asterisk supports WebRTC clients over secure WebSockets, but it needs a reachable, persistent media server and a carrier SIP trunk.

This path can make the recipient's normal cellular Phone UI ring without Server installation or a URL. The recipient's audio leg is carrier voice (e.g. circuit-switched/VoLTE), not WebRTC in the browser. Caller ID must use a number the provider authorizes/owns; a per-user chosen display name is not guaranteed to appear on every Nigerian carrier handset. Verify presentation on MTN, Airtel, Glo, and 9mobile before promising it.

## Decision

1. Keep the existing **Server-to-Server WebRTC** route for Server users.
2. Keep **guest WebRTC + Web Push** as the zero-carrier-message-cost route after the recipient has enrolled once.
3. Use the **first-party caller-owned Android SIM Gateway** as the default first-contact SMS route. Keep TextBee as an optional fallback only when no paired Server gateway can accept the job. Measure queueing, carrier `sent` / `delivered` reports, preview display, link opens and answered calls separately. Do not create a second VPS stack until real usage demonstrates a need for one.
4. Treat **no-link native ringing** as a separate hybrid voice product path: WebRTC caller → Server media bridge → approved SIP/voice provider → recipient's normal phone. This is the most faithful implementation of the no-link ringing experience, but it has per-minute and infrastructure costs and is not recipient-side browser WebRTC.
5. Do not describe SMS as a native incoming call. TextBee sends an ordinary SMS containing a link. Native Phone-app ringing without a link remains a separate SIP/PSTN voice-bridge problem.

## Required partner proof before production

For an invitation channel, require written confirmation of: production API access, supported networks, allowed transactional use, opt-in/DND rules, sender identity, price per delivered message, rate limits, delivery callbacks, and whether the recipient pays anything.

For native voice, require: Nigerian mobile termination coverage, authorized caller-ID rules, call setup and media protocols, per-second tariff, concurrency, quality-of-service/SLA, call status callbacks, anti-fraud controls, and a real test to multiple MNOs.

For either route, test with real Android and iOS devices. A successful API response is not handset delivery; handset delivery is not a successful answer; a successful answer is not proof of two-way audio.

## Primary technical references

- MTN SMS API: https://developers.mtn.com/products/mtn-sms-api-v1
- MTN RCS capability check: https://developers.mtn.com/products/rcs-capability-api
- MTN SIP Trunking: https://uat-shop.mtn.ng/sip-trunking
- Airtel Nigeria SIP Trunk: https://www.airtel.com.ng/ng/business/sip-trunk
- Signals pricing: https://signals.pressone.africa/pricing
- Signals two-way media stream: https://docs.pressone.africa/programmable-voice/oneml/stream
- Asterisk WebRTC client configuration: https://docs.asterisk.org/Configuration/WebRTC/Configuring-Asterisk-for-WebRTC-Clients/
- Jasmin gateway requirements: https://docs.jasminsms.com/en/latest/installation/
- TextBee send API: https://textbee.dev/docs/sending-sms
- TextBee self-hosting: https://textbee.dev/docs/self-hosting
- httpSMS repository: https://github.com/NdoleStudio/httpsms
- httpSMS setup: https://docs.httpsms.com/
- Supabase Edge Function secrets: https://supabase.com/docs/guides/functions/secrets
