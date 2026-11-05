# Server production-readiness architecture

**Status as of 5 November 2026:** Server is a working prototype/pilot codebase, not a production calling service. A passing build or a Telecom instrumentation test does not change that classification. This document defines the target architecture and the release gates.

## 1. What production-ready means

The release must prove all of the following on real devices and under load:

- The caller can discover the recipient's actual availability, rather than infer it from a phone number.
- Call creation is authenticated, rate-limited, idempotent, and committed atomically with the participants and invitation.
- The notification reaches the intended device through a supported delivery channel; a provider accepting a push request is not proof that the phone displayed it.
- The recipient sees native ringing, can answer/decline, and has reliable two-way audio.
- Calls expire, reconnect, end, and become missed/failed consistently after app process death, network loss, device restart, or provider timeout.
- Guest calls work only through a channel the recipient has actually opted into or the caller can deliver to. An invitation URL by itself does not notify another person.
- The service has measured capacity, observability, abuse protection, disaster recovery, and operational alerts.

No scenario is marked complete until its evidence includes the call ID, delivery/ringing timestamps, both endpoint outcomes, and two-way media verification. Synthetic Telecom calls count only as OS integration tests.

## 2. Target service boundaries

### Control plane

A horizontally scaled call-control API authenticates users and owns call state transitions: start, accept, decline, active, reconnect, and hang up. It validates caller and callee, creates one call ID, applies abuse limits, and records an idempotency key. A single database transaction must create the call, its participant rows, and (for a guest) the hashed invitation.

### Durable state store

PostgreSQL remains the durable source of truth for:

- Server identities, consent, verified contact links, and device registrations.
- Call lifecycle metadata, participant membership, invitation hashes, and audit events.
- Delivery attempts, idempotency records, and durable outbox/queue state.

It should **not** be queried every few hundred milliseconds for each ICE candidate or used as the live WebSocket message bus. Voice media is not stored in Postgres. Call audio is not stored unless a separate recording feature is explicitly designed and consented to.

Supabase can remain the relational state store while the project is small. Replacing Postgres with another database will not solve a design that performs continuous HTTP polling and writes every signaling packet to the database. If the workload eventually outgrows managed Supabase, the same schema can be moved to a managed or self-hosted PostgreSQL service with connection pooling, read replicas, backups, partitioning, and multi-region strategy.

### Signaling and presence plane

Use persistent WebSocket connections through a separately scalable signaling gateway. Publish call offers, answers, ICE candidates, decline/hang-up state, and delivery acknowledgements over the live connection. Use Redis or NATS for cross-node presence and message fan-out, with short TTL leases. A node must be replaceable without losing the durable call state.

Presence must have explicit meanings:

- **Server app online:** an authenticated app session recently renewed a presence lease.
- **Server app background-reachable:** a registered push endpoint exists; actual delivery still needs an acknowledgement.
- **Guest browser online:** the guest page has an active authenticated invitation session/WebSocket.
- **Guest notification reachable:** the person previously granted browser push permission and has a valid Web Push subscription.

A phone number alone cannot prove that a non-Server person is online. A public contact record, phone-number lookup, or an invitation URL cannot wake a browser that has no active page or push subscription.

### Notification and delivery plane

Call setup should commit an outbox event and return promptly. Dedicated workers claim delivery jobs from a durable queue, send FCM/APNs/Web Push, record provider response and retry transient failures with bounded backoff, and move exhausted jobs to a dead-letter state. A push provider's HTTP 200 means accepted by the provider, not displayed or answered by the device.

Use:
- FCM for registered Android Server installations.
- APNs/PushKit where the iOS application and Apple entitlements support incoming VoIP calls.
- Web Push for guest browsers/PWAs only after the recipient has opted in and granted permission.
- SMS or a user-selected messaging channel to deliver a guest link when no push subscription exists.

### Media plane

Keep one-to-one WebRTC media peer-to-peer where possible. Operate authenticated TURN over UDP and TCP/TLS for networks where direct ICE connectivity fails. TURN credentials must be short-lived and scoped to the call. Measure the percentage of calls that need relay and the bandwidth cost.

A TURN relay is not optional for reliable global WebRTC reachability. STUN-only success on one Wi-Fi network is not production media coverage. For future group calls, use a media SFU rather than trying to mesh every participant.

## 3. Four call scenarios and their actual requirements

| Scenario | Required behavior | What makes it possible |
|---|---|---|
| Server to Server, recipient online | Near-immediate ringing, answer, bidirectional audio | Presence/WebSocket + native notification/Telecom + WebRTC + TURN fallback |
| Server to Server, app background | Wake and ring while device has internet; reconcile missed call after expiry | Registered FCM/APNs token, high-priority push, OS/OEM permissions, server-side call state |
| Server to non-Server, recipient online | Recipient receives an invite, opens a browser page, grants microphone, and talks | A previously opted-in Web Push subscription, or a delivered SMS/messaging link; a live guest WebSocket after opening |
| Server to non-Server, recipient offline | The phone must ring as a normal phone call, or the recipient gets a message to answer later | PSTN/SIP termination for an actual offline voice call; SMS only delivers a link and does not create a live voice call |

Important distinction: "app closed/background" while the phone is still connected to the internet is different from the phone having no network. No internet-based service can ring an offline device in real time. For an offline non-Server number to ring as a normal cellular call, Server needs a licensed/contracted PSTN/SIP route. That route has per-minute/provider costs. Without it, Server can queue an invitation for later delivery, but must not claim an immediate call.

## 4. Scale design and why the current polling path cannot be the final design

The previous guest page polled the Edge Function every 650 ms. At 10,000 simultaneously open guest pages, that is approximately **15,400 HTTP poll requests per second**, before counting database reads, call setup, Android polling, or media. The guest poll also queried both signals and call state. This is avoidable traffic, not a problem solved by buying a larger database.

The Android foreground listener previously polled incoming calls every 2.2 seconds. That remains a fallback in the present native implementation; it is not an acceptable primary delivery mechanism for a large background fleet.

The Server-to-Server call-wake path has now been moved off the caller's request. Call creation commits a PGMQ message in the same Postgres transaction as the call and participants. A separate Edge Function worker claims bounded batches of 250 with a 60-second visibility lease and up to 40 parallel provider sends per worker, and acknowledges completed or expired jobs while retrying transient/missing-endpoint cases. A Vault-authenticated pg_net dispatcher coalesces immediate worker kicks to at most one per 150 ms, while pg_cron provides one-minute recovery kicks after interruptions.

This is a durable pilot delivery pipeline, not yet a demonstrated high-volume service. The live worker has passed an HTTP 200 queue-dispatch test and consumed a real transaction-created Server-call job. The project currently has zero registered push endpoints, so those tests correctly report skipped/no-device delivery; no physical handset has yet been shown to ring from this worker. Provider acceptance still does not prove device display or answer. A separate synthetic drain test enqueued 1,000 nonexistent-call messages and the worker drained them in four 250-message batches (four HTTP 200 responses) before the queue returned to zero. This measures only queue/worker mechanics, not 1,000 concurrent voice calls or push-provider throughput.

The following remain target architecture work:
1. WebSocket signaling/presence with Redis or NATS fan-out; call signaling still uses Postgres polling today.
2. Postgres writes only for durable state changes and audit events; guest signaling polling must be removed.
3. A separate WebRTC/TURN media fleet with capacity and bandwidth monitoring.
4. Regional routing and graceful degradation when a push provider, signaling node, or TURN region fails.
5. A repeatable queue/worker load test with queue depth, throughput, retry, and p95/p99 delivery measurements.

Supabase Realtime is a possible interim WebSocket service, but its per-plan limits must be checked before adopting it as the 10k/100k connection layer. As documented on 29 October 2026, its listed limits are 200 concurrent connections/100 messages per second on Free, 500/500 on Pro, and 10,000/2,500 on Pro without a spend cap or Team; Enterprise is configurable. Those figures are project plan limits, not a guarantee for the current Server project. A separate signaling gateway gives Server more control over connection fan-out and scaling.

## 5. Storage and hosting decisions

GitHub is for source code, reviews, build automation, and release artifacts. GitHub Actions runners are CI machines; GitHub is not a persistent production database, WebSocket service, FCM sender, TURN relay, or always-on API host. Increasing GitHub repository/artifact storage would not increase call capacity.

A practical split is:
- GitHub: source control, CI, signing/release workflows, test evidence.
- Vercel/CDN: website/static onboarding assets.
- PostgreSQL/Supabase: durable identities and call state during the pilot.
- Separate autoscaled service: WebSocket signaling and presence.
- Redis/NATS: ephemeral presence/fan-out.
- Durable queue: push and invitation delivery.
- TURN servers: media relay.
- Object storage (only if needed): avatars, exports, or user-uploaded files—not live call signaling or call audio.

If the intent is to avoid a cloud provider entirely, the alternative is to operate owned/leased servers in reliable data centers. A single laptop, home server, GitHub repository, or free-tier service cannot provide a credible multi-million-user calling SLA. Compute, data transfer, push infrastructure, TURN bandwidth, monitoring, backups, and operational support have real costs.

## 6. Device validation strategy

Use three layers of evidence:

1. **Generic Android compatibility emulators:** API-level coverage, x86_64 emulator images, automated tests for permissions, Telecom registration, call UI, service lifecycle, and crash regression.
2. **OEM-specific visual profiles:** Samsung's official Galaxy Emulator Skin changes device appearance and controls but runs stock Android; it is not One UI firmware. Generic AVD skins cannot reproduce proprietary HiOS/One UI background-kill behavior.
3. **Physical-device acceptance:** TECNO BF7/HiOS first, then a second TECNO model, Samsung/One UI, and Pixel/stock Android. Verify app backgrounding, battery optimization, force-stop behavior, lock screen, DND, Wi-Fi/mobile-data handover, microphone route, Bluetooth, and real two-way audio.

No publicly supported TECNO/HiOS emulator image has been identified in this project. An emulator skin is not a substitute for a TECNO handset. The local ADB runner is the no-cost first physical-device route; a second endpoint is still required to prove an actual conversation.

## 7. Release gates

The service is **not production-ready** until each gate passes:

- [ ] Call start is idempotent and transactionally creates its call, participants, and guest invite.
- [ ] Presence is real, expires by lease, and distinguishes online from push-reachable.
- [ ] Push delivery is queue-backed, retried, observed, and acknowledged by the real app.
- [ ] Guest invite is delivered through an opted-in push subscription or a verified delivery channel; manual share is not counted as automatic delivery.
- [ ] Server-to-Server foreground/background calls are verified on two real devices.
- [ ] Guest browser calls are verified between two real endpoints with microphone permission and bidirectional audio.
- [ ] Non-Server offline calling has a PSTN/SIP decision and a real provider route; otherwise the product clearly offers delayed invite only.
- [ ] TURN fallback is deployed and tested on restrictive Wi-Fi/mobile networks.
- [ ] Load test stages of 100, 1,000, and 10,000 concurrent calls pass with recorded p50/p95/p99 latency, error rate, queue depth, CPU, memory, database utilization, and media relay bandwidth.
- [ ] Recovery tests cover API node loss, queue retry, app process death, network loss/reconnect, duplicate requests, and push-provider outage.
- [ ] Privacy/security review covers invitation replay, rate abuse, call authorization, secret handling, retention, and PII-safe logs.
- [ ] TECNO, Samsung, and Pixel physical-device matrices pass; release artifacts are signed and reproducible.

## 8. Changes made in this branch on 5 November 2026

- Removed the global expired-call update from every authenticated call API request.
- Removed the session heartbeat write from every incoming/poll/signaling request.
- Reused the ordered signaling response to advance the poll cursor, removing a duplicate database read per call poll.
- Added a per-caller call-start limiter (20 starts per 60-second window) and fail-closed handling if required participant rows cannot be created.
- Updated incoming-call lookup to exclude expired ringing calls even before the scheduled cleanup executes.
- Applied an indexed one-minute background expiry worker and removed global expiry sweeps/session heartbeat writes from the hot call API.
- Made Server and guest call creation atomic: the call, participant memberships, guest invite hash, and (for Server calls) queue message commit together.
- Enabled the durable PGMQ delivery queue, Vault-backed worker authentication, pg_net asynchronous dispatch, a 150 ms dispatch coalescing gate, and a one-minute pg_cron recovery kick.
- Deployed `server-call-delivery-worker` v3 and `server-calls` v44; the worker reads batches of up to 250 with a 60-second visibility lease, uses bounded parallel sends, and chains the next batch while work remains.
- Updated Android call setup to distinguish a durably queued wake job from provider acceptance and actual device delivery.

These changes establish a stronger asynchronous call-control and wake-delivery foundation. They do **not** prove 10,000 concurrent calls or production readiness. The live project still has zero registered push endpoints; the worker has not yet rung a physical handset. Guest invites still use manual sharing, guest and authenticated signaling still poll Postgres, TURN is not proven live, and there is no measured load test or real two-party audio evidence.
