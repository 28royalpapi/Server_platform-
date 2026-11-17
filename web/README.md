# Server web setup

The website is the customer onboarding experience and is also bundled into the single Android Server app's WebView. Server identity creation and customer calling do not depend on a mobile SIM.

## Customer operating-system boundary

A website cannot register an Android Telecom calling account by itself. The installed Server Android app supplies the OS-level `ConnectionService` connector. Customers enable Server in Android Calling accounts and use it from their normal Phone app where supported. Server calls use Wi-Fi or mobile data; the existing cellular SIM remains available for ordinary carrier calls.

Customer onboarding asks for microphone permission, notifications where supported, and optional local contacts access. It does not ask customers to select a SIM, register an SMS gateway, or grant SMS-send permission.

## Server-operated SMS channel

Invitation SMS and optional phone-verification OTP messages are sent only by Android handsets owned or controlled by Server and using a SIM/carrier plan paid for by Server. The customer and recipient do not supply the sending SIM. Server does not use TextBee's hosted API; the TextBee source was reviewed as an architectural reference only.

A Server operator provisions a managed gateway handset with a one-time code generated in Server Backend. The handset launches the internal native flow using `server://device-setup?mode=platform-gateway`. It requests SMS permission only in this internal setup flow and automatically uses Android's system-default SMS subscription. No SIM picker is shown by Server. The backend will only issue and claim SMS jobs for devices marked `is_platform_owned = true`.

If no Server-operated gateway is online, Server must not fall back to a customer's SIM. The calling app presents a shareable link or reports that automated SMS could not be queued.

## Guest browser calls

Calls to a non-Server user create a two-minute invitation. The recipient receives a branded SMS from the Server-operated gateway, taps the secure link and joins the browser call. The `/c/<token>` route serves caller-specific Open Graph metadata and a 1200×630 preview image in the initial HTML response, then opens the secure guest call page. The recipient needs a compatible browser, internet access and microphone permission.

The link is not a PSTN number. An ordinary SMS invitation cannot make an offline phone ring as a cellular voice call. Both parties need an internet path for the WebRTC conversation. Actual two-way audio must be accepted on two physical devices before a production pilot is declared complete.

## Calling-account preference

Android dialers differ. On some devices a user needs to set the outgoing-call preference to **Ask every time** to see Server alongside the existing carrier SIMs. Server does not silently hand an internet call to a cellular carrier.

## Emulator and physical acceptance

An emulator can check app installation, Telecom registration, onboarding and source-level call signalling. It cannot prove that a carrier SMS reached a real recipient. Physical acceptance requires a Server-owned gateway handset and Server-funded SMS SIM, a controlled recipient phone, and two real internet-connected endpoints for the audio conversation.
