# Server: production scale and capacity gates

**Status:** design record, not a capacity certification. The production backend must pass staged load tests before any claim about 100,000 concurrent calls.

## Current facts

## Capacity target: distinguish concurrency from call-start rate

Server's stated minimum scale target is **100,000 simultaneous two-party calls**, with a longer-term target of one million. The phrase "100,000 calls per minute" is a separate arrival-rate target and must be sized independently:

- **100,000 active concurrent calls** means 100,000 call sessions and approximately 200,000 connected caller/callee endpoints.
- **100,000 new calls started per minute** means about 1,667 call creations per second and 4.32 billion call starts in a 30-day month. At a three-minute mean call duration, Little's Law implies about 300,000 calls active on average (approximately 600,000 connected endpoints), before peak-hour burstiness.
- The previously stated 100 million call starts per month averages about 38.6 starts/second. It does not demonstrate the ability to absorb a 1,667 starts/second burst.
- These are capacity targets, not capabilities proven by this repository or its current hosting plan.

At an illustrative 24 kbit/s Opus bitrate per direction, 100,000 calls with every media leg relayed by TURN would carry approximately 9.6 Gbit/s of aggregate TURN ingress plus egress, before IP/UDP/TURN overhead, retransmissions, codec variation and peak headroom. With a measured 20% relay ratio the corresponding media traffic is still about 1.92 Gbit/s. At 300,000 active calls these figures triple. WebRTC media therefore needs a separately provisioned regional fleet and measured relay ratio; it must not be routed through Edge Functions, Postgres, Redis, or the WebSocket signalling gateway.

The call-start rate also has a distinct workload: durable call/participant creation, abuse controls, guest-invitation token creation, push queue writes, and potentially Open Graph preview requests. CDN/image caching and request coalescing can reduce preview load, but the secure invite must still be validated and expired/revoked safely.


- The live call path in the Android caller, Telecom connection engine, and guest browser polls the server-calls / server-guest Edge Functions approximately every 650–700 ms while a call is active.
- Both participants poll. At 700 ms, one two-party call therefore generates about 2.86 poll requests/second. At 100,000 concurrent calls this is approximately **286,000 poll requests/second**; at 10 million concurrent calls it is approximately **28.6 million/second**. These estimates exclude incoming-call discovery, presence writes, login, retries, call setup, and other application traffic.
- A target of 100 million call starts per 30-day month averages about **38.6 call starts/second** (1.2 billion/year). At a three-minute mean duration, that would imply about **6,944 average concurrent calls** before peak-hour and regional concentration. **100,000 new call starts every second** is a different workload: 8.64 billion call starts/day. It must not be confused with 100,000 concurrent calls.
- Each two-party call represents two connected endpoints: 100,000 concurrent calls require about **200,000 live endpoints**. The Android 2,200 ms incoming-discovery loop adds another potential 0.455 requests/second per installed device while its receiver service is active (about 45,455 requests/second for 100,000 such devices).
- The live Server Backend project is in eu-west-1, running Postgres 17.11. Its current max_connections setting is 60. A current snapshot showed a 17 MB database and 14 Postgres sessions, including PostgREST, pg_net, pg_cron, pooler and management connections; that is a development/test footprint, not a load test.
- The live server_push_devices table currently has zero registered devices. Background incoming-call delivery has not been demonstrated on real installed devices.
- The live guest call path recently passed its API and lifecycle integration checks, but returned STUN-only ICE configuration. TURN relay is not yet a production-verified path.

## What this means

**The current polling implementation and the current Free project are not capable of proving or delivering 100,000 simultaneous calls.** Increasing indexes or Postgres compute alone will not fix a request pattern that creates hundreds of thousands of HTTP/database polling operations each second.

Supabase's current hosted-plan limits are also below that target by default:
- Realtime concurrent connections are documented as 200 on Free, 500 on Pro, and 10,000 on Pro without a spend cap / Team, with higher custom limits available by arrangement.
- Nano (Free) Postgres documents 60 direct database connections and 200 pooler client connections. Larger compute tiers increase those ceilings, but not to an unlimited number of open database sessions.
- Supabase Realtime currently lists 200 concurrent WebSocket clients and 100 messages/second on Free, 500/500 on Pro, and 10,000/2,500 on Pro without a spend cap / Team. These are not a substitute for a measured 200,000-endpoint global signalling fleet.
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
- Supabase Realtime Broadcast may be a smaller-scale option, but Server's current 64-character opaque device tokens are not JWTs. Private Realtime channels require a valid JWT and RLS policy; mint a short-lived call-scoped authorisation token or validate the existing Server session at a dedicated WebSocket gateway. Never expose a service-role key to a client.
- The current preferred candidate for the separate signalling plane is [Centrifugo](https://github.com/centrifugal/centrifugo), with its Redis engine for horizontal node fan-out. It supports authenticated connection and per-channel subscription JWTs, and its nodes distribute publications across a Redis-backed cluster. This is a candidate architecture to integrate and benchmark, not a currently configured Server service or a 100k-capacity guarantee. Each JWT must be short-lived and scoped to a call channel after the backend verifies that the session is a member of that call. It does not replace WebRTC media or regional TURN infrastructure.
- Supabase Realtime Broadcast can be a useful early stage, but its hosted per-project quotas do not prove 100k or multi-million concurrent endpoints. At larger scale, use a separately scaled signalling service or a support-approved, measured Realtime deployment.

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

The 100,000-active-call target is the minimum large-scale gate. The separate 100,000-starts/minute workload must be tested against the same system with realistic call durations, guest preview fan-out and push load. Never count a queue-drain test as a call-capacity test.

Never run a large synthetic test against the live production project. Use a dedicated staging project and realistic generated identities/devices.

| Gate | Load | Required evidence |
|---|---:|---|
| Functional baseline | 10 concurrent calls | Setup, answer, two-way audio, hang-up, fallback, reconnect |
| Early scale | 100 concurrent calls | p50/p95/p99 setup latency, 5xx, dropped events, CPU, DB connections |
| Service scale | 1,000 concurrent calls | Same metrics plus queue lag, reconnect storms, TURN relay ratio and bandwidth |
| Pre-launch gate | 10,000 concurrent calls | Multi-region signalling, failure injection, rate-limit and recovery behaviour |
| Large-scale target | 100,000 concurrent calls | Explicit capacity plan, traffic isolation, autoscaling limits, cost model and sustained soak test |
| Higher target | 1,000,000 concurrent calls | Multi-region/sharded signalling, regional TURN and push capacity; measured sustained soak with independent generators |

For every gate, require: no lost terminal call states, no cross-user signalling, bounded resource growth, p95/p99 latency objectives, and recovery after process/network/region failure. A green source test or an emulator test cannot satisfy a load gate.

## Supabase references

- [Realtime limits](https://supabase.com/docs/guides/realtime/limits)
- [Compute and database connection limits](https://supabase.com/docs/guides/platform/compute-and-disk)
- [Edge Function limits](https://supabase.com/docs/guides/functions/limits)
- [Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Broadcast is recommended over Postgres Changes for scalable event delivery](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)
- [Centrifugo Redis engine and horizontal clustering](https://centrifugal.dev/docs/server/engines)
- [Centrifugo connection and per-channel JWT authentication](https://centrifugal.dev/docs/server/channel_token_auth)
- [Supabase production checklist and load testing](https://supabase.com/docs/guides/deployment/going-into-prod)
