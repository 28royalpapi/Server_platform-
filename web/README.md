# Server web setup

The website is the onboarding experience and is also bundled into the Android integration component's WebView. Launching the installed component opens the same website onboarding; it must not launch the separate native number-entry screen as the default user experience.

## Operating-system boundary

A normal website or PWA cannot enumerate mobile subscriptions or register itself as a phone-dialer calling account. Android requires installed native code to call SubscriptionManager and TelecomManager/ConnectionService. On iOS, SIM-slot details are not exposed to websites; system calling integration requires an installed native application with the applicable Apple calling-app entitlement and CallKit/LiveCommunicationKit. The website is the UX, but a native integration component is technically required for the OS-controlled portion of this journey.

Selecting a SIM does not clone its cryptographic credentials, transfer its carrier subscription, or create a new cellular line. Server is a separate internet-calling identity and can be exposed as an Android internet-calling account where the phone's dialer supports third-party calling accounts. The carrier phone number may be hidden by Android or the carrier and is never treated as proof of ownership.

## Registration and calls

Android device onboarding creates a random installation-bound Server identity and session through `server-auth?action=register_device`. This path does not send SMS OTPs; the device secret is stored locally and only its SHA-256 hash is stored by the backend.

Server-to-Server calls can be addressed by a Server ID such as `SVR-0123456789`. Calls to non-Server phone numbers currently require a guest invitation route; SMS delivery requires a paired Android SIM gateway (or a separately configured SMS provider), and the recipient needs internet access and microphone permission to use the guest browser call. WebRTC cannot reach an offline recipient through the cellular voice network by itself.

## Emulator limits

The Android Emulator console can simulate GSM network status and call events, but those controls do not create arbitrary real Android SubscriptionInfo records or a carrier-provisioned SIM profile. An emulator may have a virtual radio configuration, but it is not equivalent to a physical SIM or an eSIM profile issued by an operator. Use emulator UI tests to verify the web onboarding, PhoneAccount registration and calling-account settings; use a physical Android device for final active-SIM enumeration and end-to-end call validation.
