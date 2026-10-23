import Intents
import SwiftUI

@main
struct ServerCallerApp: App {
    @StateObject private var model = ServerViewModel()
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .preferredColorScheme(.dark)
                .onOpenURL { url in
                    if url.scheme?.lowercased() == "tel" {
                        let raw = String(url.absoluteString.dropFirst("tel:".count))
                        let handle = raw.removingPercentEncoding ?? raw
                        Task { await model.startCallFromSystemHandle(handle) }
                    } else {
                        Task { await model.handleAppHandoff(url) }
                    }
                }
                // Apple's default-calling-app flow delivers INStartCallIntent
                // inside the NSUserActivity interaction. startCallHandle belongs
                // to LiveCommunicationKit.UserActivity, not NSUserActivity.
                .onContinueUserActivity("INStartCallIntent") { activity in
                    if #available(iOS 18.2, *) {
                        let intent = activity.interaction?.intent as? INStartCallIntent
                        let handle = intent?.contacts?
                            .compactMap { $0.personHandle?.value }
                            .first
                        guard let handle, !handle.isEmpty else {
                            Task { @MainActor in
                                model.explainDefaultCallingAppRequiresIOS182()
                            }
                            return
                        }
                        Task { await model.startCallFromSystemHandle(handle) }
                    } else {
                        model.explainDefaultCallingAppRequiresIOS182()
                    }
                }
        }
    }
}
