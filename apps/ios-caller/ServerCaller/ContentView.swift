import Contacts
import SwiftUI
import UIKit

private struct SavaContact: Identifiable {
    let id: String
    let name: String
    let number: String
}

private enum SavaTab: String, CaseIterable {
    case keypad = "Keypad"
    case contacts = "Contacts"
    case account = "Sava Call"
}

struct ContentView: View {
    @EnvironmentObject private var model: ServerViewModel
    @State private var selectedTab: SavaTab = .keypad
    @State private var number = ""
    @State private var contactSearch = ""
    @State private var contacts: [SavaContact] = []
    @State private var contactMessage = "Allow Contacts access to see the people saved on this iPhone."
    @State private var hasLoadedContacts = false
    @State private var showCallChoices = false

    private let digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "⌫"]

    private var filteredContacts: [SavaContact] {
        guard !contactSearch.isEmpty else { return contacts }
        return contacts.filter {
            $0.name.localizedCaseInsensitiveContains(contactSearch) ||
            $0.number.localizedCaseInsensitiveContains(contactSearch)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Picker("Sava Call sections", selection: $selectedTab) {
                ForEach(SavaTab.allCases, id: \.self) { tab in
                    Text(tab.rawValue).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .padding(.bottom, 8)

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if !model.status.isEmpty {
                        Text(model.status)
                            .font(.footnote)
                            .foregroundStyle(model.isError ? .orange : .green)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background((model.isError ? Color.orange : Color.green).opacity(0.10),
                                        in: RoundedRectangle(cornerRadius: 12))
                    }

                    switch selectedTab {
                    case .keypad:
                        keypadPanel
                    case .contacts:
                        contactsPanel
                    case .account:
                        accountPanel
                    }

                    if let incoming = model.incomingCall {
                        GroupBox("Incoming Sava Call") {
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
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 28)
            }
        }
        .background(Color(red: 0.03, green: 0.07, blue: 0.12).ignoresSafeArea())
        .preferredColorScheme(.dark)
        .confirmationDialog("Choose how to call", isPresented: $showCallChoices, titleVisibility: .visible) {
            Button("Sava Call · Internet calling") { startSavaCall() }
            Button("Carrier call · iPhone chooses the line") { placeCarrierCall() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Sava Call needs an active Sava Call identity and internet access. Apple does not let third-party apps force a specific cellular SIM; carrier calls continue through iOS.")
        }
        .onOpenURL { url in
            Task { await model.handleAppHandoff(url) }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 14)
                .fill(Color.green)
                .frame(width: 48, height: 48)
                .overlay(
                    Image(systemName: "phone.fill")
                        .font(.title2)
                        .foregroundStyle(Color(red: 0.02, green: 0.12, blue: 0.08))
                )
            VStack(alignment: .leading, spacing: 2) {
                Text("SAVA CALL")
                    .font(.headline)
                    .tracking(1.5)
                    .foregroundStyle(.green)
                Text("Your calls. Your choice.")
                    .font(.title3.bold())
                    .foregroundStyle(.white)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18)
        .padding(.top, 12)
        .padding(.bottom, 4)
    }

    private var keypadPanel: some View {
        VStack(spacing: 14) {
            TextField("Phone number or SVR-… ID", text: $number)
                .font(.title3)
                .keyboardType(.default)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .padding(14)
                .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 3), spacing: 10) {
                ForEach(digits, id: \.self) { digit in
                    Button {
                        if digit == "⌫" {
                            if !number.isEmpty { number.removeLast() }
                        } else {
                            number.append(digit)
                        }
                    } label: {
                        Text(digit)
                            .font(.title2)
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 56)
                            .background(Color.white.opacity(0.08), in: Circle())
                    }
                    .buttonStyle(.plain)
                }
            }

            Button {
                guard !number.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    model.status = "Enter a number or choose someone from Contacts first."
                    model.isError = true
                    return
                }
                showCallChoices = true
            } label: {
                Label("Choose how to call", systemImage: "phone.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)
        }
    }

    private var contactsPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Contacts")
                .font(.title2.bold())
            Text("Contacts are read from this iPhone and are not uploaded to Sava Call.")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Search name or number", text: $contactSearch)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            .padding(12)
            .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))

            if !hasLoadedContacts || contacts.isEmpty {
                Text(contactMessage)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 6)
                Button {
                    loadContacts()
                } label: {
                    Label("Allow access to contacts", systemImage: "person.crop.circle.badge.checkmark")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
            }

            LazyVStack(spacing: 0) {
                ForEach(filteredContacts) { contact in
                    Button {
                        number = contact.number
                        showCallChoices = true
                    } label: {
                        HStack(spacing: 12) {
                            Circle()
                                .fill(Color.green.opacity(0.18))
                                .frame(width: 42, height: 42)
                                .overlay(Text(initials(contact.name)).font(.headline).foregroundStyle(.green))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(contact.name).font(.body.weight(.medium)).foregroundStyle(.white)
                                Text(contact.number).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "phone").foregroundStyle(.green)
                        }
                        .padding(.vertical, 10)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Divider().overlay(Color.white.opacity(0.06))
                }
            }
        }
        .onAppear {
            if !hasLoadedContacts { loadContacts() }
        }
    }

    private var accountPanel: some View {
        VStack(alignment: .leading, spacing: 14) {
            if model.isSignedIn {
                GroupBox("Your Sava Call identity") {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(model.serverID.isEmpty ? model.maskedPhone : model.serverID)
                            .font(.headline)
                            .foregroundStyle(.green)
                        Text("Sava Call uses internet audio. It is not a cloned SIM or cellular line.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("SVR-… ID or phone number", text: $model.targetPhone)
                            .keyboardType(.default)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .padding(12)
                            .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
                        Button {
                            Task { await model.startCall() }
                        } label: {
                            Label("Start Sava Call", systemImage: "phone.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.green)
                        .disabled(model.isBusy || model.callId != nil)

                        if model.callId != nil {
                            Button(role: .destructive) {
                                Task { await model.endCall() }
                            } label: {
                                Label("End call", systemImage: "phone.down.fill")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                        }
                        if !model.guestInviteMessage.isEmpty {
                            ShareLink(item: model.guestInviteMessage) {
                                Label("Share guest invitation", systemImage: "message.fill")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                        }
                        Button("Sign out", role: .destructive) { model.signOut() }
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                    .padding(.vertical, 5)
                }
            } else {
                GroupBox("Set up Sava Call") {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Create a private Sava Call identity to place internet calls. iOS does not let ordinary apps read SIM slots or set a third cellular line.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Toggle(isOn: $model.acceptedTerms) {
                            Text("I accept the Terms of Service and acknowledge the Privacy Notice.")
                        }
                        .tint(.green)
                        HStack {
                            Link("Terms", destination: URL(string: "https://server-onboarding-ochre.vercel.app/terms.html")!)
                            Spacer()
                            Link("Privacy", destination: URL(string: "https://server-onboarding-ochre.vercel.app/privacy.html")!)
                        }
                        .font(.caption)
                        Button {
                            Task { await model.registerDevice() }
                        } label: {
                            if model.isBusy {
                                ProgressView().frame(maxWidth: .infinity)
                            } else {
                                Label("Create Sava Call identity", systemImage: "person.crop.circle.badge.checkmark")
                                    .frame(maxWidth: .infinity)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.green)
                        .disabled(model.isBusy || !model.isConfigured || !model.acceptedTerms)
                    }
                    .padding(.vertical, 5)
                }
            }

            if !model.isConfigured {
                Text("This build is not configured to connect to the Server backend.")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
            Text("Server-to-Server calls use WebRTC. Calling a non-Sava number does not create a carrier call; it may require an internet guest invitation.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func startSavaCall() {
        let target = number.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !target.isEmpty else { return }
        guard model.isSignedIn else {
            selectedTab = .account
            model.status = "Create your Sava Call identity before placing an internet call."
            model.isError = true
            return
        }
        model.targetPhone = target
        selectedTab = .account
        Task { await model.startCall() }
    }

    private func placeCarrierCall() {
        let cleaned = number.filter { $0.isNumber || $0 == "+" || $0 == "*" || $0 == "#" }
        guard !cleaned.isEmpty, !number.uppercased().hasPrefix("SVR-") else {
            model.status = "A carrier call requires a telephone number, not a Server ID."
            model.isError = true
            return
        }
        guard let url = URL(string: "tel:\(cleaned)") else {
            model.status = "The phone number is not valid for a carrier call."
            model.isError = true
            return
        }
        UIApplication.shared.open(url)
    }

    private func loadContacts() {
        let store = CNContactStore()
        let authorization = CNContactStore.authorizationStatus(for: .contacts)

        if authorization == .authorized {
            readContacts(store)
            return
        }
        if #available(iOS 18.0, *), authorization == .limited {
            readContacts(store)
            return
        }
        if authorization == .notDetermined {
            store.requestAccess(for: .contacts) { granted, _ in
                DispatchQueue.main.async {
                    if granted {
                        readContacts(store)
                    } else {
                        hasLoadedContacts = true
                        contactMessage = "Contacts access was denied. You can still type a number or change permission in iPhone Settings."
                    }
                }
            }
            return
        }
        hasLoadedContacts = true
        contactMessage = "Contacts access is off. Enable it in iPhone Settings, or type a number on the Keypad tab."
    }

    private func readContacts(_ store: CNContactStore) {
        let keys: [CNKeyDescriptor] = [
            CNContactIdentifierKey as CNKeyDescriptor,
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor
        ]
        let request = CNContactFetchRequest(keysToFetch: keys)
        request.sortOrder = .userDefault
        var loaded: [SavaContact] = []
        do {
            try store.enumerateContacts(with: request) { contact, _ in
                let fullName = [contact.givenName, contact.familyName]
                    .filter { !$0.isEmpty }
                    .joined(separator: " ")
                let name = fullName.isEmpty ? "Unnamed contact" : fullName
                for item in contact.phoneNumbers {
                    let phone = item.value.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !phone.isEmpty {
                        loaded.append(SavaContact(
                            id: contact.identifier + "|" + phone,
                            name: name,
                            number: phone
                        ))
                    }
                }
            }
            contacts = loaded.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            hasLoadedContacts = true
            contactMessage = loaded.isEmpty
                ? "No phone-number contacts were found. You can still enter a number on the Keypad tab."
                : "Loaded \(loaded.count) phone-number entries. They stay on this iPhone."
        } catch {
            hasLoadedContacts = true
            contactMessage = "Could not read contacts: \(error.localizedDescription)"
        }
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ")
        return String(parts.prefix(2).compactMap(\.first))
    }
}
