# Server audio path: upstream reference and acceptance evidence

## Upstream reference inspected

Server's browser audio implementation was compared against the WebRTC Project's official audio-only peer-connection sample:

- Repository: https://github.com/webrtc/samples
- Pinned inspected revision: `6bd116932df29815b39ebcbba3415366a6202662` (4 November 2026)
- Sample page: https://github.com/webrtc/samples/tree/gh-pages/src/content/peerconnection/audio
- Audio media implementation: https://github.com/webrtc/samples/blob/gh-pages/src/content/peerconnection/audio/js/main.js
- Sample browser test: https://github.com/webrtc/samples/blob/gh-pages/src/content/peerconnection/audio/js/test.js

The upstream sample demonstrates the audio-only browser media path: request microphone media with `getUserMedia({audio:true, video:false})`, add microphone tracks to an `RTCPeerConnection`, negotiate SDP offer/answer, exchange ICE candidates, attach the remote audio track to an `<audio>` element, and inspect RTP statistics. Its Selenium test creates two peer connections in one browser process. That is useful reference code, but its local loopback test is not proof of a physical two-phone conversation.

## How Server uses the same media path

| Upstream audio-only sample | Server implementation |
|---|---|
| Browser `getUserMedia` audio capture | `web/guest.js` requests microphone audio after the guest taps Answer |
| `RTCPeerConnection` and `addTrack` | Guest browser and Android Telecom create peer connections and publish audio tracks |
| SDP offer/answer | Authenticated `server-calls` / `server-guest` signalling stores and forwards offer and answer messages |
| ICE candidate exchange | Both clients exchange trickle ICE candidates through the call signalling path |
| Remote `ontrack` audio playback | Guest browser attaches remote audio to `#remote-audio`; Android enables its received audio track and routes Telecom audio |
| RTP stats / audio-level evidence | Both sides inspect inbound/outbound RTP packet counts and audio energy before reporting the call active |

Android captures audio through `JavaAudioDeviceModule` using `MediaRecorder.AudioSource.VOICE_COMMUNICATION`, creates an audio source and track, and adds that track to its native peer connection. This preserves Android's voice-communication audio processing and Telecom lifecycle.

## What the automated end-to-end test proves

The existing `scripts/android-guest-browser-e2e.sh` workflow uses two separate endpoints:

1. An Android emulator places the call through Android Telecom.
2. A separate Chromium browser opens the no-install guest invitation and answers it.
3. A generated 440 Hz audio waveform is injected into the Android emulator's host microphone input and a test audio source is provided to Chromium.
4. The test requires successful ICE connectivity, a remote audio track, non-zero inbound and outbound RTP packet counts, and non-zero inbound and outbound audio energy before it reports the media path as connected.
5. It then ends the call and verifies the guest leave/hang-up lifecycle.

This is a stronger media-path test than checking that the call row, SDP offer or SDP answer exists. It does **not** certify the microphones, acoustics or mobile-network quality of two physical phones. The physical acceptance remains two real handsets on distinct internet connections, both granting microphone permission, with actual spoken audio heard in both directions.

## Operational limits

- STUN alone cannot guarantee connectivity through carrier-grade NATs and restrictive Wi-Fi. A deployed TURN relay and a relay-selected ICE candidate must be verified.
- Centrifugo carries signalling publications; it does not carry audio.
- A 1:1 P2P call can be direct where ICE permits, with TURN relay when necessary. A ten-person group conversation needs a real SFU/group-room media topology; ten independent invitation links alone do not create ten simultaneous audio participants.
- The self-hosted Centrifugo/Redis/Coturn CI smoke proves those services can start and pass isolated tests. It does not prove that they are deployed at a public production hostname or provisioned in the live Server Backend.

