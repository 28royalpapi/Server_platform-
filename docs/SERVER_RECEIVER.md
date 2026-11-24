# Server Receiver

Server Receiver lets a non-member enrol one phone once to receive incoming Server internet calls without creating a Server caller account or installing the caller APK.

## Flow
1. After creating a Server identity, the caller opens **Connect people to Server** directly inside the same onboarding screen and chooses contacts from the phone address book.
2. Contact names and numbers remain on the phone until the caller explicitly invites a person. Server receives only the selected E.164 phone numbers, then creates one random, private, one-use link per person. Only each SHA-256 hash is stored. Pending links do not expire; they remain valid until claimed or revoked.
3. The caller shares each person's unique link privately with that person. The recipient opens it. The number is already bound to the invitation; the page displays only its final four digits. No number form, OTP, password or Server account is required.
4. They tap **Enable call alerts** and grant browser notification permission. The page creates a Web Push subscription and random per-device management secret.
5. The backend atomically claims the invitation and stores the number, push endpoint, encryption keys, expiry, invite ID and hashed management secret in the existing \`server_guest_push_devices\` table.
6. Future calls reuse the existing \`server-calls\` delivery path, which looks up push receivers by number and sends Web Push using the existing VAPID sender. Tapping the alert opens the existing one-use \`guest.html\` WebRTC call page.

## Backend data
- \`server_receiver_invites\`: hashed setup link, issuing Server user, destination number, display label, expiry, claim state and endpoint hash.
- \`server_guest_push_devices\`: existing shared push registry, extended with \`receiver_invite_id\` and \`receiver_secret_hash\`. Existing guest-browser rows and delivery logic are preserved.
- \`server_guest_push_config\`: existing VAPID keypair. No new push provider is introduced.

The receiver API never returns the full destination number in its public setup flow. It requires explicit recipient consent, validates push endpoint hosts, and stores only hashes of invitation and device-management secrets. Pending invitation links have no time expiry, are single-use, and can be revoked by the caller. The registered device can revoke its receiver. The onboarding's **My invited contacts** list reads the same backend records and reports Connected, Awaiting connection, or Disconnected status. Contact names are matched locally and are not uploaded.

## Device support and limits
Android Chrome and supported Android browsers: open the link, tap **Enable call alerts**, and accept the browser notification prompt. No APK, account, SIM selection, number typing, OTP or SMS is required.
iPhone: supported Web Push requires adding the site to the Home Screen and opening it as a web app. The page explains this restriction rather than claiming ordinary Safari tabs can be woken in the background.
The invitation binds the number selected by the caller to the recipient's push subscription; it does not verify SIM ownership or read a SIM number. Push cannot ring a powered-off phone or a phone with no internet. The invitation link itself does not expire, but a browser push subscription can later be revoked or become unusable by the browser; the caller's persistent status list will then show that attention is needed. Expired calls are not replayed as live calls after reconnection.

Run \`npm run check\` and \`npm run check:web\` for static contract and JavaScript syntax checks.


## Android offline wake-up companion

The normal browser Receiver still handles internet call alerts without a Server caller account. For a phone that must be alerted while both mobile data and Wi-Fi are off, the recipient must explicitly install the small **Server Receiver Companion** from the Android build artifact linked on the Receiver setup page. The same one-time Receiver link pairs the installed companion to the browser Receiver. Android then asks the recipient to approve the Call Screening role and Contacts/notification permissions; the app cannot grant these OS permissions silently.

The companion downloads keyed fingerprints for all Server profiles that have a verified phone number and have opted into number-based Server calls. It caches the roster locally and refreshes it when internet is available. It does not depend on the original inviter: any eligible Server caller whose verified number is in the roster can be recognised.

### Offline call flow

1. The Server caller starts the normal guest WebRTC call. Web Push remains the first alert route.
2. If the guest browser has no recent internet heartbeat, the caller's app checks whether the recipient has a paired, ready Android companion and whether the caller explicitly enabled cellular wake-up.
3. The caller app uses Android Telecom to place one brief call from the caller's default **SIM**. It proceeds only if the selected account is a real SIM account and its exposed number exactly matches the caller's verified Server number. Otherwise it fails closed and preserves the ordinary invitation-sharing fallback.
4. The recipient's CallScreeningService matches the incoming caller number against its cached roster. It shows the Server wake-up notification and rejects the cellular leg. The cellular call is not the conversation.
5. After the recipient restores mobile data or Wi-Fi and opens the Companion notification, the app asks Server for the still-live pending call, obtains a fresh one-use guest invitation for that same call, and opens the existing browser WebRTC page. The call is not recreated; the original caller's pending offer is answered through WebRTC.

The guest call has a finite live-call expiry. Reconnecting after it expires does not create a late ring; the caller must place another call.

### Verification boundaries and costs

- The caller must explicitly enable the feature and grant Android `CALL_PHONE`, `READ_PHONE_STATE` and `READ_PHONE_NUMBERS` permissions. The selected SIM number must match the verified Server caller number.
- The recipient must explicitly install the Companion, select it as Android's Call Screening app, and grant the permissions needed to receive calls from numbers already saved in Contacts and display notifications.
- Android may show a heads-up notification; a full-screen call screen is not guaranteed. The CallScreeningService must respond within Android's five-second window.
- **A Telecom handoff is not proof that the carrier delivered the call or that the notification appeared.** Ordinary cellular wake-up attempts may incur caller charges. Server must not advertise the wake-up as free unless a carrier-provided free alert service is separately proven.
- The recipient phone must be powered on and registered on a cellular network. A powered-off phone, a handset without cellular coverage, hidden caller ID, a SIM whose displayed number differs from the verified Server number, or a caller not yet present in the cached roster cannot be woken by this method.
- New Server caller identities are recognised after the Receiver refreshes its roster while online. Only verified callers who opted into number-based caller identification are included.
- The Android companion build and source contracts are CI-checkable. A real end-to-end acceptance still requires two physical phones and a real cellular carrier: disable B's mobile data and Wi-Fi, call from A, verify B's Server notification, repeat from a different enrolled Server caller C, restore B's data, answer the pending browser call, and verify two-way WebRTC audio.

Run `npm run check` and `npm run check:web` for backend/source contract and browser syntax checks. The Android CI workflow compiles and signature-verifies the caller and Receiver companion APKs; passing compilation does not replace the physical two-phone carrier test.
