# Server realtime signalling service

This is the self-hostable, open-source realtime plane for Server. It keeps high-frequency call signalling and active-call notifications away from Supabase/Postgres:

- Supabase remains the authoritative identity, consent, call-state and durable missed-call/control plane.
- Centrifugo delivers low-latency WebSocket publications.
- Redis/Valkey shares channel publications between Centrifugo nodes.
- WebRTC carries audio directly between the two endpoints where network paths permit; TURN is a separate relay fallback.

## Important capacity boundary

This compose file is a **deployable pilot foundation**, not proof of 100,000 concurrent calls. The software is open source; the compute, public bandwidth, Redis memory, TLS termination, monitoring, and any TURN relay traffic still need hosting capacity. A single small free VM cannot be represented as a tested 200,000-socket / 100,000-call production cluster.

Before production, deploy multiple Centrifugo nodes behind a WebSocket-capable load balancer, use Redis/Valkey sized and monitored for fanout, add regional TURN capacity, and test progressively at 1k, 10k and 100k concurrent calls. One call means two connected clients. Test active connections, connection churn, messages/sec, reconnect storms, queue delay, Redis CPU/memory, node CPU/FDs, network egress and TURN relay throughput. Do not load-test the live Supabase project.

## 1. Host prerequisites

Use a Linux VM or server with Docker Engine + Docker Compose v2, a public DNS name such as `realtime.example.com`, and inbound TCP 80/443. Point the DNS record at this host. This compose stack intentionally does not publish Redis or Centrifugo's port 8000 directly.

For the 100k target, provision multiple machines/regions rather than relying on the pilot VM. Keep Redis private and use authentication/TLS if Redis is moved off-host.

## 2. Configure secrets

Create `.env` beside this file (do not commit it):

```dotenv
REALTIME_DOMAIN=realtime.example.com
ACME_EMAIL=ops@example.com
CENTRIFUGO_TOKEN_HMAC_SECRET_KEY=replace-with-at-least-32-random-bytes
CENTRIFUGO_API_KEY=replace-with-a-different-32-plus-random-secret
CENTRIFUGO_ALLOWED_ORIGINS=https://server-onboarding-ochre.vercel.app
```

Generate independent secrets with a cryptographically secure generator, for example `openssl rand -hex 32`. The token HMAC secret must match the Supabase Edge Function secret. The API key must match the Supabase Edge Function secret. Never place either value in website JavaScript, Android resources, iOS Info.plist, APKs, or Git.

Add the guest origin only if it differs from the onboarding origin. Use exact HTTPS origins, without URL paths.

## 3. Start the realtime service

```sh
docker compose up -d
docker compose ps
docker compose logs --tail=100 centrifugo
```

Caddy obtains and renews TLS certificates automatically once DNS and ports are correct. Public client URL:

```
wss://realtime.example.com/connection/websocket
```

Private backend API base URL:

```
https://realtime.example.com/api
```

Centrifugo HTTP API requests use `POST /api/publish` with the API key in `X-API-Key`. The API key is only set in the backend. The API path remains authenticated by Centrifugo; do not remove that authentication.

## 4. Configure the Server Supabase Edge Functions

Set these secrets in the **Server Backend** Supabase project only:

- `CENTRIFUGO_PUBLIC_URL=wss://realtime.example.com/connection/websocket`
- `CENTRIFUGO_API_URL=https://realtime.example.com/api`
- `CENTRIFUGO_API_KEY` — same value as `CENTRIFUGO_API_KEY` in this host's `.env`
- `CENTRIFUGO_TOKEN_HMAC_SECRET_KEY` — same value as `CENTRIFUGO_TOKEN_HMAC_SECRET_KEY` in this host's `.env`

Redeploy `server-calls` and `server-guest` Edge Functions after setting secrets. They return short-lived, server-authorized connection tokens. Tokens subscribe only to the caller's user channel and/or an authorized call channel. Guest tokens are limited to the one joined invitation's call channel. Clients cannot publish directly; all call signalling is validated and durably saved in Supabase before the backend broadcasts it.

If these secrets are absent, the API explicitly returns `realtime_available=false`; current polling remains as compatibility fallback. The mere presence of this compose file does not turn on realtime in production.

## 5. Channel and delivery model

- `$server-user:<user UUID>`: incoming Server-call notification for that user.
- `$server-call:<call UUID>`: call-state and signalling events for authorized call members.
- Guest WebSocket subject: `guest:<invite UUID>`; only created after that one-time invite is joined.

The Centrifugo connection JWT `channels` claim is used for automatic server-side subscriptions. It is not treated as a list of arbitrary client permissions. The API key and HMAC secret remain server-side. Postgres call records/signals remain authoritative; after reconnect the client reconciles by the persisted sequence cursor, so transient WebSocket loss does not erase call history.

## 6. Health and acceptance checklist

1. Verify `GET /` or the Centrifugo configured health endpoint through the host's private monitoring path; do not expose administrative endpoints publicly.
2. Obtain a realtime token from the authenticated Server API and connect with the official Centrifugo SDK.
3. Confirm the user channel receives a caller-created incoming event.
4. Confirm both devices receive call-channel publications after server-validated offer/answer/ICE writes.
5. Disconnect a client, create additional signals, reconnect and prove DB sequence reconciliation recovers them.
6. Verify an unrelated Server identity cannot receive or subscribe to the private call channel.
7. Repeat through the load balancer across all Centrifugo nodes.
8. Capacity test in a separate staging environment before setting any 100k claim.

## 7. Current implementation status

The backend now issues short-lived scoped realtime tokens and publishes user/call events only after durable call writes. The guest browser, Android Telecom call engine, Android incoming-call foreground service, and iOS CallKit client now have Centrifugo SDK paths. Each client reconciles its durable sequence/incoming-call state after connection and retains an HTTP recovery path when realtime is absent or disconnected.

**Deployment is still a separate gate.** The Centrifugo/Redis/Caddy stack in this directory is self-hostable but has not been provisioned for the live Server project in this branch. The `CENTRIFUGO_*` Supabase Edge Function secrets are not assumed to exist. When they are absent, the backend explicitly returns `realtime_available=false` and clients use their REST compatibility paths. No 100,000-call capacity or bandwidth test has been completed.

Android/iOS FCM/APNs credentials and physical background-push acceptance also remain separate gates. A live WebSocket is appropriate for a foreground or process-running call, but it cannot wake a process that the operating system has suspended or terminated. Configure and test FCM on Android and PushKit/APNs on iOS before claiming reliable background incoming-call delivery. Then complete authenticated channel isolation tests, reconnect tests, two-phone audio tests, and staged concurrency tests before a production launch.
