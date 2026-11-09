# Server realtime signalling plane

Server already has Centrifugo JWT issuance and client SDK integrations for Android,
iOS and the guest browser. This stack supplies the missing self-hostable service:
Centrifugo WebSockets backed by Redis. Postgres remains the durable control plane;
Centrifugo carries low-latency call events; WebRTC carries audio.

## Local / staging startup

1. Copy `.env.example` to `.env`.
2. Generate three independent random secrets and place them in `.env`: a Redis password,
   a Centrifugo client-token HMAC secret (at least 32 random bytes), and a distinct
   Centrifugo HTTP API key. Do not reuse Supabase keys, JWTs, or each other.
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

## Optional self-hosted TURN relay

The signalling stack does not relay audio. For WebRTC calls that cannot establish a
direct peer-to-peer route, deploy Coturn on a Linux host with a public IP:

1. Add a unique `TURN_REALM`, the host's real public IPv4 as `TURN_EXTERNAL_IP`,
   and a separate random `SERVER_TURN_SHARED_SECRET` to `.env`.
2. Start the signalling stack and Coturn overlay:
   `docker compose -f docker-compose.yml -f docker-compose.turn.yml up -d`.
3. Allow inbound TCP+UDP 3478 and UDP 49160-65535 in the host firewall and cloud
   security group. Do not expose the Redis port or Centrifugo's internal 8000 port.
4. Set these Supabase Edge Function secrets on the Server Backend project:
   - `SERVER_TURN_URLS=turn:TURN_REALM:3478?transport=udp,turn:TURN_REALM:3478?transport=tcp`
     (replace `TURN_REALM` with the actual public DNS hostname; do not include the
     literal placeholder).
   - `SERVER_TURN_SHARED_SECRET` to the same secret configured for Coturn.
5. Redeploy `server-calls` and `server-guest`. Confirm their live call-start
   responses return `coturn-turn` and temporary credentials, then test from
   separate mobile networks.

This overlay provides UDP and TCP TURN on port 3478, but not TURN-over-TLS.
Networks that block both UDP and non-TLS TURN/TCP may still require a TLS-enabled
relay endpoint on an allowed port. A single host and this port range are a pilot
configuration, not a 100k-call capacity claim. TURN relays consume real bandwidth
and compute even though Coturn itself is open-source.

## Scale-out

The included compose file is a single-node staging baseline, not a 100,000-call
capacity certification. Centrifugo uses Redis as its shared engine so multiple
Centrifugo nodes can exchange publications. For production, run multiple pinned
Centrifugo replicas behind a WebSocket-capable load balancer, keep Redis private and password-authenticated,
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

## Optional self-hosted TURN relay

TURN is needed when a mobile carrier, Wi-Fi router, VPN or firewall prevents a
direct peer-to-peer ICE path. The repository includes Coturn as an optional
Docker Compose profile; it is not started by the default signalling-only stack.

1. Set `SERVER_TURN_EXTERNAL_IP` to the VM's public IPv4 address. On a cloud VM
   using 1:1 NAT, use Coturn's `PUBLIC/PRIVATE` format with both addresses.
2. Set `SERVER_TURN_SHARED_SECRET` to a separate random secret (at least 32
   bytes). Do not reuse the Redis password, Centrifugo HMAC secret or API key.
3. Open inbound UDP and TCP port 3478 and the configured UDP relay range
   49160–65535 in both the cloud firewall/security list and the host firewall.
   Keep Redis private. The initial relay range is broad to avoid a low allocation
   ceiling; it is not proof of a 100k-call relay capacity.
4. Start the TURN profile with
   `docker compose --profile turn up -d coturn`.
5. Set the following Supabase Edge Function secrets on the **Server Backend**
   project and redeploy `server-calls`:
   - `SERVER_TURN_URLS=turn:REALTIME_HOST:3478?transport=udp,turn:REALTIME_HOST:3478?transport=tcp`
   - `SERVER_TURN_SHARED_SECRET=<same as SERVER_TURN_SHARED_SECRET in the VM .env>`
6. Run a new live call contract and verify its ICE response reports
   `ice_server_mode=coturn-turn`. Then perform real two-phone calls over different
   networks and verify ICE selects a relay candidate. A returned TURN URL alone
   does not prove the relay is reachable.

Coturn uses time-limited REST credentials. The shared secret remains on the VM
and in the Supabase function environment; it is never sent to the mobile clients.
Direct peer-to-peer paths are still preferred, with TURN used only when direct
connectivity cannot be established.

The bundled profile is a single-node pilot. A large relay fleet requires multiple
Coturn hosts/regions, DNS or load-balancing policy, per-host bandwidth/port
monitoring, DDoS/rate controls and measured relay-capacity tests. TURN media
bandwidth is a real infrastructure cost; the 10 TB monthly Always Free egress
allowance offered by some VM providers cannot support unlimited relayed calls.

## Fallback behaviour

Postgres remains authoritative. Realtime is an acceleration/notification plane;
the clients reconcile durable call state when reconnecting. The existing HTTP
polling fallback is for degraded compatibility only and must not be mistaken for
the high-concurrency production path. Alert if realtime is unconfigured or
unavailable; do not silently claim that the WebSocket path is active.
