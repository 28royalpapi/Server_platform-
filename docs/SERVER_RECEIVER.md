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


## Optional Android offline wake-up companion

The existing browser Receiver still handles ordinary internet push without a Server account or a full caller app. An Android recipient can additionally install the small **Server Receiver Companion** from the build artifact in the GitHub Actions workflow linked on the Receiver setup page. After installation, the same Receiver page creates a short-lived pairing code; the recipient opens it in the companion, approves Android's Call Screening role, and grants Contacts and notification permissions.

The companion downloads keyed fingerprints for Server accounts that have a verified phone number and have opted into number-based Server calls. It stores the native pairing credential encrypted with Android Keystore, caches the caller fingerprint roster locally, and refreshes it when internet is available. When the phone has no validated internet but remains on a cellular network, Android's CallScreeningService can match an incoming cellular caller ID against that roster and display a Server wake-up notification. The cellular call is not the conversation: after turning data or Wi-Fi back on, the recipient answers the pending Server WebRTC call in the browser Receiver.

**Important verification boundary:** this code implements the receiver-side pairing, local matching and notification detector. It does not yet originate the sender-side cellular wake-up call, guarantee that carriers permit a free flash-call, or prove the two-device flow on a physical Tecno handset. The caller's cellular caller ID must exactly match the verified Server number. New Server callers are only recognised after the Receiver's roster has refreshed. Android can show a heads-up notification rather than a full-screen call UI. A powered-off phone or a phone without cellular coverage cannot be woken. Ordinary cellular wake-up calls may incur caller charges; Server must not describe them as free until an operator route is proven.


## Optional Android offline wake-up companion

The browser Receiver remains the normal no-account internet-call receiver. An Android recipient can additionally install the small **Server Receiver Companion** from the build artifact in the GitHub Actions workflow linked on the Receiver setup page. After installation, the same Receiver page creates a short-lived one-use pairing code; the recipient opens it in the companion, approves Android's Call Screening role, and grants Contacts and notification permissions.

The companion downloads keyed fingerprints for Server accounts that have a verified phone number and have opted into number-based Server calls. It caches the roster locally and refreshes it when internet is available. When the phone has no validated internet but remains on a cellular network, Android's CallScreeningService can match an incoming cellular caller ID against that roster and display a Server wake-up notification. The cellular call is not the conversation: after turning data or Wi-Fi back on, the recipient answers the pending Server WebRTC call in the browser Receiver.

**Verification boundary:** this implements the receiver-side pairing, local matching and notification detector. It does not yet originate the sender-side cellular wake-up call, guarantee that a free flash-call is available from Nigerian operators, or prove the two-device flow on a physical Tecno handset. The caller's cellular caller ID must exactly match the caller's verified Server number and the caller must have opted into number-based identity. New Server callers are recognised after the Receiver's caller roster refreshes. Android may show a heads-up notification rather than a full-screen call screen. A powered-off phone or one without cellular coverage cannot be woken. Ordinary cellular wake-up calls may incur caller charges; Server must not describe them as free until an operator route is verified.
