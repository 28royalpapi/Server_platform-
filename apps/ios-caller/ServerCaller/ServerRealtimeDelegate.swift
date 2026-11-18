import Foundation
import SwiftCentrifuge

/// Receives server-authorized publications from Centrifugo's server-side
/// subscriptions. Delegate callbacks run on the SDK queue; handlers must hop
/// asynchronously to the app's main actor before touching ServerViewModel.
final class ServerRealtimeDelegate: CentrifugeClientDelegate {
    var didConnect: (() -> Void)?
    var didDisconnect: (() -> Void)?
    var publicationHandler: ((String, Data) -> Void)?

    func onConnected(_ client: CentrifugeClient, _ event: CentrifugeConnectedEvent) {
        didConnect?()
    }

    func onDisconnected(_ client: CentrifugeClient, _ event: CentrifugeDisconnectedEvent) {
        didDisconnect?()
    }

    func onPublication(_ client: CentrifugeClient, _ event: CentrifugeServerPublicationEvent) {
        publicationHandler?(event.channel, event.data)
    }

    func onError(_ client: CentrifugeClient, _ event: CentrifugeErrorEvent) {
        // Do not log auth tokens or socket headers.
    }
}
