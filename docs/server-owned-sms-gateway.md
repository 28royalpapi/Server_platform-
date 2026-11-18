# Server-owned SMS gateway — OTP/operator workflows only operations

## Purpose and billing boundary

Guest-call invitations must not be transmitted as carrier SMS. They use free Web Push for opted-in browser receivers and a shareable secure link for first contact. This Android SMS gateway is a separate carrier-SMS transport for OTP or operator-controlled workflows only. It uses SmsManager and a mobile subscription; every SMS may consume the Server-funded carrier bundle or incur a network charge. A customer phone is never selected or used as a sender.

The same Server Android APK contains this internal gateway capability. Customer onboarding does not display a SIM picker, request SMS-send permission, or start the gateway service. The internal setup flow uses Android's **system default SMS subscription** automatically.

Server does not call the hosted TextBee API. The uploaded TextBee source was studied for device registration, heartbeats, queue wake-up, retry and delivery-status patterns; no TextBee application or hosted API dependency is included in this path.

## Provision a managed handset

1. Use a physical Android handset and SIM that Server owns or controls and pays for. Do not use a customer's personal phone or SIM.
2. Insert the Server-funded SIM. In Android Settings, set the desired subscription as the system **default SMS SIM**. On a single-SIM phone Android can resolve it automatically; on a dual-SIM phone set the default once in the operating system. Server does not ask the operator to choose a SIM in its own UI.
3. Apply the database migration `20261117100000_server_platform_owned_sms_gateways.sql` before deploying the matching `server-gateway`, `server-calls`, and `server-auth` functions.
4. In the **Server Backend** Supabase SQL editor, generate a one-time pairing code:

   ```sql
   select * from public.server_create_platform_sms_gateway_pairing();
   ```

   The result contains a 32-character hexadecimal `pairing_code` and an expiry timestamp 15 minutes in the future. The database stores only the SHA-256 hash. Copy the code directly to the managed handset operator; do not log it or store it in a shared document.
5. Install the one Server Android APK on the managed handset. Launch the internal setup deep link:

   ```text
   server://device-setup?mode=platform-gateway
   ```

   Enter the one-time code in the native Server setup dialog. Android will ask for phone-state, SMS-send and notification permissions on this managed handset. The app automatically resolves the system default SMS subscription and claims the pairing. No SIM picker appears.
6. Keep the handset powered, connected to mobile service and the internet, and allow Server's foreground service to run. Review Android battery/background restrictions and notification settings. The gateway cannot send SMS while the device is offline, force-stopped or missing required permissions.

A pairing code can be claimed once and expires after 15 minutes. Claiming creates a device with `owner_user_id = NULL` and `is_platform_owned = TRUE`, and returns a device token that the Android app stores in its secure store.

## Verify platform ownership and heartbeat

Run in Server Backend SQL:

```sql
select id, label, enabled, is_platform_owned, sim_slot_index, carrier_label, last_seen_at
from public.server_gateway_devices
where is_platform_owned = true
order by last_seen_at desc nulls last;
```

A device is considered online for invitation routing only when its heartbeat is fresh. The SMS claim function rejects every device that is not explicitly platform-owned. Existing user-registered gateway devices stay `is_platform_owned = false` and cannot claim invitation or OTP jobs.

## Message and queue behaviour

- Each distinct unanswered guest call creates a unique invitation job. Calling the same recipient again creates a new job; there is no per-caller hourly or daily invitation allowance in the application.
- The worker claims batches of 50 and immediately asks for the next batch when it has drained a full batch. The batch is a database/network processing size, not a user quota.
- The SMS body is branded and puts the URL last so compatible messaging clients can inspect its preview metadata.
- The `/c/<token>` URL is rewritten to `server-guest-preview`. That endpoint returns Open Graph metadata and a caller-specific 1200×630 image in the initial HTML response before the secure guest-call page opens.
- Guest links and unanswered call records expire after two minutes. Expired, revoked or already-answered invitations are rejected by the queue claim function rather than sent late.
- If no fresh Server-owned gateway is available, Server must not fall back to the caller's personal SIM. It reports that the SMS could not be queued and uses browser push or the manual share link where available.

## Important operational limits

The Server application does not impose a daily or hourly message quota on normal call invitations, but an Android SIM and carrier network are not an infinite-throughput SMS switch. Carrier bundle allowances, per-SIM throughput, international termination, anti-spam systems and local law still apply. Server must fund and manage those carrier costs; there is no software mechanism that bypasses carrier billing.

A recipient normally does not pay for receiving an SMS, but incoming-message and roaming terms differ by carrier and country. Server can guarantee that the caller's own SIM is not used as the sender; it cannot guarantee every foreign carrier's inbound billing policy without checking that market.

## Acceptance test before enabling production routing

- [ ] Device record shows `is_platform_owned = true` and `owner_user_id IS NULL`.
- [ ] Fresh heartbeat is present.
- [ ] A controlled recipient receives the intended OTP/operator SMS. This checklist does not apply to free guest-call invitations, which must never use this SIM transport.
- [ ] The caller's personal SIM balance and SMS history do not change.
- [ ] A second call to the same recipient creates a new invitation job and is sent again.
- [ ] A burst of more than 50 queued jobs drains across consecutive batches without a user/hour/day limit.
- [ ] Failed/expired/answered jobs are not sent late.
- [ ] The two-minute unanswered call closes automatically; answering before the timeout stops ringback and the timer.
