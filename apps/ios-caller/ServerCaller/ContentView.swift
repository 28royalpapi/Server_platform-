import AVFoundation
import SwiftUI
import UIKit
import WebKit

/// The iOS companion hosts the same website onboarding instead of exposing a
/// second native dial pad. The bridge only grants microphone access and creates
/// the device-bound Server identity; iOS does not expose SIM-slot selection.
struct ContentView: View {
    @EnvironmentObject private var model: ServerViewModel

    var body: some View {
        ServerOnboardingWebView(model: model)
            .ignoresSafeArea()
    }
}

private struct ServerOnboardingWebView: UIViewRepresentable {
    let model: ServerViewModel

    func makeCoordinator() -> Coordinator {
        Coordinator(model: model)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: "serverIOS")
        let bridgeScript = """
        (function () {
          window.ServerIOS = {
            requestCallPermissions: function () {
              window.webkit.messageHandlers.serverIOS.postMessage({method: "requestCallPermissions"});
            },
            completeSetup: function (acceptedTerms) {
              window.webkit.messageHandlers.serverIOS.postMessage({
                method: "completeSetup",
                acceptedTerms: !!acceptedTerms
              });
            }
          };
        })();
        """
        controller.addUserScript(WKUserScript(
            source: bridgeScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        configuration.userContentController = controller

        let webView = WKWebView(frame: .zero, configuration: configuration)
        context.coordinator.webView = webView
        webView.navigationDelegate = context.coordinator

        if let indexURL = Bundle.main.url(forResource: "index", withExtension: "html") {
            webView.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
        } else {
            webView.loadHTMLString(
                "<main style='font-family: system-ui; padding: 24px'><h1>Server</h1><p>Onboarding files were not included in this build. Rebuild Server from the repository.</p></main>",
                baseURL: nil
            )
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        private let model: ServerViewModel
        weak var webView: WKWebView?

        init(model: ServerViewModel) {
            self.model = model
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard message.name == "serverIOS",
                  message.frameInfo.isMainFrame,
                  let body = message.body as? [String: Any],
                  let method = body["method"] as? String else { return }

            switch method {
            case "requestCallPermissions":
                AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
                    self?.evaluateJavaScript(
                        "window.onServerCallPermissionResult && window.onServerCallPermissionResult(\(granted ? "true" : "false"), true);"
                    )
                }

            case "completeSetup":
                let acceptedTerms = body["acceptedTerms"] as? Bool ?? false
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    self.model.acceptedTerms = acceptedTerms
                    await self.model.registerDevice()
                    if self.model.isSignedIn {
                        self.deliverSetupResult(["ok": true, "serverId": self.model.serverID])
                    } else {
                        self.deliverSetupResult([
                            "ok": false,
                            "error": self.model.status.isEmpty ? "Server setup failed. Please try again." : self.model.status
                        ])
                    }
                }

            default:
                break
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            if url.isFileURL {
                decisionHandler(.allow)
                return
            }
            if url.scheme == "server" && url.host == "sim-setup" {
                decisionHandler(.cancel)
                Task { @MainActor in await model.handleAppHandoff(url) }
                return
            }
            if url.scheme == "https" && url.host == "server-onboarding-ochre.vercel.app" {
                decisionHandler(.cancel)
                if navigationAction.navigationType == .linkActivated {
                    UIApplication.shared.open(url)
                } else {
                    webView.load(URLRequest(url: url))
                }
                return
            }
            decisionHandler(.cancel)
            if navigationAction.navigationType == .linkActivated {
                UIApplication.shared.open(url)
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.evaluateJavaScript(
                "document.querySelectorAll('a[target=_blank]').forEach(function(a){a.target='_self';});",
                completionHandler: nil
            )
        }

        private func evaluateJavaScript(_ script: String) {
            DispatchQueue.main.async { [weak self] in
                self?.webView?.evaluateJavaScript(script, completionHandler: nil)
            }
        }

        private func deliverSetupResult(_ result: [String: Any]) {
            guard let data = try? JSONSerialization.data(withJSONObject: result),
                  let json = String(data: data, encoding: .utf8) else {
                evaluateJavaScript("window.onServerSetupResult && window.onServerSetupResult({ok:false,error:'Could not return the setup result.'});")
                return
            }
            evaluateJavaScript("window.onServerSetupResult && window.onServerSetupResult(\(json));")
        }
    }
}
