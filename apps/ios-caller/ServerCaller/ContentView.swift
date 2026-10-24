import CallKit
import Intents
import SwiftUI
import UIKit

struct ContentView: View {
    @EnvironmentObject private var model: ServerViewModel
    @State private var acceptedTerms = false
    @State private var pendingSystemCallNumber = ""
    @State private var showSystemCallChoices = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header

                    if !model.isConfigured {
                        notice("This build is not connected to the Server backend. Configure the Server project before registering or calling.", warning: true)
                    }

                    if model.isSignedIn {
                        accountCard
                    } else {
                        setupCard
                    }

                    if !model.status.isEmpty {
                        notice(model.status, warning: model.isError)
                    }

                    if let incoming = model.incomingCall {
                        GroupBox("Incoming Server call") {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("Call from \(incoming.phone)")
                                HStack {
                                    Button("Decline", role: .destructive) {
                                        Task { await model.decline(incoming.id) }
                                    }
                                    .buttonStyle(.bordered)
                                    Button {
                                        Task { await model.accept(incoming) }
                                    } label: {
                                        Label("Answer", systemImage: "phone.fill")
                                            .frame(maxWidth: .infinity)
                                    }
                                    .buttonStyle(.borderedProminent)
                                    .tint(.green)
                                }
                            }
                            .padding(.vertical, 5)
                        }
                    }

                    GroupBox("How iPhone calling works") {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("The website remains the onboarding entry point. On iOS 18.2 and later, Apple supports a Default Calling App capability: once Apple authorizes Server’s entitlement and you choose Server as your default calling app, tapping a phone number in Contacts can open Server to handle the call.")
                            Text("iOS does not let third-party apps clone a SIM or add Server as a third cellular line. Server can offer an internet call or, after your explicit choice, hand the number back to the carrier.")
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 5)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 28)
            }
            .background(Color(red: 0.03, green: 0.07, blue: 0.12))
            .navigationBarHidden(true)
        }
        .confirmationDialog(
            pendingSystemCallNumber.isEmpty ? "Choose how to call" : "Call \(pendingSystemCallNumber) using…",
            isPresented: $showSystemCallChoices,
            titleVisibility: .visible
        ) {
            Button("Server · Internet call") { startServerCallForPendingNumber() }
            Button("Mobile carrier · Use cellular service") { returnToCarrierForPendingNumber() }
            Button("Cancel", role: .cancel) { pendingSystemCallNumber = "" }
        } message: {
            Text("Server is an internet-calling account, not a SIM/eSIM. A carrier call returns to iOS and may incur carrier charges.")
        }
        .onOpenURL { url in
            if url.scheme?.lowercased() == "tel" {
                handleSystemCallRequest(url.path)
            } else {
                Task { await model.handleAppHandoff(url) }
            }
        }
        .onContinueUserActivity("INStartCallIntent") { userActivity in
            // SiriKit places the resolved call intent on the activity's interaction.
            // The default calling-app Contacts path uses a tel: URL handled above.
            if let intent = userActivity.interaction?.intent as? INStartAudioCallIntent,
               let handle = intent.contacts?.first?.personHandle?.value,
               !handle.isEmpty {
                handleSystemCallRequest(handle)
            } else {
                model.status = "iOS opened Server for a calling request, but the resolved activity did not include a usable phone number."
                model.isError = true
            }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 13)
                .fill(Color.green)
                .frame(width: 48, height: 48)
                .overlay(
                    Image(systemName: "phone.fill")
                        .foregroundStyle(Color(red: 0.02, green: 0.12, blue: 0.08))
                        .font(.title2)
                )
            VStack(alignment: .leading, spacing: 2) {
                Text("SERVER")
                    .font(.headline)
                    .tracking(1.5)
                    .foregroundStyle(.green)
                Text("Calling, made natural")
                    .font(.title2.bold())
                    .foregroundStyle(.white)
            }
            Spacer(minLength: 0)
        }
        .padding(.bottom, 2)
    }

    private var setupCard: some View {
        GroupBox("Set up Server on this iPhone") {
            VStack(alignment: .leading, spacing: 12) {
                Text("Create a device-bound Server identity. iPhone does not expose SIM slots or SIM phone numbers to ordinary apps, so this setup does not pretend to select or clone a SIM.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Toggle(isOn: $acceptedTerms) {
                    Text("I accept the Terms of Service and acknowledge the Privacy Notice.")
                }
                .tint(.green)

                HStack {
                    Link("Terms of Service", destination: URL(string: "https://server-onboarding-ochre.vercel.app/terms.html")!)
                    Spacer()
                    Link("Privacy Notice", destination: URL(string: "https://server-onboarding-ochre.vercel.app/privacy.html")!)
                }
                .font(.caption)

                Button {
                    Task { await model.registerDevice() }
                } label: {
                    if model.isBusy {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Label("Create Server identity", systemImage: "person.crop.circle.badge.checkmark")
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .disabled(model.isBusy || !model.isConfigured || !acceptedTerms)
            }
            .padding(.vertical, 5)
        }
    }

    private var accountCard: some View {
        GroupBox("Your Server calling identity") {
            VStack(alignment: .leading, spacing: 10) {
                Text(model.serverID.isEmpty ? model.maskedPhone : model.serverID)
                    .font(.headline)
                    .foregroundStyle(.green)

                Text("Server is ready as an internet-calling account. It is not a second cellular line.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                if model.linkedPhone.isEmpty {
                    GroupBox("Link a mobile number for saved-contact calling") {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("This optional SMS check attaches a verified number to your existing Server ID, so other Server users can find you from their contacts. iPhone does not expose SIM slots. SMS verification requires a paired Server gateway and carrier charges may apply.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            TextField("Phone number, e.g. +2348012345678", text: $model.phoneLinkPhone)
                                .keyboardType(.phonePad)
                                .textContentType(.telephoneNumber)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .padding(12)
                                .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
                            Button {
                                Task { await model.requestPhoneLinkCode() }
                            } label: {
                                if model.isBusy {
                                    ProgressView().frame(maxWidth: .infinity)
                                } else {
                                    Label(model.phoneLinkCodeSent ? "Send code again" : "Send verification code", systemImage: "message")
                                        .frame(maxWidth: .infinity)
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.green)
                            .disabled(model.isBusy)
                            if model.phoneLinkCodeSent {
                                TextField("Six-digit SMS code", text: $model.phoneLinkCode)
                                    .keyboardType(.numberPad)
                                    .textContentType(.oneTimeCode)
                                    .padding(12)
                                    .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
                                Button {
                                    Task { await model.verifyAndLinkPhone() }
                                } label: {
                                    Label("Verify and link number", systemImage: "checkmark.shield")
                                        .frame(maxWidth: .infinity)
                                }
                                .buttonStyle(.borderedProminent)
                                .tint(.blue)
                                .disabled(model.isBusy || model.phoneLinkCode.count != 6)
                            }
                            if !model.phoneLinkStatus.isEmpty {
                                Text(model.phoneLinkStatus)
                                    .font(.footnote)
                                    .foregroundStyle(model.isError ? .orange : .green)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            Text("You can skip this step and still call by Server ID. Linking is needed for saved mobile numbers to resolve to your Server identity.")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 5)
                    }
                } else {
                    Label("Verified number linked: \(model.linkedPhone)", systemImage: "checkmark.seal.fill")
                        .font(.subheadline)
                        .foregroundStyle(.green)
                }

                if model.callId != nil {
                    Button(role: .destructive) {
                        Task { await model.endCall() }
                    } label: {
                        Label("End Server call", systemImage: "phone.down.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }

                if !model.guestInviteMessage.isEmpty {
                    ShareLink(item: model.guestInviteMessage) {
                        Label("Share guest invitation", systemImage: "message.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.blue)
                }

                Button("Sign out", role: .destructive) {
                    model.signOut()
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .padding(.vertical, 5)
        }
    }

    private func handleSystemCallRequest(_ rawNumber: String) {
        let number = rawNumber.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: " ", with: "")
        guard !number.isEmpty else {
            model.status = "The calling system did not supply a phone number."
            model.isError = true
            return
        }
        pendingSystemCallNumber = number
        showSystemCallChoices = true
    }

    private func startServerCallForPendingNumber() {
        let number = pendingSystemCallNumber
        pendingSystemCallNumber = ""
        guard !number.isEmpty else { return }
        guard model.isSignedIn else {
            model.status = "Complete Server setup first, then select Server from the Contacts calling flow again."
            model.isError = true
            return
        }
        model.targetPhone = number
        Task { await model.startCall() }
    }

    private func returnToCarrierForPendingNumber() {
        let number = pendingSystemCallNumber
        pendingSystemCallNumber = ""
        guard !number.isEmpty else { return }
        var components = URLComponents()
        components.scheme = "telephony"
        components.path = number
        guard let url = components.url else {
            model.status = "iOS could not return this number to the cellular carrier."
            model.isError = true
            return
        }
        // Apple documents the telephony URL as the explicit user-selected fallback.
        UIApplication.shared.open(url)
    }

    private func notice(_ text: String, warning: Bool) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(warning ? .orange : .green)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                (warning ? Color.orange : Color.green).opacity(0.10),
                in: RoundedRectangle(cornerRadius: 12)
            )
    }
}