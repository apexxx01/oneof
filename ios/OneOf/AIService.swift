import FirebaseAILogic
import FirebaseCore
import Foundation
import OneOfCore

/// Apple Intelligence state, as Firebase AI Logic reports it for the on-device model.
enum OnDeviceStatus: Equatable {
  case available, notEligible, notEnabled, notReady, unknown

  static func current() -> OnDeviceStatus {
    let a = FirebaseAI.SystemLanguageModel.default.availability
    if case .available = a { return .available }
    if case .unavailable(.deviceNotEligible) = a { return .notEligible }
    if case .unavailable(.appleIntelligenceNotEnabled) = a { return .notEnabled }
    if case .unavailable(.modelNotReady) = a { return .notReady }
    return .unknown
  }

  var ok: Bool { self == .available }
  var label: String {
    switch self {
    case .available: return "Ready on this iPhone"
    case .notEligible: return "This device can't run Apple Intelligence"
    case .notEnabled: return "Turn on Apple Intelligence in Settings"
    case .notReady: return "Apple Intelligence is still downloading"
    case .unknown: return "On-device model unavailable"
    }
  }
}

enum AIError: LocalizedError {
  case blocked, timeout
  var errorDescription: String? {
    switch self {
    case .blocked: return "Apple Intelligence isn't available, and your own posts are never sent to the cloud."
    case .timeout: return "The model took too long."
    }
  }
}

struct ExtractResult {
  var outcome: ExtractOutcome
  var source: FactSource
  var ms: Double
  /// The model's raw reply, shown on the scan screen so a parsing problem is visible, not silent.
  var reply: String = ""
}

/// Every model call goes through here: route → model → ledger. Mirrors src/lib/ai.ts.
@MainActor
final class AIService {
  /// Hedged cloud chain, same as the web build: fast model first, bigger one on failure.
  static let cloudChain: [(model: String, timeout: Double)] = [("gemini-3.5-flash-lite", 12), ("gemini-3.5-flash", 45)]
  static let onDeviceBudget: Double = 30
  static let onDeviceName = "apple-foundation-models-system-language-model"

  private let ai = FirebaseAI.firebaseAI(backend: .googleAI(), useLimitedUseAppCheckTokens: true)
  private let record: (LedgerEntry) -> Void

  init(record: @escaping (LedgerEntry) -> Void) { self.record = record }

  // MARK: - Extraction (posts and drafts)

  func extract(_ post: Post, data: DataKind, task: AITask = .extract) async throws -> ExtractResult {
    let r = route(task, data)
    if r.mode == .onlyOnDevice && !OnDeviceStatus.current().ok {
      record(LedgerEntry(task: task, mode: r.mode, reason: r.reason, source: .blocked, ms: 0, sentToCloud: ""))
      throw AIError.blocked
    }
    // Prompt a1 (author's own privacy review): the de-anonymisation wording of the web prompt makes
    // Apple's on-device model return nothing. The checker downstream is identical on both clients.
    let prompt = extractPromptApple(post.text)
    let t0 = Date()
    do {
      let (text, model) = try await respond(mode: r.mode, instructions: EXTRACT_SYSTEM_APPLE, prompt: prompt, json: true)
      let ms = Date().timeIntervalSince(t0) * 1000
      let onDevice = model == Self.onDeviceName
      record(LedgerEntry(task: task, mode: r.mode, reason: r.reason, source: onDevice ? .on_device : .in_cloud, ms: ms,
                         sentToCloud: onDevice ? "" : prompt, model: onDevice ? nil : model))
      return ExtractResult(outcome: processReply(text, post: post, source: onDevice ? .on_device : .in_cloud), source: onDevice ? .on_device : .in_cloud, ms: ms, reply: text)
    } catch {
      let ms = Date().timeIntervalSince(t0) * 1000
      // A failed call that may have reached the cloud still sent the prompt; the ledger says so.
      let attempted = r.mode == .onlyInCloud || (r.mode == .preferOnDevice && !OnDeviceStatus.current().ok)
      record(LedgerEntry(task: task, mode: r.mode, reason: r.reason, source: .error, ms: ms, sentToCloud: attempted ? prompt : "",
                         error: String(describing: error).prefix(200).description))
      throw error
    }
  }

  // MARK: - Blur a draft (on-device only)

  struct Blurred: Decodable { var rewrite: String; var removed: [String]? }

  func blur(_ draft: String) async throws -> Blurred {
    let r = route(.blur, .own)
    guard OnDeviceStatus.current().ok else {
      record(LedgerEntry(task: .blur, mode: r.mode, reason: r.reason, source: .blocked, ms: 0, sentToCloud: ""))
      throw AIError.blocked
    }
    let t0 = Date()
    do {
      let (text, _) = try await respond(mode: .onlyOnDevice, instructions: BLUR_SYSTEM, prompt: draft, json: true)
      record(LedgerEntry(task: .blur, mode: r.mode, reason: r.reason, source: .on_device, ms: Date().timeIntervalSince(t0) * 1000, sentToCloud: ""))
      if let j = jsonObject(in: text), let data = j.data(using: .utf8), let b = try? JSONDecoder().decode(Blurred.self, from: data) { return b }
      return Blurred(rewrite: text.trimmingCharacters(in: .whitespacesAndNewlines), removed: nil)
    } catch {
      record(LedgerEntry(task: .blur, mode: r.mode, reason: r.reason, source: .error, ms: Date().timeIntervalSince(t0) * 1000, sentToCloud: "",
                         error: String(describing: error).prefix(200).description))
      throw error
    }
  }

  // MARK: - Base rates (cloud, one generic attribute)

  private var groundingOffUntil = Date.distantPast

  func lookupBaseRate(_ f: Fact, country: String) async -> BaseRate? {
    guard let attribute = cloudSafeAttribute(cat: f.cat, value: f.value).attribute else { return nil }
    let r = route(.baserate, .own)
    let payload = baseRatePrompt(attribute: attribute, country: country)
    for (i, tier) in Self.cloudChain.enumerated() {
      let grounded = Date() > groundingOffUntil
      let t0 = Date()
      do {
        let model = ai.generativeModel(
          modelName: tier.model,
          tools: grounded ? [.googleSearch()] : nil,
          systemInstruction: ModelContent(role: "system", parts: BASERATE_SYSTEM))
        let (text, url): (String?, String?) = try await withTimeout(tier.timeout) {
          let res = try await model.generateContent(payload)
          return (res.text, res.candidates.first?.groundingMetadata?.groundingChunks.compactMap { $0.web?.uri }.first)
        }
        record(LedgerEntry(task: .baserate, mode: r.mode, reason: r.reason, source: .in_cloud, ms: Date().timeIntervalSince(t0) * 1000,
                           sentToCloud: payload, model: tier.model))
        return parseBaseRate(text ?? "", cat: f.cat, value: f.value, sourceURL: url)
      } catch {
        let msg = String(describing: error)
        if msg.contains("429") || msg.lowercased().contains("quota") { groundingOffUntil = Date().addingTimeInterval(600) }
        record(LedgerEntry(task: .baserate, mode: r.mode, reason: r.reason, source: .error, ms: Date().timeIntervalSince(t0) * 1000,
                           sentToCloud: payload, model: tier.model, error: String(msg.prefix(200))))
        if i == Self.cloudChain.count - 1 { return nil }
      }
    }
    return nil
  }

  // MARK: - Plumbing

  /// One fresh session per call: no history leaks between posts, and the on-device context
  /// (about 4k tokens) never fills up.
  private func respond(mode: RouteMode, instructions: String, prompt: String, json: Bool) async throws -> (String, String) {
    let system = FirebaseAI.SystemLanguageModel.default
    let cloud = ai.geminiModel(name: Self.cloudChain[0].model)
    let session: GenerativeModelSession
    switch mode {
    case .onlyOnDevice: session = ai.generativeModelSession(model: system, instructions: instructions)
    case .preferOnDevice: session = ai.generativeModelSession(model: HybridModel(primary: system, secondary: cloud), instructions: instructions)
    case .onlyInCloud: session = ai.generativeModelSession(model: cloud, instructions: instructions)
    }
    let options = ResponseGenerationOptions.hybrid(
      gemini: GenerationConfig(temperature: 0, responseMIMEType: json ? "application/json" : nil),
      foundationModels: FirebaseAI.GenerationOptions(temperature: 0))
    let budget = mode == .onlyInCloud ? Self.cloudChain[0].timeout : Self.onDeviceBudget
    return try await withTimeout(budget) {
      let res = try await session.respond(to: prompt, options: options)
      return (res.content, res.rawResponse.modelVersion)
    }
  }
}

/// Races an operation against a deadline (the on-device model can stall under sustained load).
func withTimeout<T: Sendable>(_ seconds: Double, _ op: @escaping @Sendable () async throws -> T) async throws -> T {
  try await withThrowingTaskGroup(of: T.self) { group in
    group.addTask { try await op() }
    group.addTask {
      try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
      throw AIError.timeout
    }
    defer { group.cancelAll() }
    return try await group.next()!
  }
}
