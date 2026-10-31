# Server web setup

The website is the onboarding experience and is also bundled into the Android integration component's WebView. Launching the installed component opens the same website onboarding; it must not launch the separate native number-entry screen as the default user experience.

## Operating-system boundary

A normal website or PWA cannot enumerate mobile subscriptions or register itself as a phone-dialer calling account. Android requires installed native code to register TelecomManager/ConnectionService. Server's connector does not use SubscriptionManager or request READ_PHONE_NUMBERS. On iOS, SIM-slot details are not exposed to websites; system calling integration requires an installed native application with the applicable Apple calling-app entitlement and CallKit/LiveCommunicationKit. The website is the UX, but a native integration component is technically required for the OS-controlled portion of this journey.

Server does not ask the user to select a SIM, enumerate SIM slots or read SIM phone numbers. The native connector requests microphone permission, Android READ_PHONE_STATE for Telecom account registration, and notifications where supported. That permission is not used to read the user's phone number. Server is a separate internet-calling identity and can be exposed as an Android calling account where the phone's dialer supports third-party providers.

## Registration and calls

Android device onboarding creates a random installation-bound Server identity and session through `server-auth?action=register_device`. This path does not send SMS OTPs; the device secret is stored locally and only its SHA-256 hash is stored by the backend.

Server-to-Server calls can be addressed by a Server ID such as `SVR-0123456789`. Calls to non-Server phone numbers currently require a guest invitation route; SMS delivery of an invitation requires a paired Android SMS gateway (or a separately configured SMS provider), and the recipient needs internet access and microphone permission to use the guest browser call. Optional phone-number linking also uses the SMS gateway. WebRTC cannot reach an offline recipient through the cellular voice network by itself. Android incoming calls are currently discovered by a foreground listener after the user enables Server in Calling accounts; it polls the backend and hands active calls to Telecom. iOS PushKit/APNs incoming-call delivery is not yet configured.

## Emulator limits

The Android Emulator can exercise website onboarding, Android permissions, PhoneAccount registration and Calling accounts. Because Server no longer reads or selects a SIM, a physical SIM is not required for identity setup. Use two physical Android devices on different networks to validate actual incoming/outgoing audio, background/locked behavior and real network compatibility.
