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
                    if !model.isConfigured {
                        notice("Connect Server to the new Supabase project by setting its URL and publishable key in the app build configuration.", warning: true)
                    }
                    if model.isSignedIn {
                        GroupBox("Call a number") {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("Signed in as \(model.maskedPhone)").font(.caption).foregroundStyle(.secondary)
                                TextField("+2348012345678", text: $model.targetPhone)
                                    .keyboardType(.phonePad).textInputAutocapitalization(.never)
                                    .padding(12).background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
                                Button { Task { await model.startCall() } } label: {
                                    Label("Call with Server", systemImage: "phone.fill").frame(maxWidth: .infinity)
                                }.buttonStyle(.borderedProminent).tint(.green).disabled(model.isBusy || model.callId != nil)
                                if model.callId == nil {
                                    Button { model.dialUsingCellularNetwork() } label: {
                                        Label("Use normal phone call (no data)", systemImage: "phone.arrow.up.right").frame(maxWidth: .infinity)
                                    }.buttonStyle(.bordered)
                                    Text("Fallback uses your existing SIM and carrier voice service. Mobile data is not required, but voice coverage and airtime are.")
                                        .font(.caption).foregroundStyle(.secondary)
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
                        GroupBox("Verify your phone") {
                            VStack(alignment: .leading, spacing: 12) {
                                TextField("+2348012345678", text: $model.phone)
                                    .keyboardType(.phonePad).textInputAutocapitalization(.never)
                                    .padding(12).background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
                                Button { Task { await model.requestOtp() } } label: {
                                    if model.isBusy { ProgressView().frame(maxWidth: .infinity) }
                                    else { Label("Send real SMS code", systemImage: "message.fill").frame(maxWidth: .infinity) }
                                }.buttonStyle(.borderedProminent).tint(.green).disabled(model.isBusy || !model.isConfigured)
                                TextField("Code received by SMS", text: $model.otp).keyboardType(.numberPad)
                                    .padding(12).background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
                                Button("Verify phone") { Task { await model.verifyOtp() } }
                                    .buttonStyle(.bordered).disabled(model.isBusy || model.otp.isEmpty)
                                Text("No code is invented by this app. Delivery requires the deployed Supabase SMS hook and an online, paired SIM gateway.")
                                    .font(.caption).foregroundStyle(.secondary)
                            }.padding(.vertical, 6)
                        }
                    }
                    if !model.status.isEmpty { notice(model.status, warning: model.isError) }
                    GroupBox("How Server calls work") {
                        Text("Server users connect by WebRTC. A non-Server number receives a guest link by SMS and must open it with internet and microphone access. Server is a calling service, not a third SIM; an ordinary cellular call without data requires a carrier voice connection.")
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
