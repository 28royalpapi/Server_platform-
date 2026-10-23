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
                    Task { await model.handleAppHandoff(url) }
                }
                .onContinueUserActivity("INStartCallIntent") { activity in
                    if #available(iOS 18.2, *) {
                        let handle = activity.startCallHandle
                        Task { await model.startCallFromSystemHandle(handle) }
                    } else {
                        model.explainDefaultCallingAppRequiresIOS182()
                    }
                }
        }
    }
}
