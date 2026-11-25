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

enum AIError: LocalizedError, Equatable {
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
      let (raws, model, text) = try await respondFacts(mode: r.mode, prompt: prompt)
      let ms = Date().timeIntervalSince(t0) * 1000
      let onDevice = model == Self.onDeviceName
      // Enforced, not just routed: an own-data answer that didn't come from the on-device model is discarded.
      if r.mode == .onlyOnDevice && !onDevice {
        record(LedgerEntry(task: task, mode: r.mode, reason: r.reason, source: .blocked, ms: ms, sentToCloud: "", error: "answer did not come from the on-device model; discarded"))
        throw AIError.blocked
      }
      record(LedgerEntry(task: task, mode: r.mode, reason: r.reason, source: onDevice ? .on_device : .in_cloud, ms: ms,
                         sentToCloud: onDevice ? "" : prompt, model: onDevice ? nil : model, data: data))
      let outcome = raws.map { processFacts($0, post: post, source: onDevice ? .on_device : .in_cloud) }
        ?? processReply(text, post: post, source: onDevice ? .on_device : .in_cloud)
      return ExtractResult(outcome: outcome, source: onDevice ? .on_device : .in_cloud, ms: ms, reply: text)
    } catch let e as AIError where e == .blocked {
      throw e
    } catch let error where error is CancellationError || Task.isCancelled {
      throw CancellationError()
    } catch {
      let ms = Date().timeIntervalSince(t0) * 1000
      // HybridModel falls back to Gemini on any on-device error, so any non-on-device route may have
      // sent the prompt. The ledger assumes it did.
      let attempted = r.mode != .onlyOnDevice
      record(LedgerEntry(task: task, mode: r.mode, reason: r.reason, source: .error, ms: ms, sentToCloud: attempted ? prompt : "",
                         error: String(describing: error).prefix(200).description, data: data))
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
      let (text, model) = try await respond(mode: .onlyOnDevice, instructions: BLUR_SYSTEM_APPLE, prompt: "Draft:\n\(draft)", json: false, transform: true)
      if model != Self.onDeviceName { throw AIError.blocked }
      record(LedgerEntry(task: .blur, mode: r.mode, reason: r.reason, source: .on_device, ms: Date().timeIntervalSince(t0) * 1000, sentToCloud: ""))
      var out = text.trimmingCharacters(in: .whitespacesAndNewlines)
      if out.hasPrefix("\""), out.hasSuffix("\""), out.count > 1 { out = String(out.dropFirst().dropLast()) }
      return Blurred(rewrite: out, removed: nil)
    } catch let error where error is CancellationError || Task.isCancelled {
      throw CancellationError()
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

  /// Typed generation first (@Generable). If the model can't produce the schema, one retry as free
  /// text through the tolerant parser. Returns (facts if typed, model name, raw text if text).
  private func respondFacts(mode: RouteMode, prompt: String) async throws -> ([RawFact]?, String, String) {
    let session = makeSession(mode: mode, instructions: EXTRACT_SYSTEM_APPLE)
    let options = Self.options(json: true)
    let budget = mode == .onlyInCloud ? Self.cloudChain[0].timeout : Self.onDeviceBudget
    do {
      return try await withTimeout(budget) {
        let res = try await session.respond(to: prompt, generating: GFactBatch.self, includeSchemaInPrompt: true, options: options)
        return (res.content.rawFacts, res.rawResponse.modelVersion, "")
      }
    } catch let e as AIError {
      throw e
    } catch let error where error is CancellationError || Task.isCancelled {
      throw CancellationError()
    } catch {
      let (text, model) = try await respond(mode: mode, instructions: EXTRACT_SYSTEM_APPLE, prompt: prompt, json: true)
      return (nil, model, text)
    }
  }

  private func makeSession(mode: RouteMode, instructions: String, transform: Bool = false) -> GenerativeModelSession {
    let system = transform ? FirebaseAI.SystemLanguageModel(useCase: .general, guardrails: .permissiveContentTransformations) : FirebaseAI.SystemLanguageModel.default
    let cloud = ai.geminiModel(name: Self.cloudChain[0].model)
    switch mode {
    case .onlyOnDevice: return ai.generativeModelSession(model: system, instructions: instructions)
    case .preferOnDevice: return ai.generativeModelSession(model: HybridModel(primary: system, secondary: cloud), instructions: instructions)
    case .onlyInCloud: return ai.generativeModelSession(model: cloud, instructions: instructions)
    }
  }

  private static func options(json: Bool) -> ResponseGenerationOptions {
    ResponseGenerationOptions.hybrid(
      gemini: GenerationConfig(temperature: 0, responseMIMEType: json ? "application/json" : nil),
      foundationModels: FirebaseAI.GenerationOptions(sampling: .greedy))
  }

  /// One fresh session per call: no history leaks between posts, and the on-device context
  /// (about 4k tokens) never fills up.
  private func respond(mode: RouteMode, instructions: String, prompt: String, json: Bool, transform: Bool = false) async throws -> (String, String) {
    // Rewriting the user's own text is what the permissive-transformations guardrail exists for.
    let session = makeSession(mode: mode, instructions: instructions, transform: transform)
    let options = Self.options(json: json)
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
