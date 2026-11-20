# Server Receiver

Server Receiver lets a non-member enrol one phone once to receive incoming Server internet calls without creating a Server caller account or installing the caller APK.

## Flow
1. A signed-in Server caller enters the recipient phone number in the existing Android caller screen and chooses **Connect this phone as a Server Receiver**.
2. Server creates a random one-use invitation. Only its SHA-256 hash is stored. It expires after seven days and is shared through the Android Sharesheet; Server does not send SMS.
3. The recipient opens the link. The number is already bound to the invitation; the page displays only its final four digits. No number form, OTP, password or Server account is required.
4. They tap **Enable call alerts** and grant browser notification permission. The page creates a Web Push subscription and random per-device management secret.
5. The backend atomically claims the invitation and stores the number, push endpoint, encryption keys, expiry, invite ID and hashed management secret in the existing \`server_guest_push_devices\` table.
6. Future calls reuse the existing \`server-calls\` delivery path, which looks up push receivers by number and sends Web Push using the existing VAPID sender. Tapping the alert opens the existing one-use \`guest.html\` WebRTC call page.

## Backend data
- \`server_receiver_invites\`: hashed setup link, issuing Server user, destination number, display label, expiry, claim state and endpoint hash.
- \`server_guest_push_devices\`: existing shared push registry, extended with \`receiver_invite_id\` and \`receiver_secret_hash\`. Existing guest-browser rows and delivery logic are preserved.
- \`server_guest_push_config\`: existing VAPID keypair. No new push provider is introduced.

The receiver API never returns the full destination number. It requires explicit consent, validates push endpoint hosts, and stores only hashes of invitation and device-management secrets. The registered device can revoke its receiver.

## Device support and limits
Android Chrome and supported Android browsers: open the link, tap **Enable call alerts**, and accept the browser notification prompt. No APK, account, SIM selection, number typing, OTP or SMS is required.
iPhone: supported Web Push requires adding the site to the Home Screen and opening it as a web app. The page explains this restriction rather than claiming ordinary Safari tabs can be woken in the background.
The invitation binds the number selected by the caller to the recipient's push subscription; it does not verify SIM ownership or read a SIM number. Push cannot ring a powered-off phone or a phone with no internet. Expired calls are not replayed as live calls after reconnection.

Run \`npm run check\` and \`npm run check:web\` for static contract and JavaScript syntax checks.
