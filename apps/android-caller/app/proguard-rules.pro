# WebRTC's native JNI registration and reflection-backed factory entry points.
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**

# Firebase Messaging uses generated/service-loaded components; retain its manifest entry points.
-keep class com.google.firebase.messaging.** { *; }
