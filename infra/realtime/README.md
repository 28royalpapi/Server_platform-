# Server realtime signalling plane

Server already has Centrifugo JWT issuance and client SDK integrations for Android,
iOS and the guest browser. This stack supplies the missing self-hostable service:
Centrifugo WebSockets backed by Redis. Postgres remains the durable control plane;
Centrifugo carries low-latency call events; WebRTC carries audio.

## Local / staging startup

1. Copy `.env.example` to `.env`.
2. Generate two independent random secrets (at least 32 bytes each) and place them
   in `.env`. Do not reuse Supabase keys, JWTs, or each other.
3. Run `docker compose up -d` from this directory.
4. Put a TLS WebSocket reverse proxy/load balancer in front of the Centrifugo
   service. Public clients connect to
   `wss://REALTIME_HOST/connection/websocket`. Do not expose Redis.
5. Set these Supabase Edge Function secrets to the matching values:
   - `CENTRIFUGO_PUBLIC_URL=wss://REALTIME_HOST/connection/websocket`
   - `CENTRIFUGO_TOKEN_HMAC_SECRET_KEY=<same as CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY>`
   - `CENTRIFUGO_API_URL=https://REALTIME_HOST/api`
   - `CENTRIFUGO_API_KEY=<same as CENTRIFUGO_HTTP_API_KEY>`
6. Redeploy `server-calls` and `server-guest`, then verify authenticated
   `realtime_token` responses report `realtime_available: true` and that clients
   receive publications. Keep the HTTP API key server-side only.

The Centrifugo API endpoint is protected by its API key. If a reverse proxy exposes
the same hostname for WebSockets and API publishing, retain TLS and API-key
authentication; never put the API key in client configuration. Prefer a private
backend-to-Centrifugo network where the hosting topology permits it.

## Scale-out

The included compose file is a single-node staging baseline, not a 100,000-call
capacity certification. Centrifugo uses Redis as its shared engine so multiple
Centrifugo nodes can exchange publications. For production, run multiple pinned
Centrifugo replicas behind a WebSocket-capable load balancer, keep Redis private,
monitor Redis CPU/memory/latency and Centrifugo connection/event metrics, and
increase Redis capacity or shard only from measured bottlenecks. Configure OS
file-descriptor limits and connection/time-out limits on every proxy and node.

Do not use this one-host compose deployment as evidence that 100,000 concurrent
calls are supported. Capacity depends on the actual host count, CPU, RAM, network,
Redis throughput, load-balancer limits, event fanout, and WebRTC/TURN bandwidth.
A 100,000-call target means up to 200,000 endpoints. Run staged load tests against
a production-like staging deployment (1k, 5k, 10k, then higher) and verify
connection churn, reconnect storms, fanout latency, Redis saturation, and failure
recovery before setting a public capacity claim.

## Cost and availability

Centrifugo and Redis are open-source and self-hostable; the software license does
not make compute, bandwidth, storage, TLS termination, backups, or TURN relaying
free. A free-tier VM may be useful for a development pilot but is not a dependable
100k-concurrency production commitment. Keep Supabase/Postgres out of the audio
media path and never create one database connection per call.

## Fallback behaviour

Postgres remains authoritative. Realtime is an acceleration/notification plane;
the clients reconcile durable call state when reconnecting. The existing HTTP
polling fallback is for degraded compatibility only and must not be mistaken for
the high-concurrency production path. Alert if realtime is unconfigured or
unavailable; do not silently claim that the WebSocket path is active.
