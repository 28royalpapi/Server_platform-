# Server offline delivery and RxDB design

## Core rule
An offline device cannot receive a live WebRTC ring while it has no usable network path. Server can preserve the call attempt and show a missed-call receipt when the recipient reconnects. A live ring is possible only when a client or supported OS push path is reachable.

## One private inbox per Server identity
- Existing Supabase server_calls remains the authoritative call and missed-call record.
- If a Server recipient has no fresh session and no registered background push endpoint, the caller creates a missed record without starting a media session or enqueueing a false ring.
- The authenticated incoming endpoint returns the missed record after reconnect. Android renders it as a quiet missed-call notification, never as a Telecom ring.
- Local cache holds call ID, caller Server ID, state and timestamps only. It does not store bearer invite tokens, unconsented numbers, SDP, ICE or audio.

## Non-Server recipients
- A guest invitation remains valid for 24 hours, allowing delayed delivery or temporary unavailability.
- The actual live call window remains 20 minutes. Opening the link after that returns a missed-call state, not a live ring.
- The browser guest page uses RxDB with free Dexie/IndexedDB storage for a minimal local invitation receipt. A service worker caches the page shell after the first successful online visit.
- A guest still needs internet to answer a live call. Local receipt does not create connectivity.

## Why not one room containing every contact?
RxDB WebRTC topics are live peer-discovery rooms. A contact-wide room would connect unrelated people, disclose presence and create large fan-out. It also does not retain documents for an offline peer. If Server later needs peer-to-peer replication among one user own devices, use a topic derived from that single Server identity (for example, server:v1:user:<opaque-user-id>) and authorize signaling. Do not put the user contacts in one shared room.

The native Android app is Kotlin, not React Native. It consumes the same authenticated inbox API and uses Android-native persistence and notifications. Production RxDB SQLite for React Native is a paid Premium storage, so adding it to this Kotlin connector would add cost and a framework migration without improving offline delivery. The browser guest page is the appropriate first RxDB surface.

## Boundaries
This provides store-and-forward missed-call receipts. It does not promise live ringing on a disconnected device, background delivery to a guest who has never opened or opted into the website, or a guest-to-Server callback call. Those need separately tested delivery and consent paths.
