# Server Reach: first-contact transport decision

**Decision date:** 11 November 2026  
**Status:** Research-backed architecture decision; no carrier credentials or production transport enabled.

## Product requirement

A Server caller enters an ordinary E.164 phone number and starts a call. The recipient may have no Server account and no Server native app. The recipient should receive a trustworthy, caller-identified alert, answer, and speak to the Server caller.

There are two distinct desired experiences:

1. **Automatic browser invitation:** a network channel delivers a short-lived invitation to the recipient's phone. The caller's chosen name appears in the invitation/preview. Tapping Answer opens the guest browser and connects by WebRTC.
2. **Native phone ringing with no link:** the recipient's normal Phone app rings. This requires a carrier voice call. If the Server caller is on WebRTC, a media bridge must connect the WebRTC leg to the carrier voice leg. The recipient's leg is cellular carrier voice, not browser WebRTC.

Do not describe these two paths as one transport.

## What the repository already does

- The guest-call backend creates a fresh 256-bit invitation token for each guest call, stores only its hash, and commits the invite with the call.
- The live call is time-limited; the guest invite token has a separate expiry.
- The caller's display name is used in the guest page and dynamic Open Graph preview.
- If the recipient previously opened the guest page and explicitly enabled browser notifications, Web Push can wake that browser without a Server app or account.
- If no browser subscription exists, the current path returns a caller-identified invitation for explicit sharing. It does not send an SMS.
- `server-send-sms` currently handles Supabase Auth OTP webhooks. The paired Android SIM gateway sends queued SMS jobs through its SIM. It does not currently send guest-call invites.
- The SIM gateway uses Android `SmsManager`; its own screen warns that SMS may incur normal carrier charges. This avoids an SMS aggregator, not the operator's SMS charge.

These existing paths must remain independently observable. A push provider accepting a notification is not proof that the handset displayed it.

## First-contact transport findings

### Browser Web Push

**Useful for repeat calls after enrolment.** The browser creates a push subscription after the person opens the guest page and grants permission. The resulting endpoint is addressable by the push service. A phone number on its own is not a Web Push endpoint.

On iOS, background Web Push requires the supported Home Screen web-app flow and user permission. It is not universal background reachability from an ordinary, never-opened Safari tab.

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
3. Treat **automatic first-contact invitation delivery** as an operator/aggregator integration. The preferred commercial ask is an operator-sponsored or startup-pilot transactional invitation channel, with SMS and RCS separately evaluated. No free entitlement is assumed.
4. Treat **no-link native ringing** as a separate hybrid voice product path: WebRTC caller → Server media bridge → approved SIP/voice provider → recipient's normal phone. This is the most faithful implementation of the no-link ringing experience, but it has per-minute and infrastructure costs and is not recipient-side browser WebRTC.
5. Do not implement a fake "number → internet push" transport, an unsolicited RCS sender, a flash-call trick, or a default paid SMS fallback. A carrier adapter must remain disabled until its commercial access, consent model, price limits, and delivery callbacks are proven.

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
