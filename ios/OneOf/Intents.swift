import AppIntents
import Observation

/// Text handed to the app by Siri, Shortcuts, Spotlight or the Action button.
@MainActor
@Observable
final class IntentInbox {
  static let shared = IntentInbox()
  var draft: String?
}

/// "Check a draft with OneOf": from Shortcuts, Siri, Spotlight or the Action button. Opens the
/// draft checker with the text filled in; the check itself runs on this iPhone only.
struct CheckDraftIntent: AppIntent {
  static var title: LocalizedStringResource = "Check a draft with OneOf"
  static var description = IntentDescription("See what a post gives away about you before you post it. Runs on this iPhone with Apple Intelligence; nothing is sent anywhere.")
  static var openAppWhenRun: Bool = true

  @Parameter(title: "Draft", inputOptions: String.IntentInputOptions(multiline: true))
  var draft: String

  @MainActor
  func perform() async throws -> some IntentResult {
    IntentInbox.shared.draft = draft
    return .result()
  }
}

struct OneOfShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: CheckDraftIntent(),
      phrases: ["Check a draft with \(.applicationName)", "Check my post with \(.applicationName)"],
      shortTitle: "Check a draft",
      systemImageName: "eye.slash")
  }
}
