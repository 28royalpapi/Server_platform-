import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: ServerViewModel
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 12) {
                        RoundedRectangle(cornerRadius: 13).fill(Color.green).frame(width: 48, height: 48)
                            .overlay(Image(systemName: "phone.fill").foregroundStyle(Color(red: 0.02, green: 0.12, blue: 0.08)).font(.title2))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("SERVER").font(.headline).tracking(1.5).foregroundStyle(.green)
                            Text("Calling, made natural").font(.title2.bold())
                        }
                    }.padding(.top, 12)
                    GroupBox("iPhone calling support") {
                        Text("iOS does not allow Server to appear beside SIM 1 and SIM 2 as a third carrier line. On iOS/iPadOS 18.2 or later, an app build with Apple's Default Calling App entitlement can be selected as the default handler for calls from Contacts. This source includes the integration code; the entitlement must be available in the signed provisioning profile and the default-app route still needs device testing.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    if !model.isConfigured {
                        notice("Connect Server to the new Supabase project by setting its URL and publishable key in the app build configuration.", warning: true)
                    }
                    if model.isSignedIn {
                        GroupBox("Call a number") {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("Signed in as \(model.maskedPhone)").font(.caption).foregroundStyle(.secondary)
                                TextField("SVR-0123456789 or +2348012345678", text: $model.targetPhone)
                                    .keyboardType(.phonePad).textInputAutocapitalization(.never)
                                    .padding(12).background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
                                Button { Task { await model.startCall() } } label: {
                                    Label("Call with Server", systemImage: "phone.fill").frame(maxWidth: .infinity)
                                }.buttonStyle(.borderedProminent).tint(.green).disabled(model.isBusy || model.callId != nil)
                                if !model.guestInviteMessage.isEmpty {
                                    ShareLink(item: model.guestInviteMessage) {
                                        Label("Share guest invitation", systemImage: "message.fill").frame(maxWidth: .infinity)
                                    }.buttonStyle(.borderedProminent).tint(.blue)
                                }
                                if model.callId != nil {
                                    Button(role: .destructive) { Task { await model.endCall() } } label: {
                                        Label("End call", systemImage: "phone.down.fill").frame(maxWidth: .infinity)
                                    }.buttonStyle(.bordered)
                                }
                                Button("Sign out", role: .destructive) { model.signOut() }.frame(maxWidth: .infinity, alignment: .trailing)
                            }.padding(.vertical, 6)
                        }
                        if let incoming = model.incomingCall {
                            GroupBox("Incoming Server call") {
                                VStack(alignment: .leading, spacing: 10) {
                                    Text("Call from \(incoming.phone)")
                                    HStack {
                                        Button("Decline", role: .destructive) { Task { await model.decline(incoming.id) } }.buttonStyle(.bordered)
                                        Button { Task { await model.accept(incoming) } } label: { Label("Answer", systemImage: "phone.fill") }
                                            .buttonStyle(.borderedProminent).tint(.green)
                                    }
                                }.padding(.vertical, 6)
                            }
                        }
                    } else {
                        GroupBox("Set up Server on this iPhone") {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("Create a device-bound Server ID without an SMS OTP. iOS does not allow ordinary apps to enumerate SIM slots or read SIM phone numbers; your mobile number stays with your carrier.")
                                    .font(.subheadline).foregroundStyle(.secondary)
                                Toggle(isOn: $model.acceptedTerms) {
                                    Text("I accept the Terms of Service and acknowledge the Privacy Notice.")
                                }.tint(.green)
                                HStack {
                                    Link("Terms of Service", destination: URL(string: "https://server-onboarding-ochre.vercel.app/terms.html")!)
                                    Spacer()
                                    Link("Privacy Notice", destination: URL(string: "https://server-onboarding-ochre.vercel.app/privacy.html")!)
                                }.font(.caption)
                                Button { Task { await model.registerDevice() } } label: {
                                    if model.isBusy { ProgressView().frame(maxWidth: .infinity) }
                                    else { Label("Create Server ID — no SMS OTP", systemImage: "person.crop.circle.badge.checkmark").frame(maxWidth: .infinity) }
                                }.buttonStyle(.borderedProminent).tint(.green).disabled(model.isBusy || !model.isConfigured || !model.acceptedTerms)
                            }.padding(.vertical, 6)
                        }
                    }
                    if !model.status.isEmpty { notice(model.status, warning: model.isError) }
                    GroupBox("How Server calls work") {
                        Text("Call another Server user with their Server ID (for example SVR-0123456789). A non-Server number still needs a guest invitation and internet to join; SMS invitations require a paired gateway. Server is an internet-calling service, not a copied SIM or a cellular line.")
                            .font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 5)
                    }
                }.padding(.horizontal, 16).padding(.bottom, 28)
            }
            .background(Color(red: 0.03, green: 0.07, blue: 0.12))
            .navigationBarHidden(true)
        }
    }

    private func notice(_ text: String, warning: Bool) -> some View {
        Text(text).font(.footnote).foregroundStyle(warning ? .orange : .green)
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background((warning ? Color.orange : Color.green).opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
    }
}
