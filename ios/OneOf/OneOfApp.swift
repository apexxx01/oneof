import FirebaseAppCheck
import FirebaseCore
import SwiftUI
import UIKit

/// Blocks third-party keyboards: with Full Access they could send typed drafts off the device.
final class AppDelegate: NSObject, UIApplicationDelegate {
  func application(_ application: UIApplication, shouldAllowExtensionPointIdentifier id: UIApplication.ExtensionPointIdentifier) -> Bool {
    id != .keyboard
  }
}

@main
struct OneOfApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  @State private var model: AppModel

  init() {
    FirebaseBoot.start()
    _model = State(initialValue: AppModel())
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(model)
        .preferredColorScheme(.dark)
        .tint(Theme.signal)
    }
  }
}

/// App Check first, then Firebase. The Gemini API is only reachable with a valid App Check token
/// (AI Logic is set to Enforced in the console), so a copied API key alone is useless.
enum FirebaseBoot {
  /// Which config the app started with; shown on the home screen so nobody is surprised.
  static private(set) var configSource = "not configured"

  static func start() {
    // Simulator: App Check debug provider with a registered token from Config/Secrets.xcconfig.
    // Real device: App Attest.
    #if targetEnvironment(simulator) && DEBUG
      if let token = Bundle.main.object(forInfoDictionaryKey: "OneOfAppCheckDebugToken") as? String,
         !token.isEmpty, !token.hasPrefix("$(") {
        setenv("AppCheckDebugToken", token, 1)
        UserDefaults.standard.set(token, forKey: "GACAppCheckDebugToken")
      }
    #endif
    AppCheck.setAppCheckProviderFactory(OneOfAppCheckFactory())

    if let path = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"),
       let options = FirebaseOptions(contentsOfFile: path) {
      FirebaseApp.configure(options: options)
      configSource = "GoogleService-Info.plist"
    } else {
      // Fallback: the project's public identifiers (the same ones the web build ships; they are
      // not secrets, App Check is what protects the API).
      let o = FirebaseOptions(googleAppID: "1:588996291286:ios:751adb175781288caf7777", gcmSenderID: "588996291286")
      o.apiKey = "AIzaSyDhMO0hC9Jn1qGNdpkFAql29nEOBdgzKRY"
      o.projectID = "oneof-8d62e"
      o.storageBucket = "oneof-8d62e.firebasestorage.app"
      o.bundleID = Bundle.main.bundleIdentifier ?? "io.github.apexxx01.oneof"
      FirebaseApp.configure(options: o)
      configSource = "built-in project IDs"
    }
  }
}

final class OneOfAppCheckFactory: NSObject, AppCheckProviderFactory {
  func createProvider(with app: FirebaseApp) -> AppCheckProvider? {
    #if targetEnvironment(simulator)
      return AppCheckDebugProvider(app: app)
    #else
      return AppAttestProvider(app: app)
    #endif
  }
}
