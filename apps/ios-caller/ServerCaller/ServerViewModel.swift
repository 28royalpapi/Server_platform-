import AVFoundation
import CallKit
import Combine
import Foundation
import Security
import SwiftUI
import WebRTC

private enum ServerBuildConfig {
    static let url = Bundle.main.object(forInfoDictionaryKey: "SERVER_SUPABASE_URL") as? String ?? "https://YOUR_PROJECT_REF.supabase.co"
    static let key = Bundle.main.object(forInfoDictionaryKey: "SERVER_SUPABASE_PUBLISHABLE_KEY") as? String ?? "YOUR_PUBLISHABLE_KEY"
}

struct IncomingCall: Identifiable {
    let id: String
    let phone: String
}

@MainActor
final class ServerViewModel: ObservableObject {
    @Published var phone = "+234"
    @Published var otp = ""
    @Published var targetPhone = "+234"
    @Published var status = ""
    @Published var isError = false
    @Published var isBusy = false
    @Published var isSignedIn = false
    @Published var callId: String?
    @Published var incomingCall: IncomingCall?

    private var accessToken = Keychain.read("server.access")
    private var refreshToken = Keychain.read("server.refresh")
    private var expiresAt: TimeInterval = UserDefaults.standard.double(forKey: "server.expiry")
    private var storedPhone = UserDefaults.standard.string(forKey: "server.phone") ?? ""
    private var route = "server"
    private var activeStateSyncedFor: String?
    private var afterSeq = 0
    private var iceServers: [[String: Any]] = []
    private var pollingTask: Task<Void, Never>?
    private var incomingTask: Task<Void, Never>?
    private let rtc = ServerRTC()
    private let callKit = ServerCallKit()

    init() {
        if let phoneFromKeychain = Keychain.read("server.phone"), !phoneFromKeychain.isEmpty { storedPhone = phoneFromKeychain }
        phone = storedPhone.isEmpty ? "+234" : storedPhone
        isSignedIn = accessToken != nil
        rtc.iceStateHandler = { [weak self] state in
            Task { @MainActor [weak self] in
                guard let self else { return }
                switch state {
                case .connected, .completed:
                    self.update("Audio connection established.")
                    if let id = self.callId, self.activeStateSyncedFor != id {
                        self.activeStateSyncedFor = id
                        Task { @MainActor [weak self] in
                            guard let self, self.callId == id else { return }
                            do {
                                _ = try await self.api("set_active", body: ["call_id": id])
                            } catch {
                                if self.callId == id {
                                    self.update("Audio is connected, but the server could not sync the call state.", error: true)
                                }
                            }
                        }
                    }
                case .failed: self.update("WebRTC connection failed. This network may require a TURN relay.", error: true)
                case .disconnected: self.update("Audio connection lost. Trying to recover…", error: true)
                default: break
                }
            }
        }
        callKit.onAnswer = { [weak self] uuid in
            guard let self, let incoming = self.incomingCall, incoming.id.lowercased() == uuid.uuidString.lowercased() else { return }
            // The native CallKit action has already been accepted by the user.
            // Calling `accept()` here would request another CXAnswerCallAction recursively.
            Task { await self.acceptFromSystem(incoming) }
        }
        callKit.onEnd = { [weak self] _ in Task { await self?.endCall() } }
        if isSignedIn { status = "Signed in as \(maskedPhone). Checking Server calls…"; startIncomingPolling() }
    }

    var isConfigured: Bool {
        ServerBuildConfig.url.hasPrefix("https://") && !ServerBuildConfig.url.contains("YOUR_PROJECT") &&
        ServerBuildConfig.key.count > 20 && !ServerBuildConfig.key.contains("YOUR_")
    }
    var maskedPhone: String { storedPhone.count > 6 ? String(storedPhone.prefix(4)) + "••••" + String(storedPhone.suffix(3)) : storedPhone }

    func handleAppHandoff(_ url: URL) async {
        guard url.scheme == "server", url.host == "setup" else { return }
        guard let code = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "handoff" })?.value,
              code.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else {
            update("The setup link is invalid or expired. Return to the website and open Server again.", error: true)
            return
        }
        guard isConfigured else {
            update("This Server app build is not connected to the live backend.", error: true)
            return
        }
        isBusy = true
        defer { isBusy = false }
        do {
            let result = try await request("/functions/v1/server-handoff",
                                           body: ["action": "claim", "handoff_code": code],
                                           authorized: false)
            guard let access = result["access_token"] as? String, access.count == 64 else {
                throw ServerError.message("The setup handoff did not return an app session.")
            }
            let user = result["user"] as? [String: Any]
            guard let transferredPhone = user?["phone"] as? String, !transferredPhone.isEmpty else {
                throw ServerError.message("The setup handoff did not return a verified phone number.")
            }
            accessToken = access
            refreshToken = nil
            Keychain.save(access, key: "server.access")
            Keychain.delete("server.refresh")
            expiresAt = Self.parseExpiry(result["expires_at"] as? String)
                ?? Date().addingTimeInterval(30 * 24 * 60 * 60).timeIntervalSince1970
            UserDefaults.standard.set(expiresAt, forKey: "server.expiry")
            storedPhone = transferredPhone
            UserDefaults.standard.set(storedPhone, forKey: "server.phone")
            phone = transferredPhone
            isSignedIn = true
            update("Setup transferred securely. Server is an internet-calling account, not a SIM/eSIM.")
            startIncomingPolling()
        } catch {
            update("Could not transfer setup to the Server app: \(error.localizedDescription)", error: true)
        }
    }

    func requestOtp() async {
        guard isConfigured else { update("Supabase project URL and publishable key are not configured.", error: true); return }
        let clean = phone.trimmingCharacters(in: .whitespacesAndNewlines)
        guard clean.range(of: #"^\+[1-9][0-9]{7,14}$"#, options: .regularExpression) != nil else { update("Enter the full number with country code, e.g. +2348012345678.", error: true); return }
        isBusy = true; defer { isBusy = false }
        do {
            _ = try await request("/functions/v1/server-auth", body: ["action": "request_otp", "phone": clean], authorized: false)
            storedPhone = clean; phone = clean; Keychain.save(clean, key: "server.phone")
            update("A real SMS OTP has been queued through the paired SIM gateway. Check the handset; if the gateway is offline, sending must fail.")
        } catch { update(error.localizedDescription, error: true) }
    }

    func verifyOtp() async {
        let clean = storedPhone.isEmpty ? phone.trimmingCharacters(in: .whitespacesAndNewlines) : storedPhone
        guard otp.count == 6, otp.allSatisfy(\.isNumber) else { update("Enter the digits received by SMS.", error: true); return }
        isBusy = true; defer { isBusy = false }
        do {
            let result = try await request("/functions/v1/server-auth", body: ["action": "verify_otp", "phone": clean, "code": otp], authorized: false)
            guard let access = result["access_token"] as? String else { throw ServerError.message("Server verified the code but did not return a session.") }
            accessToken = access; refreshToken = nil
            expiresAt = Self.parseExpiry(result["expires_at"] as? String) ?? Date().timeIntervalSince1970 + 30 * 24 * 60 * 60
            Keychain.save(access, key: "server.access"); Keychain.delete("server.refresh")
            UserDefaults.standard.set(expiresAt, forKey: "server.expiry")
            isSignedIn = true; otp = ""; update("Phone ownership verified and a private Server session created."); startIncomingPolling()
        } catch { update(error.localizedDescription, error: true) }
    }

    func startCall() async {
        let target = targetPhone.trimmingCharacters(in: .whitespacesAndNewlines)
        guard target.range(of: #"^\+[1-9][0-9]{7,14}$"#, options: .regularExpression) != nil else { update("Enter the recipient's full number with country code.", error: true); return }
        isBusy = true; defer { isBusy = false }
        do {
            let result = try await api("start", body: ["to_phone": target])
            guard let id = result["call_id"] as? String else { throw ServerError.message("Backend did not return a call ID.") }
            callId = id; activeStateSyncedFor = nil; route = result["route"] as? String ?? "server"; afterSeq = 0
            iceServers = result["ice_servers"] as? [[String: Any]] ?? []
            try await startMedia(servers: iceServers)
            let offer = try await rtc.makeDescription(offer: true)
            _ = try await api("signal", body: ["call_id": id, "kind": "offer", "payload": offer])
            try await callKit.reportOutgoingStart(id: id, handle: target)
            update(route == "guest" ? "Guest invitation queued. Waiting for the recipient to open the SMS link with internet and microphone access." : "Calling another Server user…")
            startCallPolling()
        } catch { await endMedia(); callId = nil; update(error.localizedDescription, error: true) }
    }

    func accept(_ incoming: IncomingCall) async {
        do { try await callKit.requestAnswer(id: incoming.id) }
        catch { update(error.localizedDescription, error: true) }
    }

    private func acceptFromSystem(_ incoming: IncomingCall) async {
        do {
            callId = incoming.id; activeStateSyncedFor = nil; route = "server"; afterSeq = 0; incomingCall = nil
            let result = try await api("accept", body: ["call_id": incoming.id])
            iceServers = result["ice_servers"] as? [[String: Any]] ?? []
            try await startMedia(servers: iceServers)
            update("Incoming call accepted. Negotiating audio…"); startCallPolling()
        } catch { await endMedia(); callId = nil; update(error.localizedDescription, error: true) }
    }

    func decline(_ id: String) async {
        do { try await callKit.requestEnd(id: id) } catch { await declineFromSystem(IncomingCall(id: id, phone: incomingCall?.phone ?? "")) }
    }

    private func declineFromSystem(_ incoming: IncomingCall) async {
        incomingCall = nil
        do { _ = try await api("signal", body: ["call_id": incoming.id, "kind": "hangup", "payload": [:]]) } catch { }
    }

    func endCall() async {
        if let id = callId { do { _ = try await api("end", body: ["call_id": id]) } catch { } }
        callId = nil; activeStateSyncedFor = nil; pollingTask?.cancel(); pollingTask = nil; await endMedia(); update("Call ended.")
    }

    func signOut() {
        pollingTask?.cancel(); incomingTask?.cancel(); callId = nil; activeStateSyncedFor = nil; accessToken = nil; refreshToken = nil; isSignedIn = false
        Keychain.delete("server.access"); Keychain.delete("server.refresh"); UserDefaults.standard.removeObject(forKey: "server.expiry")
        update("Signed out.")
    }

    private func startIncomingPolling() {
        incomingTask?.cancel()
        incomingTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled && self.isSignedIn {
                do {
                    let result = try await self.api("incoming", body: [:])
                    if let rows = result["calls"] as? [[String: Any]], let first = rows.first,
                       let id = first["id"] as? String, self.callId == nil {
                        let from = first["caller_phone_e164"] as? String ?? "Server user"
                        if self.incomingCall?.id != id {
                            self.incomingCall = IncomingCall(id: id, phone: from)
                            try? await self.callKit.reportIncoming(id: id, handle: from)
                        }
                    }
                } catch { /* keep polling; do not log tokens or request bodies */ }
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    private func startCallPolling() {
        pollingTask?.cancel()
        pollingTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled, let id = self.callId {
                do {
                    let result = try await self.api("poll", body: ["call_id": id, "after_seq": self.afterSeq])
                    let signals = result["signals"] as? [[String: Any]] ?? []
                    for signal in signals {
                        self.afterSeq = max(self.afterSeq, signal["seq"] as? Int ?? 0)
                        try await self.handle(signal)
                    }
                    self.afterSeq = max(self.afterSeq, result["next_after_seq"] as? Int ?? 0)
                    let state = (result["call"] as? [String: Any])?["state"] as? String ?? ""
                    if ["ended", "failed", "missed"].contains(state) {
                        self.callId = nil; self.activeStateSyncedFor = nil; await self.endMedia(); self.update("Call ended."); break
                    }
                } catch { self.update(error.localizedDescription, error: true) }
                try? await Task.sleep(for: .milliseconds(700))
            }
        }
    }

    private func handle(_ signal: [String: Any]) async throws {
        let kind = signal["kind"] as? String ?? ""
        switch kind {
        case "offer":
            if !rtc.isReady { try await startMedia(servers: iceServers) }
            try await rtc.setRemote(signal["payload"] as? [String: Any] ?? [:])
            let answer = try await rtc.makeDescription(offer: false)
            if let id = callId { _ = try await api("signal", body: ["call_id": id, "kind": "answer", "payload": answer]) }
            update("Answer sent. Establishing the WebRTC audio connection…")
        case "answer":
            try await rtc.setRemote(signal["payload"] as? [String: Any] ?? [:]); update("Call answered. Negotiating audio…")
        case "ice": try rtc.addIce(signal["payload"] as? [String: Any] ?? [:])
        case "hangup":
            callId = nil; activeStateSyncedFor = nil; pollingTask?.cancel(); await endMedia(); update("The other person ended the call.")
        case "state":
            if let payload = signal["payload"] as? [String: Any], payload["state"] as? String == "active" {
                update("Audio connection active.")
            }
        default: break
        }
    }

    private func startMedia(servers: [[String: Any]]) async throws {
        try await rtc.start(iceServers: servers) { [weak self] candidate in
            Task { @MainActor [weak self] in
                guard let self, let id = self.callId else { return }
                do { _ = try await self.api("signal", body: ["call_id": id, "kind": "ice", "payload": candidate]) } catch { self.update(error.localizedDescription, error: true) }
            }
        }
        try AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .defaultToSpeaker])
        try AVAudioSession.sharedInstance().setActive(true)
    }

    private func endMedia() async {
        await rtc.stop()
        try? AVAudioSession.sharedInstance().setActive(false)
    }

    private func api(_ action: String, body: [String: Any]) async throws -> [String: Any] {
        var payload = body; payload["action"] = action
        return try await request("/functions/v1/server-calls", body: payload, authorized: true)
    }

    private func request(_ path: String, body: [String: Any], authorized: Bool, refresh: Bool = true) async throws -> [String: Any] {
        if authorized && refresh { try await refreshIfNeeded() }
        guard let url = URL(string: ServerBuildConfig.url.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path) else { throw ServerError.message("Invalid Supabase URL.") }
        var request = URLRequest(url: url); request.httpMethod = "POST"; request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue(ServerBuildConfig.key, forHTTPHeaderField: "apikey")
        if authorized, let accessToken { request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "authorization") }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ServerError.message("No response from Server backend.") }
        let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (200..<300).contains(http.statusCode) else {
            let reason = parsed["msg"] as? String ?? parsed["message"] as? String ?? parsed["error"] as? String ?? "HTTP \(http.statusCode)"
            throw ServerError.message(reason + " (HTTP \(http.statusCode))")
        }
        return parsed
    }

    private static func parseExpiry(_ value: String?) -> TimeInterval? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: value) { return date.timeIntervalSince1970 }
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value)?.timeIntervalSince1970
    }

    private func refreshIfNeeded() async throws {
        if expiresAt > Date().timeIntervalSince1970 + 90 { return }
        guard accessToken != nil else { throw ServerError.message("Verify your phone first.") }
        let result = try await request("/functions/v1/server-auth", body: ["action": "refresh"], authorized: true, refresh: false)
        guard let access = result["access_token"] as? String else { throw ServerError.message("Session refresh failed; verify your number again.") }
        accessToken = access
        expiresAt = Self.parseExpiry(result["expires_at"] as? String) ?? Date().timeIntervalSince1970 + 30 * 24 * 60 * 60
        Keychain.save(access, key: "server.access"); Keychain.delete("server.refresh")
        UserDefaults.standard.set(expiresAt, forKey: "server.expiry")
    }

    private func update(_ message: String, error: Bool = false) { status = message; isError = error }
}

private enum ServerError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let value) = self { return value }; return "Server error." }
}

private enum Keychain {
    static func save(_ value: String, key: String) {
        let data = Data(value.utf8)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key]
        SecItemDelete(query as CFDictionary)
        var item = query; item[kSecValueData as String] = data; item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }
    static func read(_ key: String) -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func delete(_ key: String) { SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key] as CFDictionary) }
}

@MainActor
private final class ServerCallKit: NSObject, CXProviderDelegate {
    private let provider: CXProvider
    private let controller = CXCallController()
    var onAnswer: ((UUID) -> Void)?
    var onEnd: ((UUID) -> Void)?
    private var handles: [UUID: String] = [:]

    override init() {
        let config = CXProviderConfiguration(localizedName: "Server")
        config.supportsVideo = false; config.maximumCallGroups = 1; config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.phoneNumber]
        provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: nil)
    }

    func reportIncoming(id: String, handle: String) async throws {
        guard let uuid = UUID(uuidString: id) else { return }
        if handles[uuid] != nil { return }
        handles[uuid] = handle
        let update = CXCallUpdate(); update.remoteHandle = CXHandle(type: .phoneNumber, value: handle); update.hasVideo = false
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            provider.reportNewIncomingCall(with: uuid, update: update) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: ()) }
            }
        }
    }

    func reportOutgoingStart(id: String, handle: String) async throws {
        guard let uuid = UUID(uuidString: id) else { return }
        handles[uuid] = handle
        let action = CXStartCallAction(call: uuid, handle: CXHandle(type: .phoneNumber, value: handle))
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            controller.request(CXTransaction(action: action)) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: ()) }
            }
        }
    }

    func requestAnswer(id: String) async throws {
        guard let uuid = UUID(uuidString: id) else { return }
        let action = CXAnswerCallAction(call: uuid)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            controller.request(CXTransaction(action: action)) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: ()) }
            }
        }
    }

    func requestEnd(id: String) async throws {
        guard let uuid = UUID(uuidString: id) else { return }
        let action = CXEndCallAction(call: uuid)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            controller.request(CXTransaction(action: action)) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: ()) }
            }
        }
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        onAnswer?(action.callUUID)
        action.fulfill()
    }
    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        onEnd?(action.callUUID)
        handles.removeValue(forKey: action.callUUID)
        action.fulfill()
    }
    func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: Date())
        action.fulfill()
    }
    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {}
    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {}
    func providerDidReset(_ provider: CXProvider) { handles.removeAll() }
}

private final class ServerRTC: NSObject, RTCPeerConnectionDelegate {
    private var factory: RTCPeerConnectionFactory?
    private var peer: RTCPeerConnection?
    private var audioSource: RTCAudioSource?
    private var audioTrack: RTCAudioTrack?
    private var candidateHandler: (([String: Any]) -> Void)?
    private var pendingCandidates: [[String: Any]] = []
    var iceStateHandler: ((RTCIceConnectionState) -> Void)?
    var isReady: Bool { peer != nil }

    func start(iceServers raw: [[String: Any]], onCandidate: @escaping ([String: Any]) -> Void) async throws {
        if peer != nil { await stop() }
        candidateHandler = onCandidate
        let encoder = RTCDefaultVideoEncoderFactory(); let decoder = RTCDefaultVideoDecoderFactory()
        factory = RTCPeerConnectionFactory(encoderFactory: encoder, decoderFactory: decoder)
        let servers = raw.compactMap { row -> RTCIceServer? in
            let urls: [String]
            if let many = row["urls"] as? [String] { urls = many }
            else if let one = row["urls"] as? String { urls = [one] }
            else { return nil }
            return RTCIceServer(urlStrings: urls, username: row["username"] as? String ?? "", credential: row["credential"] as? String ?? "")
        }
        let config = RTCConfiguration(); config.iceServers = servers.isEmpty ? [RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"])] : servers
        config.sdpSemantics = .unifiedPlan
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        guard let madePeer = factory?.peerConnection(with: config, constraints: constraints, delegate: self) else { throw ServerError.message("Could not create WebRTC peer connection.") }
        peer = madePeer
        audioSource = factory?.audioSource(with: constraints)
        if let audioSource { audioTrack = factory?.audioTrack(with: audioSource, trackId: "server-audio") }
        if let audioTrack { madePeer.add(audioTrack, streamIds: ["server-audio-stream"]) }
    }

    func makeDescription(offer: Bool) async throws -> [String: Any] {
        guard let peer else { throw ServerError.message("WebRTC not initialized.") }
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let description: RTCSessionDescription = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<RTCSessionDescription, Error>) in
            let callback: (RTCSessionDescription?, Error?) -> Void = { sdp, error in
                if let error { continuation.resume(throwing: error) }
                else if let sdp { continuation.resume(returning: sdp) }
                else { continuation.resume(throwing: ServerError.message("No SDP returned.")) }
            }
            if offer { peer.offer(for: constraints, completionHandler: callback) }
            else { peer.answer(for: constraints, completionHandler: callback) }
        }
        try await setLocal(description)
        return ["type": offer ? "offer" : "answer", "sdp": description.sdp]
    }

    private func setLocal(_ description: RTCSessionDescription) async throws {
        guard let peer else { throw ServerError.message("WebRTC not initialized.") }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            peer.setLocalDescription(description) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }

    func setRemote(_ json: [String: Any]) async throws {
        guard let peer, let sdp = json["sdp"] as? String else { throw ServerError.message("Invalid remote SDP.") }
        let type: RTCSdpType = (json["type"] as? String) == "offer" ? .offer : .answer
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            peer.setRemoteDescription(RTCSessionDescription(type: type, sdp: sdp)) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
        for value in pendingCandidates { try addIce(value) }; pendingCandidates.removeAll()
    }

    func addIce(_ value: [String: Any]) throws {
        guard let peer, let candidate = value["candidate"] as? String else { return }
        guard peer.remoteDescription != nil else { pendingCandidates.append(value); return }
        let mid = value["sdpMid"] as? String
        let line = (value["sdpMLineIndex"] as? NSNumber)?.int32Value ?? 0
        peer.add(RTCIceCandidate(sdp: candidate, sdpMLineIndex: line, sdpMid: mid))
    }

    func stop() async {
        peer?.close(); peer = nil; audioTrack = nil; audioSource = nil; factory = nil
        pendingCandidates.removeAll(); candidateHandler = nil
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) { iceStateHandler?(newState) }
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        candidateHandler?(["candidate": candidate.sdp, "sdpMid": candidate.sdpMid ?? NSNull(), "sdpMLineIndex": candidate.sdpMLineIndex])
    }
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didStartReceivingOn transceiver: RTCRtpTransceiver) {}
}
