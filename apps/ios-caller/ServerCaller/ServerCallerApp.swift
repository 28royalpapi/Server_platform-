import SwiftUI

@main
struct ServerCallerApp: App {
    @StateObject private var model = ServerViewModel()
    var body: some Scene {
        WindowGroup { ContentView().environmentObject(model).preferredColorScheme(.dark) }
    }
}
