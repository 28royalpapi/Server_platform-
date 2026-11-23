# Server Receiver — Android offline-wake proof

This is a separate, lightweight Android companion for a non-member who has already received a one-time Server Receiver link. It does not create a Server caller account, read SIM numbers, send SMS, or replace the default dialer.

## What this proof implements

1. The Receiver web link opens the companion using `serverreceiver://enrol?token=...`.
2. The companion validates the existing one-time invitation with the Server backend.
3. It receives only the inviter's verified mobile number and caller display name, then stores that one accepted Server caller locally using an Android Keystore-backed AES-GCM key.
4. The recipient explicitly grants Android's Call Screening role, Contacts access (needed for Android to pass calls from saved contacts to this service), and notification permission.
5. When the saved Server caller's number arrives as a cellular call, the service displays a Server wake notification and rejects the cellular call before it is answered. The subsequent conversation is still intended to use the existing WebRTC Receiver.

## Important limits — not production certified

- A normal browser page cannot install a CallScreeningService. The recipient must install this companion and explicitly grant the Android role. The existing browser-only Receiver remains unchanged.
- This first proof registers the inviter associated with the one-time link. It does not yet synchronise every Server contact into the offline directory.
- An unanswered cellular call normally has no connected-call duration, but **zero charge has not been verified across MTN, Glo, Airtel and 9mobile**. The sender's carrier may apply call-setup, special-service or other charges. Physical SIM/account tests are required before enabling automatic wake calls.
- A recipient who disables the call-screening role or uninstalls the companion will not reject the wake call. The caller side must only send wake calls to devices that are registered and the recipient must understand that the Server number is reserved as a wake signal while this feature is enabled.
- This proof displays the wake screen and opens the existing Receiver page after reconnection. It does not yet implement a durable guest-call resume endpoint. Existing Web Push/guest-call delivery remains the actual answer path.

## Build

```bash
gradle -p apps/android-receiver testDebugUnitTest assembleDebug --no-daemon --console=plain
```

The build workflow uploads an APK artifact for device tests. Do not distribute it as a production app until carrier costs, Android manufacturer behavior, Play policy and complete call resumption are validated.
