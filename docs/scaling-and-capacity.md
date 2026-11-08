# Server: production scale and capacity gates

**Status:** design record, not a capacity certification. The production backend must pass staged load tests before any claim about 100,000 concurrent calls.

## Current facts

- The live call path in the Android caller, Telecom connection engine, and guest browser polls the server-calls / server-guest Edge Functions approximately every 650–700 ms while a call is active.
- Both participants poll. At 700 ms, one two-party call therefore generates about 2.86 poll requests/second. At 100,000 concurrent calls this is approximately **286,000 poll requests/second**; at 10 million concurrent calls it is approximately **28.6 million/second**. These estimates exclude incoming-call discovery, presence writes, login, retries, call setup, and other application traffic.
- Each two-party call represents two connected endpoints: 100,000 concurrent calls require about **200,000 live endpoints**, and 10 million concurrent calls require about **20 million**. The 2,200 ms Android incoming-discovery loop adds another potential 0.455 requests/second per installed device while its receiver service is active (about 45,455 requests/second for 100,000 such devices).
- Supabase Realtime's default 10,000-connection ceiling on Pro without a spend cap / Team is only 5% of the 200,000 endpoints required for 100,000 concurrent calls. Enterprise custom limits may be negotiated, but those limits must be confirmed and load-tested before committing to that design.
- The live Server Backend project is in eu-west-1, running Postgres 17.11. Its current max_connections setting is 60. A current snapshot showed a 17 MB database and 13 Postgres sessions; that is a development/test footprint, not a load test.
- The live server_push_devices table currently has zero registered devices. Background incoming-call delivery has not been demonstrated on real installed devices.
- The live guest call path recently passed its API and lifecycle integration checks, but returned STUN-only ICE configuration. TURN relay is not yet a production-verified path.

## What this means

**The current polling implementation and the current Free project are not capable of proving or delivering 100,000 simultaneous calls.** Increasing indexes or Postgres compute alone will not fix a request pattern that creates hundreds of thousands of HTTP/database polling operations each second.

Supabase's current hosted-plan limits are also below that target by default:
- Realtime concurrent connections are documented as 200 on Free, 500 on Pro, and 10,000 on Pro without a spend cap / Team, with higher custom limits available by arrangement.
- Nano (Free) Postgres documents 60 direct database connections and 200 pooler client connections. Larger compute tiers increase those ceilings, but not to an unlimited number of open database sessions.
- Edge Function invocation allowances are finite monthly quotas (currently documented as 500,000 on Free and 2 million on Pro before overage).
- Free projects can be paused after a week of insufficient user database activity. A heartbeat is an inactivity safeguard, not an uptime SLA.

## Required architecture

### 1. Separate the planes

**Control plane — Supabase/Postgres**
- Account identity, verified phone numbers and explicit call/airtime consent.
- Device registrations, durable call records, call-state transitions, abuse controls, audit events, and billing/usage metadata.
- Idempotent call creation and state transitions remain transactional in Postgres.
- Do not use the database as a 700 ms polling loop.

**Signalling plane — persistent, horizontally scaled WebSocket service**
- Android and browser clients keep one authenticated signalling connection while foreground/reachable.
- Offer, answer, ICE, hang-up and call-state events travel through the signalling service, not repeated PostgREST/Edge Function reads.
- Route each call to a shard/region with reconnect tokens, sequence numbers, bounded buffers, heartbeats and back-pressure.
- Supabase Realtime Broadcast is a plausible first implementation, and Broadcast is recommended over Postgres Changes for scalable delivery. However, Server's current 64-character opaque device tokens are not JWTs: private Realtime channels require a valid JWT and RLS policy. We must mint a short-lived call-scoped Realtime authorisation token (or use a separately operated WebSocket gateway that validates Server's existing token) before clients can subscribe. Never put a service-role key in the app.
- Supabase Realtime's default 10,000-connection ceiling on Pro without a spend cap / Team is only 5% of the 200,000 endpoints required for 100,000 concurrent calls. Enterprise custom limits may be negotiated, but those limits and per-second message quotas must be confirmed and load-tested before committing to that design. At larger scale, use a separately scaled signalling service or a support-approved, measured Realtime deployment.

**Media plane — WebRTC**
- Audio normally flows peer-to-peer when NAT conditions permit.
- TURN relays media when direct paths fail. TURN capacity is a bandwidth/packet-processing problem and must be provisioned across regions with measured relay ratios.
- Supabase should not carry the audio stream.

**Wake-up plane — FCM/APNs**
- Push wakes an installed background receiver where platform and device policies permit.
- Push is a wake-up hint, not the signalling channel and not proof that a device rang.
- A first-time guest browser still needs to open the invitation and grant microphone permission; a link preview cannot wake a phone.

### 2. Replace hot polling before scaling

1. Instrument request counts and call-state latency by action and client version.
2. Introduce authenticated per-call signalling topics with strict caller/callee authorization.
3. Deliver events over WebSockets/Broadcast with Postgres retained as the durable source of truth.
4. Use bounded retry/backoff and switch to low-frequency recovery polling only when a socket is disconnected.
5. Keep incoming discovery separate: FCM/APNs for registered devices, with a deliberately rate-limited fallback while foregrounded.
6. Add short retention/partitioning for transient ICE/signalling events; keep durable call history independently.

### 3. Global Android requirements

- Normalize and validate E.164 destinations using international metadata; never assume Nigeria's calling code or network operator.
- Treat the selected SIM as the caller's carrier route. Carrier fallback places an ordinary carrier call from that caller's selected subscription to the recipient's number; it cannot remotely use the recipient's SIM.
- Resolve the recipient's saved contact name locally through Android Contacts/Telecom. Server-side web previews cannot read the recipient's private contacts.
- Test the same release APK on real devices from multiple OEMs, OS releases, dual-SIM configurations and mobile operators. Android emulators are necessary compatibility tests, not substitutes for physical-device acceptance.
- iOS requires a separate CallKit/PushKit implementation and its own device matrix.

## Capacity gates (staging only)

Never run a large synthetic test against the live production project. Use a dedicated staging project and realistic generated identities/devices.

| Gate | Load | Required evidence |
|---|---:|---|
| Functional baseline | 10 concurrent calls | Setup, answer, two-way audio, hang-up, fallback, reconnect |
| Early scale | 100 concurrent calls | p50/p95/p99 setup latency, 5xx, dropped events, CPU, DB connections |
| Service scale | 1,000 concurrent calls | Same metrics plus queue lag, reconnect storms, TURN relay ratio and bandwidth |
| Pre-launch gate | 10,000 concurrent calls | Multi-region signalling, failure injection, rate-limit and recovery behaviour |
| Large-scale target | 100,000 concurrent calls | Explicit capacity plan, traffic isolation, autoscaling limits, cost model and sustained soak test |
| Long-range target | Millions of concurrent calls | Multi-region/sharded signalling and TURN capacity; load test with independent generators, not one Supabase project on its default hosted quotas |

For every gate, require: no lost terminal call states, no cross-user signalling, bounded resource growth, p95/p99 latency objectives, and recovery after process/network/region failure. A green source test or an emulator test cannot satisfy a load gate.

## Supabase references

- [Realtime limits](https://supabase.com/docs/guides/realtime/limits)
- [Compute and database connection limits](https://supabase.com/docs/guides/platform/compute-and-disk)
- [Edge Function limits](https://supabase.com/docs/guides/functions/limits)
- [Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Broadcast is recommended over Postgres Changes for scalable event delivery](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)
- [Supabase production checklist and load testing](https://supabase.com/docs/guides/deployment/going-into-prod)
