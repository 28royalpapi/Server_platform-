import AVFoundation
import CallKit
import Combine
import Foundation
import PushKit
import Security
import SwiftUI
import WebRTC
import PhoneNumberKit
import SwiftCentrifuge
import UIKit

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
    private let phoneNumberUtility = PhoneNumberUtility()
    @Published var phone = ""
    @Published var acceptedTerms = false
    @Published var serverID = UserDefaults.standard.string(forKey: "server.server_id") ?? ""
    @Published var otp = ""
    @Published var targetPhone = ""
    @Published var guestInviteMessage = ""
    @Published var status = ""
    @Published var isError = false
    @Published var isBusy = false
    @Published var isSignedIn = false
    @Published var callId: String?
    @Published var incomingCall: IncomingCall?
    @Published var phoneLinkPhone = "+234"
    @Published var phoneLinkCode = ""
    @Published var phoneLinkStatus = ""
    @Published var phoneLinkCodeSent = false
    @Published var linkedPhone = UserDefaults.standard.string(forKey: "server.linked_phone") ?? ""
    @Published var allowNumberBasedServerCalls = UserDefaults.standard.bool(forKey: "server.allow_number_based_server_calls")

    private var accessToken = Keychain.read("server.access")
    private var refreshToken = Keychain.read("server.refresh")
    private var expiresAt: TimeInterval = UserDefaults.standard.double(forKey: "server.expiry")
    private var storedPhone = UserDefaults.standard.string(forKey: "server.phone") ?? ""
    private var route = "server"
    private var afterSeq = 0
    private var iceServers: [[String: Any]] = []
    private var pollingTask: Task<Void, Never>?
    private var incomingTask: Task<Void, Never>?
    private let rtc = ServerRTC()
    private let callKit = ServerCallKit()
    private let voipPush = ServerVoIPPushRegistry()
    private var realtimeClient: CentrifugeClient?
    private var realtimeDelegate: ServerRealtimeDelegate?
    private var realtimeConnected = false

    init() {
        if let phoneFromKeychain = Keychain.read("server.phone"), !phoneFromKeychain.isEmpty { storedPhone = phoneFromKeychain }
        phone = storedPhone.isEmpty ? "+234" : storedPhone
        phoneLinkPhone = linkedPhone.isEmpty ? (storedPhone.isEmpty ? "+234" : storedPhone) : linkedPhone
        isSignedIn = accessToken != nil
        rtc.iceStateHandler = { [weak self] state in
            Task { @MainActor [weak self] in
                guard let self else { return }
                switch state {
                case .connected, .completed: self.update("Audio connection established.")
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
        callKit.onEnd = { [weak self] uuid in Task { await self?.handleCallKitEnd(uuid) } }
        voipPush.onToken = { [weak self] token in
            UserDefaults.standard.set(token, forKey: "server.voip_push_token")
            guard let self, self.isSignedIn else { return }
            Task { await self.registerPushToken(token, platform: "ios_voip") }
        }
        voipPush.onIncomingPush = { [weak self] payload, completion in
            guard let self,
                  let id = payload["call_id"] as? String,
                  UUID(uuidString: id) != nil else {
                completion()
                return
            }
            let caller = payload["caller_label"] as? String ?? "Server user"
            Task {
                let incoming = IncomingCall(id: id, phone: caller)
                self.incomingCall = incoming
                do {
                    try await self.callKit.reportIncoming(id: id, callerName: caller)
                    self.startIncomingPolling()
                } catch {
                    self.update("iPhone received a Server call alert but could not present it through CallKit: \(error.localizedDescription)", error: true)
                }
                completion()
            }
        }
        NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.realtimeConnected = false
                self?.realtimeClient?.disconnect()
            }
        }
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.isSignedIn else { return }
                await self.connectRealtime(callID: self.callId)
            }
        }
        if isSignedIn { status = "Signed in as \(maskedPhone). Checking Server calls…"; startIncomingPolling() }
        if isSignedIn { Task { await loadNumberCallPreferences() } }
    }

    var isConfigured: Bool {
        ServerBuildConfig.url.hasPrefix("https://") && !ServerBuildConfig.url.contains("YOUR_PROJECT") &&
        ServerBuildConfig.key.count > 20 && !ServerBuildConfig.key.contains("YOUR_")
    }
    var maskedPhone: String { if !storedPhone.isEmpty { return storedPhone.count > 6 ? String(storedPhone.prefix(4)) + "••••" + String(storedPhone.suffix(3)) : storedPhone }; return serverID.isEmpty ? "Server ID pending" : serverID }

    func handleAppHandoff(_ url: URL) async {
        guard url.scheme == "server" else { return }
        if url.host == "device-setup" { update("Website onboarding opened Server. iOS does not expose SIM slots; create your Server identity here, then use the authorized default-calling integration when Apple permits it."); return }
        guard url.host == "setup" else { return }
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

    func registerDevice() async {
        guard isConfigured else { update("Supabase project URL and publishable key are not configured.", error: true); return }
        guard acceptedTerms else { update("Please accept the Terms and acknowledge the Privacy Notice.", error: true); return }
        isBusy = true
        defer { isBusy = false }
        do {
            let installationID: String
            if let saved = Keychain.read("server.installation"), !saved.isEmpty {
                installationID = saved
            } else {
                installationID = UUID().uuidString.lowercased()
                Keychain.save(installationID, key: "server.installation")
            }
            let deviceSecret: String
            if let saved = Keychain.read("server.device.secret"), saved.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil {
                deviceSecret = saved
            } else {
                var bytes = [UInt8](repeating: 0, count: 32)
                guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw ServerError.message("Could not create a secure device key.") }
                deviceSecret = bytes.map { String(format: "%02x", $0) }.joined()
                Keychain.save(deviceSecret, key: "server.device.secret")
            }
            let result = try await request("/functions/v1/server-auth", body: [
                "action": "register_device", "installation_id": installationID, "device_secret": deviceSecret,
                "accepted_terms": true, "terms_version": "server-terms-1.0", "privacy_version": "server-privacy-1.0"
            ], authorized: false)
            guard let access = result["access_token"] as? String, access.count == 64 else { throw ServerError.message("Server did not create a device session.") }
            let user = result["user"] as? [String: Any] ?? [:]
            guard let id = user["server_id"] as? String, id.range(of: "^SVR-[0-9A-F]{10}$", options: .regularExpression) != nil else { throw ServerError.message("Server did not return a valid Server ID.") }
            accessToken = access; refreshToken = nil
            Keychain.save(access, key: "server.access"); Keychain.delete("server.refresh")
            expiresAt = Self.parseExpiry(result["expires_at"] as? String) ?? Date().timeIntervalSince1970 + 30 * 24 * 60 * 60
            UserDefaults.standard.set(expiresAt, forKey: "server.expiry")
            serverID = id; storedPhone = ""; UserDefaults.standard.removeObject(forKey: "server.phone"); UserDefaults.standard.set(id, forKey: "server.server_id")
            isSignedIn = true
            update("Setup complete. Your Server ID is \(id). The project includes the iOS Default Calling App capability; Apple-authorized signing and iOS 18.2+ are required before Server can be selected as the default caller.")
            startIncomingPolling()
        } catch { update("Device-first setup failed: \(error.localizedDescription)", error: true) }
    }
    func requestPhoneLinkCode() async {
        guard isConfigured else {
            phoneLinkStatus = "This Server build is not connected to the backend."
            isError = true
            return
        }
        guard isSignedIn, accessToken != nil else {
            phoneLinkStatus = "Create your Server identity before linking a number."
            isError = true
            return
        }
        guard let clean = normalizePhoneForServer(phoneLinkPhone) else {
            phoneLinkStatus = "Enter an international number (for example +2348012345678 or +919876543210), or a local number for your iPhone's region."
            isError = true
            return
        }
        phoneLinkPhone = clean
        isBusy = true
        defer { isBusy = false }
        do {
            _ = try await request("/functions/v1/server-auth",
                                  body: ["action": "request_otp", "phone": clean],
                                  authorized: false)
            phoneLinkCodeSent = true
            phoneLinkStatus = "A verification code was queued for \(clean). Check the handset; carrier SMS charges may apply."
            isError = false
        } catch {
            let reason = error.localizedDescription
            if reason.contains("SMS_GATEWAY_OFFLINE") {
                phoneLinkStatus = "Server's SMS gateway is offline. Pair the Android SMS gateway and try again, or skip number linking."
            } else if reason.contains("OTP_RATE_LIMITED") {
                phoneLinkStatus = "Too many requests. Wait before requesting another code."
            } else {
                phoneLinkStatus = "Could not send the verification code: \(reason)"
            }
            isError = true
        }
    }

    func verifyAndLinkPhone() async {
        guard isConfigured, isSignedIn, accessToken != nil else {
            phoneLinkStatus = "Create your Server identity and connect to the backend first."
            isError = true
            return
        }
        guard let clean = normalizePhoneForServer(phoneLinkPhone) else {
            phoneLinkStatus = "Enter a valid international number or a local number for your iPhone's region."
            isError = true
            return
        }
        guard phoneLinkCodeSent else {
            phoneLinkStatus = "Request a verification code first."
            isError = true
            return
        }
        let code = phoneLinkCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard code.range(of: "^[0-9]{6}$", options: .regularExpression) != nil else {
            phoneLinkStatus = "Enter the six digits from the SMS."
            isError = true
            return
        }
        isBusy = true
        defer { isBusy = false }
        do {
            let result = try await request("/functions/v1/server-auth",
                                          body: ["action": "link_phone", "phone": clean, "code": code, "allow_number_based_server_calls": allowNumberBasedServerCalls],
                                          authorized: true)
            guard result["ok"] as? Bool == true,
                  let verified = result["phone"] as? String else {
                throw ServerError.message("Server did not confirm the number link.")
            }
            linkedPhone = verified
            phoneLinkPhone = verified
            phoneLinkCode = ""
            phoneLinkCodeSent = false
            storedPhone = verified
            phone = verified
            allowNumberBasedServerCalls = result["allow_number_based_server_calls"] as? Bool ?? allowNumberBasedServerCalls
            UserDefaults.standard.set(verified, forKey: "server.linked_phone")
            UserDefaults.standard.set(verified, forKey: "server.phone")
            UserDefaults.standard.set(allowNumberBasedServerCalls, forKey: "server.allow_number_based_server_calls")
            Keychain.save(verified, key: "server.phone")
            phoneLinkStatus = "Number verified and linked to your existing Server ID. Your identity has not changed."
            isError = false
            update("Phone number verified and linked. On iPhone, choose Server as the default calling app in Settings > Apps > Default Apps > Calling after Apple authorizes this app's entitlement.")
        } catch {
            let reason = error.localizedDescription
            if reason.contains("PHONE_ALREADY_LINKED") {
                phoneLinkStatus = "That number already belongs to another Server identity. Sign in to that identity or use a different number."
            } else if reason.contains("INVALID_OR_EXPIRED_CODE") {
                phoneLinkStatus = "That code is invalid or expired. Request a new code and try again."
            } else if reason.contains("OTP_VERIFY_RATE_LIMITED") {
                phoneLinkStatus = "Too many attempts. Wait before trying again."
            } else {
                phoneLinkStatus = "Could not link this number: \(reason)"
            }
            isError = true
        }
    }

    private func loadNumberCallPreferences() async {
        guard isConfigured, isSignedIn else { return }
        do {
            let result = try await request("/functions/v1/server-auth", body: ["action": "me"], authorized: true)
            let profile = result["user"] as? [String: Any] ?? result["profile"] as? [String: Any] ?? [:]
            let allowed = profile["allow_number_based_server_calls"] as? Bool ?? false
            allowNumberBasedServerCalls = allowed
            UserDefaults.standard.set(allowed, forKey: "server.allow_number_based_server_calls")
            if let number = profile["phone_e164"] as? String, !number.isEmpty, profile["phone_verified_at"] is String {
                linkedPhone = number
                phoneLinkPhone = number
                UserDefaults.standard.set(number, forKey: "server.linked_phone")
            }
        } catch { }
    }

    func updateNumberCallConsent(_ requested: Bool) async {
        guard isConfigured, isSignedIn, !linkedPhone.isEmpty else {
            phoneLinkStatus = "Verify and link a mobile number before enabling calls by number."
            isError = true
            allowNumberBasedServerCalls = UserDefaults.standard.bool(forKey: "server.allow_number_based_server_calls")
            return
        }
        let previous = UserDefaults.standard.bool(forKey: "server.allow_number_based_server_calls")
        do {
            let result = try await request("/functions/v1/server-auth", body: [
                "action": "set_number_call_consent",
                "allow_number_based_server_calls": requested
            ], authorized: true)
            guard result["ok"] as? Bool == true,
                  let saved = result["allow_number_based_server_calls"] as? Bool else {
                throw ServerError.message("Server did not confirm the calling permission.")
            }
            allowNumberBasedServerCalls = saved
            UserDefaults.standard.set(saved, forKey: "server.allow_number_based_server_calls")
            phoneLinkStatus = saved
                ? "Permission saved. Server users can ring you over the internet at this verified number."
                : "Permission revoked. Calls by Server ID still work, but calls by this number no longer route to this account."
            isError = false
        } catch {
            allowNumberBasedServerCalls = previous
            UserDefaults.standard.set(previous, forKey: "server.allow_number_based_server_calls")
            phoneLinkStatus = "Could not save the calling permission: " + error.localizedDescription
            isError = true
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

    private func normalizePhoneForServer(_ raw: String) -> String? {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.count <= 250 else { return nil }

        do {
            let parsed: PhoneNumber
            if value.hasPrefix("+") {
                // E.164/international input is independent of the caller's country.
                parsed = try phoneNumberUtility.parse(value)
            } else {
                // National-format input is meaningful only with a real device locale.
                // Never silently interpret an unknown region as Nigeria.
                guard let region = Locale.current.region?.identifier,
                      region.range(of: #"^[A-Za-z]{2}$"#, options: .regularExpression) != nil
                else { return nil }
                parsed = try phoneNumberUtility.parse(value, withRegion: region.uppercased(), ignoreType: true)
            }

            let e164 = phoneNumberUtility.format(parsed, toType: .e164)
            return e164.range(of: #"^\+[1-9][0-9]{7,14}$"#, options: .regularExpression) != nil
                ? e164 : nil
        } catch {
            return nil
        }
    }

    func startCall() async {
        let rawTarget = targetPhone.trimmingCharacters(in: .whitespacesAndNewlines)
        let typedServerID = rawTarget.uppercased()
        let isServerID = typedServerID.range(of: #"^SVR-[0-9A-F]{10}$"#, options: .regularExpression) != nil
        let normalizedPhone = isServerID ? nil : normalizePhoneForServer(rawTarget)
        let payload: [String: Any]
        if isServerID { payload = ["to_server_id": typedServerID] }
        else if let normalizedPhone { payload = ["to_phone": normalizedPhone] }
        else { update("Enter a Server ID or an international number (+country code), or a local number for your iPhone's region.", error: true); return }
        guestInviteMessage = ""
        isBusy = true; defer { isBusy = false }
        do {
            let result = try await api("start", body: payload)
            guard let id = result["call_id"] as? String else { throw ServerError.message("Backend did not return a call ID.") }
            callId = id; route = result["route"] as? String ?? "server"; afterSeq = 0
            await connectRealtime(callID: id)
            let deliveryMode = result["delivery_mode"] as? String ?? ""
            let invitationText = result["invitation_text"] as? String ?? result["sms_body"] as? String ?? ""
            guestInviteMessage = route == "guest" && (deliveryMode == "manual_share" || deliveryMode == "manual_sms")
                ? invitationText : ""
            iceServers = result["ice_servers"] as? [[String: Any]] ?? []
            try await startMedia(servers: iceServers)
            let offer = try await rtc.makeDescription(offer: true)
            _ = try await api("signal", body: ["call_id": id, "kind": "offer", "payload": offer])
            try await callKit.reportOutgoingStart(id: id, handle: normalizedPhone ?? typedServerID)
            if !guestInviteMessage.isEmpty {
                update("No SMS gateway is connected. Tap Share guest invitation and choose Messages to send it to the recipient. They must open it with internet access.")
            } else {
                update(route == "guest" ? "Guest invitation queued for SMS delivery. The recipient needs internet and microphone access." : "Calling another Server user…")
            }
            startCallPolling()
        } catch {
            if let failedID = callId {
                _ = try? await api("end", body: ["call_id": failedID])
                callKit.reportEnded(id: failedID, reason: .failed)
            }
            await endMedia()
            callId = nil
            guestInviteMessage = ""
            update(error.localizedDescription, error: true)
        }
    }

    func accept(_ incoming: IncomingCall) async {
        do { try await callKit.requestAnswer(id: incoming.id) }
        catch { update(error.localizedDescription, error: true) }
    }

    private func acceptFromSystem(_ incoming: IncomingCall) async {
        do {
            callId = incoming.id; route = "server"; afterSeq = 0; incomingCall = nil
            let result = try await api("accept", body: ["call_id": incoming.id])
            await connectRealtime(callID: incoming.id)
            iceServers = result["ice_servers"] as? [[String: Any]] ?? []
            try await startMedia(servers: iceServers)
            update("Incoming call accepted. Negotiating audio…"); startCallPolling()
        } catch {
            if let failedID = callId {
                _ = try? await api("end", body: ["call_id": failedID])
                callKit.reportEnded(id: failedID, reason: .failed)
            }
            callId = nil
            await endMedia()
            update(error.localizedDescription, error: true)
        }
    }

    func decline(_ id: String) async {
        do { try await callKit.requestEnd(id: id) } catch { await declineFromSystem(IncomingCall(id: id, phone: incomingCall?.phone ?? "")) }
    }

    private func declineFromSystem(_ incoming: IncomingCall) async {
        incomingCall = nil
        do {
            _ = try await api("signal", body: ["call_id": incoming.id, "kind": "hangup", "payload": [:]])
        } catch {
            update("Could not notify the caller that this call was declined.", error: true)
        }
        callKit.reportEnded(id: incoming.id, reason: .failed)
    }

    private func handleCallKitEnd(_ uuid: UUID) async {
        if let incoming = incomingCall,
           incoming.id.lowercased() == uuid.uuidString.lowercased() {
            incomingCall = nil
            do {
                _ = try await api("signal", body: ["call_id": incoming.id, "kind": "hangup", "payload": [:]])
                update("Incoming call declined.")
            } catch {
                update("CallKit ended the incoming call, but Server could not notify the caller.", error: true)
            }
            return
        }
        if let id = callId, id.lowercased() == uuid.uuidString.lowercased() {
            await endCall()
        }
    }

    private func callKitEndReason(for state: String) -> CXCallEndedReason {
        switch state {
        case "failed": return .failed
        case "missed": return .unanswered
        case "connecting", "active": return .answeredElsewhere
        default: return .remoteEnded
        }
    }

    func endCall() async {
        if let id = callId {
            do { _ = try await api("end", body: ["call_id": id]) } catch { }
            callKit.reportEnded(id: id, reason: .remoteEnded)
        }
        callId = nil
        pollingTask?.cancel()
        pollingTask = nil
        realtimeClient?.disconnect()
        realtimeClient = nil
        realtimeDelegate = nil
        realtimeConnected = false
        await endMedia()
        update("Call ended.")
        if isSignedIn { await connectRealtime() }
    }

    func signOut() {
        pollingTask?.cancel(); incomingTask?.cancel(); callId = nil; accessToken = nil; refreshToken = nil; isSignedIn = false
        realtimeConnected = false; realtimeClient?.disconnect(); realtimeClient = nil; realtimeDelegate = nil
        Keychain.delete("server.access"); Keychain.delete("server.refresh"); UserDefaults.standard.removeObject(forKey: "server.expiry")
        update("Server session cleared. This device can register again with its existing device key.")
    }

    private func startIncomingPolling() {
        if let pushToken = UserDefaults.standard.string(forKey: "server.voip_push_token") {
            Task { await self.registerPushToken(pushToken, platform: "ios_voip") }
        }
        Task { await self.connectRealtime(callID: self.callId) }
        incomingTask?.cancel()
        incomingTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled && self.isSignedIn {
                if !self.realtimeConnected {
                    do {
                        let result = try await self.api("incoming", body: [:])
                        let rows = result["calls"] as? [[String: Any]] ?? []
                        await self.handleIncomingRows(rows)
                    } catch { /* durable polling is the fallback when push/socket is unavailable */ }
                }
                try? await Task.sleep(for: .seconds(self.realtimeConnected ? 5 : 2))
            }
        }
    }

    private func handleIncomingRows(_ rows: [[String: Any]]) async {
        if callId == nil, let pending = incomingCall {
            await reconcilePendingIncoming(pending, rows: rows)
        }
        if callId == nil, incomingCall == nil,
           let first = rows.first(where: { ($0["state"] as? String) == "ringing" }),
           let id = first["id"] as? String {
            let callerPhone = first["caller_phone_e164"] as? String
            let from = callerPhone.flatMap {
                $0.range(of: #"^\\+[1-9][0-9]{7,14}$"#, options: .regularExpression) != nil ? $0 : nil
            }
            incomingCall = IncomingCall(id: id, phone: from ?? "Server caller")
            try? await callKit.reportIncoming(id: id, phoneNumber: from)
        }
    }

    private func registerPushToken(_ token: String, platform: String) async {
        guard isSignedIn, token.count >= 40 else { return }
        if UserDefaults.standard.string(forKey: "server.voip_push_registered") == token { return }
        do {
            _ = try await api("register_push_token", body: ["platform": platform, "push_token": token])
            UserDefaults.standard.set(token, forKey: "server.voip_push_registered")
        } catch {
            // Retry when incoming polling starts again or the next token callback arrives.
            update("iOS VoIP push registration is pending: \(error.localizedDescription)", error: true)
        }
    }

    private func reconcilePendingIncoming(_ pending: IncomingCall, rows: [[String: Any]]) async {
        if let row = rows.first(where: { ($0["id"] as? String) == pending.id }) {
            let state = row["state"] as? String ?? "ringing"
            if state == "connecting" || state == "active" {
                callKit.reportEnded(id: pending.id, reason: .answeredElsewhere)
                if incomingCall?.id == pending.id { incomingCall = nil }
            }
            return
        }

        do {
            let result = try await api("poll", body: ["call_id": pending.id])
            guard let call = result["call"] as? [String: Any] else {
                callKit.reportEnded(id: pending.id, reason: .remoteEnded)
                if incomingCall?.id == pending.id { incomingCall = nil }
                return
            }
            let state = call["state"] as? String ?? "ringing"
            switch state {
            case "ringing":
                return
            case "connecting", "active", "ended", "failed", "missed":
                callKit.reportEnded(id: pending.id, reason: callKitEndReason(for: state))
                if incomingCall?.id == pending.id { incomingCall = nil }
            default:
                return
            }
        } catch {
            // A transient poll failure must not dismiss a real incoming call.
        }
    }

    private func connectRealtime(callID: String? = nil) async {
        guard isSignedIn else { return }
        if let callID, callId != callID { return }
        do {
            let body: [String: Any] = callID.map { ["call_id": $0] } ?? [:]
            let result = try await api("realtime_token", body: body)
            guard (result["realtime_available"] as? Bool) == true,
                  let endpoint = result["url"] as? String,
                  let token = result["token"] as? String,
                  endpoint.hasPrefix("wss://"), !token.isEmpty else {
                realtimeConnected = false
                return
            }

            realtimeClient?.disconnect()
            let delegate = ServerRealtimeDelegate()
            delegate.publicationHandler = { [weak self] channel, data in
                Task { @MainActor [weak self] in
                    await self?.handleRealtimePublication(channel: channel, data: data)
                }
            }
            delegate.didConnect = { [weak self] in
                Task { @MainActor [weak self] in
                    guard let self, self.isSignedIn else { return }
                    do {
                        if let callID {
                            guard self.callId == callID else { return }
                            let snapshot = try await self.api("poll", body: ["call_id": callID, "after_seq": self.afterSeq])
                            try await self.processCallSnapshot(snapshot, callID: callID)
                        } else {
                            let snapshot = try await self.api("incoming", body: [:])
                            await self.handleIncomingRows(snapshot["calls"] as? [[String: Any]] ?? [])
                        }
                        self.realtimeConnected = true
                    } catch {
                        self.realtimeConnected = false
                        self.update("Realtime connected; database reconciliation will retry: \\(error.localizedDescription)", error: true)
                    }
                }
            }
            delegate.didDisconnect = { [weak self] in
                Task { @MainActor [weak self] in self?.realtimeConnected = false }
            }
            let config = CentrifugeClientConfig(
                name: "server-ios",
                version: "0.1.0",
                token: token,
                useNativeWebSocket: true,
                tokenGetter: { [weak self] _, completion in
                    guard let self else {
                        completion(.failure(ServerError.message("Server session is unavailable.")))
                        return
                    }
                    Task { @MainActor [weak self] in
                        guard let self else {
                            completion(.failure(ServerError.message("Server session is unavailable.")))
                            return
                        }
                        do {
                            let refreshed = try await self.api("realtime_token", body: body)
                            guard let newToken = refreshed["token"] as? String else {
                                throw ServerError.message("Realtime token refresh was not available.")
                            }
                            completion(.success(newToken))
                        } catch { completion(.failure(error)) }
                    }
                }
            )
            let client = CentrifugeClient(endpoint: endpoint, config: config, delegate: delegate)
            realtimeDelegate = delegate
            realtimeClient = client
            realtimeConnected = false
            client.connect()
        } catch {
            realtimeConnected = false
            update("Realtime service is unavailable; durable HTTP signalling remains enabled.", error: true)
        }
    }

    private func handleRealtimePublication(channel: String, data: Data) async {
        guard let message = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        let type = message["type"] as? String ?? ""
        if type == "incoming_call" {
            guard callId == nil, incomingCall == nil,
                  let call = message["call"] as? [String: Any],
                  let id = call["id"] as? String else { return }
            let caller = message["caller"] as? [String: Any] ?? [:]
            let label = caller["label"] as? String ?? "Server caller"
            let incoming = IncomingCall(id: id, phone: label)
            incomingCall = incoming
            try? await callKit.reportIncoming(id: id, callerName: label)
            return
        }
        guard let activeID = callId,
              (message["call_id"] as? String) == activeID else { return }
        switch type {
        case "signal":
            if let senderID = message["from_server_id"] as? String, senderID == serverID { return }
            let sequence = message["seq"] as? Int ?? 0
            guard sequence == 0 || sequence > afterSeq else { return }
            afterSeq = max(afterSeq, sequence)
            let signal: [String: Any] = [
                "seq": sequence,
                "kind": message["kind"] as? String ?? "",
                "payload": message["payload"] as? [String: Any] ?? [:]
            ]
            do { try await handle(signal) }
            catch { update("Realtime call signal failed: \\(error.localizedDescription)", error: true) }
        case "call_state":
            let state = message["state"] as? String ?? ""
            if ["ended", "failed", "missed"].contains(state) {
                callKit.reportEnded(id: activeID, reason: callKitEndReason(for: state))
                callId = nil
                pollingTask?.cancel()
                pollingTask = nil
                realtimeClient?.disconnect()
                realtimeClient = nil
                realtimeDelegate = nil
                realtimeConnected = false
                await endMedia()
                update("Call ended.")
                if isSignedIn { await connectRealtime() }
            }
        default:
            break
        }
    }

    private func processCallSnapshot(_ result: [String: Any], callID: String) async throws {
        let signals = result["signals"] as? [[String: Any]] ?? []
        for signal in signals {
            let sequence = signal["seq"] as? Int ?? 0
            if sequence <= afterSeq { continue }
            afterSeq = sequence
            try await handle(signal)
            if self.callId != callID { return }
        }
        afterSeq = max(afterSeq, result["next_after_seq"] as? Int ?? 0)
        let state = (result["call"] as? [String: Any])?["state"] as? String ?? ""
        if ["ended", "failed", "missed"].contains(state), self.callId == callID {
            callKit.reportEnded(id: callID, reason: callKitEndReason(for: state))
            self.callId = nil
            pollingTask?.cancel()
            pollingTask = nil
            realtimeClient?.disconnect()
            realtimeClient = nil
            realtimeDelegate = nil
            realtimeConnected = false
            await endMedia()
            update("Call ended.")
            if isSignedIn { await connectRealtime() }
        }
    }

    private func startCallPolling() {
        pollingTask?.cancel()
        pollingTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled, let id = self.callId {
                do {
                    if !self.realtimeConnected {
                        let result = try await self.api("poll", body: ["call_id": id, "after_seq": self.afterSeq])
                        try await self.processCallSnapshot(result, callID: id)
                    }
                } catch { self.update(error.localizedDescription, error: true) }
                try? await Task.sleep(for: .milliseconds(self.realtimeConnected ? 1000 : 700))
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
            if let id = callId { callKit.reportEnded(id: id, reason: .remoteEnded) }
            callId = nil
            pollingTask?.cancel()
            await endMedia()
            update("The other person ended the call.")
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
        guard accessToken != nil else { throw ServerError.message("Create a Server ID on this device first.") }
        let result = try await request("/functions/v1/server-auth", body: ["action": "refresh"], authorized: true, refresh: false)
        guard let access = result["access_token"] as? String else { throw ServerError.message("Session refresh failed; register this device again.") }
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
        config.supportedHandleTypes = [.phoneNumber, .generic]
        provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: nil)
    }

    func reportIncoming(id: String, phoneNumber: String? = nil, callerName: String? = nil) async throws {
        guard let uuid = UUID(uuidString: id) else { return }
        if handles[uuid] != nil { return }
        let rawPhone = (phoneNumber ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let safePhone = rawPhone.range(of: #"^\+[1-9][0-9]{7,14}$"#, options: .regularExpression) != nil
            ? rawPhone : nil
        let trimmedName = (callerName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let displayName = trimmedName.isEmpty ? "Server caller" : String(trimmedName.prefix(80))
        handles[uuid] = safePhone ?? displayName

        // The backend only supplies phoneNumber after caller verification AND
        // number-call consent. This preserves recipient Contacts resolution.
        // PushKit carries a display label, not a phone number: render it as a
        // generic Server handle so a person's name is never treated as E.164.
        let update = CXCallUpdate()
        if let safePhone {
            update.remoteHandle = CXHandle(type: .phoneNumber, value: safePhone)
        } else {
            update.remoteHandle = CXHandle(type: .generic, value: "Server")
            update.localizedCallerName = displayName
        }
        update.hasVideo = false
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

    func reportEnded(id: String, reason: CXCallEndedReason) {
        guard let uuid = UUID(uuidString: id), handles[uuid] != nil else { return }
        provider.reportCall(with: uuid, endedAt: Date(), reason: reason)
        handles.removeValue(forKey: uuid)
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
        let config = RTCConfiguration(); config.iceServers = servers.isEmpty ? [RTCIceServer(urlStrings: ["stun:stun.cloudflare.com:3478"]), RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"])] : servers
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


/**
 * PushKit wakes the iOS app for an incoming VoIP call even when it is backgrounded.
 * The callback is completed only after Server has asked CallKit to present the call.
 */
@MainActor
private final class ServerVoIPPushRegistry: NSObject, PKPushRegistryDelegate {
    private var registry: PKPushRegistry!
    var onToken: ((String) -> Void)?
    var onIncomingPush: (([String: Any], @escaping () -> Void) -> Void)?

    override init() {
        super.init()
        registry = PKPushRegistry(queue: .main)
        registry.delegate = self
        registry.desiredPushTypes = [.voIP]
    }

    func pushRegistry(_ registry: PKPushRegistry,
                      didUpdate credentials: PKPushCredentials,
                      for type: PKPushType) {
        guard type == .voIP else { return }
        let token = credentials.token.map { String(format: "%02x", $0) }.joined()
        // Persist even if PushKit delivers the token before the signed-in view model
        // installs its callback. The next authenticated launch registers it.
        UserDefaults.standard.set(token, forKey: "server.voip_push_token")
        onToken?(token)
    }

    func pushRegistry(_ registry: PKPushRegistry,
                      didInvalidatePushTokenFor type: PKPushType) {
        guard type == .voIP else { return }
        UserDefaults.standard.removeObject(forKey: "server.voip_push_token")
        UserDefaults.standard.removeObject(forKey: "server.voip_push_registered")
    }

    func pushRegistry(_ registry: PKPushRegistry,
                      didReceiveIncomingPushWith payload: PKPushPayload,
                      for type: PKPushType,
                      completion: @escaping () -> Void) {
        guard type == .voIP, let onIncomingPush else {
            completion()
            return
        }
        let stringPayload = payload.dictionaryPayload.reduce(into: [String: Any]()) { result, entry in
            if let key = entry.key as? String {
                result[key] = entry.value
            }
        }
        onIncomingPush(stringPayload, completion)
    }
}
