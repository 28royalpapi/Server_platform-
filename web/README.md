# Server web setup

The website is a launch point, not a SIM reader or dialer. It opens `server://sim-setup` in the installed native app. Android SIM enumeration requires user permission inside the Android app. iOS does not expose SIM-slot number data to ordinary apps; iOS uses a separate Server ID and CallKit.

Device onboarding creates a random installation-bound Server identity and session through `server-auth?action=register_device`. This path does not send SMS OTPs and does not claim to verify the selected SIM's phone number. The device secret is stored locally and only its SHA-256 hash is stored by the backend.

Server-to-Server calls can be addressed by a Server ID such as `SVR-0123456789`. Calls to non-Server phone numbers still require a guest invitation route; SMS delivery to those recipients requires a paired Android SIM gateway (or a separately configured SMS provider), and the recipient needs internet access and microphone permission to use the guest browser call. WebRTC cannot reach an offline recipient through the cellular voice network by itself.

The native Android SIM picker uses Android's subscription APIs. Reported phone numbers may be blank or inaccurate and are never used to authenticate a user. Server is an internet-calling provider, not a cloned SIM/eSIM.
