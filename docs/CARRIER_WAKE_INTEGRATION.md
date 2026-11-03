# Carrier-controlled offline wake alerts

## Product requirement

Server needs a real incoming mobile-network alert for a recipient whose mobile data is off but whose SIM remains reachable for incoming voice signalling. The handset should show and ring like an ordinary incoming call. When the recipient answers, the mobile operator must **not bridge the original caller to the recipient over cellular voice**. The operator should either release the alert before any caller-to-recipient voice bearer is established, or play a short operator-hosted instruction and then release it. Server should establish the actual conversation only after the recipient has data connectivity, using WebRTC.

This is a carrier-network feature, not a dialer-app feature. Android Telecom and iOS CallKit can surface Server internet calls, but neither gives a regular third-party app authority to turn an arbitrary carrier call into an alert-only call. Server must not silently place ordinary PSTN calls or use flash calls as a substitute.

## Current implementation boundary

The current codebase supports:

- Server-to-Server signalling and WebRTC call setup when both endpoints have internet.
- Android Telecom incoming-call integration for Server internet calls.
- Push-notification wake-up for registered Server devices when FCM/APNs is configured.
- Guest-browser invitations for non-Server recipients, with a user-confirmed SMS composer when no paired Server SMS gateway is live.
- Expiring invitations and missed-call reconciliation after a Server device reconnects.

The current production backend has no registered push endpoints and no enabled Server SMS gateway. This means that those delivery paths must be configured and physically tested before claiming reliable background delivery.

**Carrier-controlled ringing is not implemented.** There is no public free Nigerian operator API currently wired into this repository that can ring an offline-data SIM while guaranteeing that answering does not establish a cellular voice conversation. Do not infer carrier-wake success from a Server notification, an SMS, a missed-call alert, a normal tel dial, or a flash call.

## Network API responsibilities

### Device reachability

The CAMARA Device Reachability Status API can report whether a phone is reachable over mobile data, SMS, or both. The Device Reachability Status Subscription API can notify a service when that status changes.

These capabilities are useful for the **handover after the recipient enables data**. They do not place an incoming call, generate a handset ringtone, prove voice-call reachability, or control the answer treatment of a cellular call.

The API needs to be exposed by the recipient's mobile operator or an authorised aggregator, with production credentials and the required user consent. The open-source CAMARA specification is not itself a free production gateway.

Reference:
- https://camaraproject.org/device-reachability-status/
- https://camaraproject.org/device-reachability-status-subscriptions/
- https://github.com/camaraproject/DeviceReachabilityStatus

### Carrier wake alert

A production carrier integration must expose an operator-side capability with semantics equivalent to:

1. Create a wake alert for a recipient's verified mobile number and an existing Server call ID.
2. Request native mobile alerting while the SIM is voice-reachable, regardless of whether mobile data is available.
3. Apply an explicit answer treatment: release without bridging the original caller, or play an operator-hosted announcement and release.
4. Guarantee that no cellular voice session is bridged between the original caller and recipient.
5. Report alerting, answer/announcement, release, timeout and delivery-failure events to Server.
6. Support cancellation when the recipient becomes data-reachable or the Server caller ends the invitation.
7. Document recipient charging, caller charging, interconnect fees, coverage, roaming, CS/IMS/VoLTE behaviour, rate limits, consent and retention.

The operator must explicitly confirm the no-bridge guarantee and charging rules. A short ordinary call that is cancelled by application code is not an equivalent service; a recipient can answer before cancellation and create a billable cellular call.

## Target sequence

1. Caller starts a Server call. The backend creates a time-limited pending call.
2. If the Server recipient is already data-reachable, the backend delivers the normal Server invitation. If the recipient is a non-Server contact, the guest invitation flow is used.
3. If mobile data is unavailable, Server asks the contracted operator wake-alert API to alert the recipient. The operator only attempts this when the SIM is registered and voice-reachable.
4. The handset rings using its ordinary phone alert surface. On answer, the operator applies the agreed no-bridge answer treatment. If an announcement is supported, it tells the recipient to enable mobile data.
5. When the CAMARA reachability subscription reports mobile data connectivity, Server marks the recipient data-reachable, cancels the carrier alert and sends the pending Server invitation.
6. A Server user answers in the Server app. A non-Server recipient opens the expiring guest URL and answers in the browser. In both cases, the actual conversation is WebRTC.

A recipient with the SIM switched off, outside voice coverage, in airplane mode, or otherwise unregistered cannot be made to ring by this mechanism.

## Required operator validation

Do not enable the feature in production until a carrier has demonstrated all of the following on real subscriber devices:

- Mobile data is disabled while voice registration remains active.
- A genuine incoming call surface appears and rings on the handset.
- Answer does not connect the original caller to the recipient over cellular voice.
- If an announcement is used, it is network-hosted, short, and its charge treatment is disclosed.
- Server receives accurate alert lifecycle callbacks.
- Turning mobile data on triggers a reachability callback, and the pending WebRTC invitation is delivered.
- The guest flow works for a person who has never installed Server.
- The operator has validated both CS and IMS/VoLTE behaviour, applicable Nigerian regulatory/consent requirements, and cross-network limitations.

Test separately on MTN, Airtel, Glo and 9mobile. One operator integration must not be presented as nationwide coverage.

## Commercial and technical discovery route

The following are discovery routes, not confirmed providers of the required carrier-wake service:

- MTN Nigeria / Chenosis developer platform: https://chenosis.io/api-catalog
- NetAPI Telecom, a GSMA Open Gateway channel partner in Africa: https://www.netapi.africa/
- GSMA Open Gateway API and launch information: https://www.gsma.com/solutions-and-impact/gsma-open-gateway/

Ask each provider specifically for a **subscriber-consented mobile-terminated alert-only call with no caller-to-recipient voice bearer, controlled answer treatment, lifecycle callbacks, cancellation, and data-reachability subscription**. Do not accept a standard PSTN voice API, missed-call notification, SMS-only service, or Number Verification API as a substitute.

## Safety rule for future code

Until a carrier contract and sandbox/production endpoint are available, the application must return an explicit unavailable status for carrier wake. It must not fall back to a normal cellular call or flash call and imply that the recipient can only answer over WebRTC. Keep the Server WebRTC, FCM/APNs, and guest-browser paths separately labelled and independently testable.
