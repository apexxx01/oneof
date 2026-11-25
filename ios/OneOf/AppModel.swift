import Foundation
import Observation
import OneOfCore

/// The synthetic persona bundled with the app (same file the web demo uses).
struct Persona: Decodable {
  struct P: Decodable { var id: String; var date: String; var text: String; var subreddit: String? }
  var id: String
  var handle: String
  var posts: [P]
  var draft: String?

  static func load() -> Persona? {
    guard let url = Bundle.main.url(forResource: "p1", withExtension: "json"), let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(Persona.self, from: data)
  }
  var asPosts: [Post] { posts.map { Post(id: $0.id, date: $0.date, text: $0.text, where: $0.subreddit) } }
}

struct ScanState {
  var data: DataKind = .synthetic
  var title = ""
  var total = 0
  var order: [Post] = []
  var fastPass = 0
  var empty = 0
  var done = 0
  var facts: [Fact] = []
  var rejected = 0
  var onDevice = 0
  var inCloud = 0
  var failed = 0
  var lastMs: Double = 0
  var current: Post?
  var running = false
  var blocked = false
  var startedAt: Date?
  var finishedAt: Date?
}

@MainActor
@Observable
final class AppModel {
  var ledger: [LedgerEntry] = []
  var status: OnDeviceStatus = .unknown
  var scan = ScanState()
  var rateCache: [String: BaseRate] = [:]
  var refreshing = false
  let persona = Persona.load()

  @ObservationIgnored private(set) var ai: AIService!
  @ObservationIgnored private var scanTask: Task<Void, Never>?

  init() {
    rateCache = RateCache.load()
    ai = AIService(record: { [weak self] e in self?.ledger.insert(e, at: 0) })
    refreshStatus()
  }

  func refreshStatus() { status = OnDeviceStatus.current() }

  var summary: LedgerSummary { summarize(ledger) }
  var dossier: Dossier { buildDossier(scan.facts, extraRates: rateCache) }

  // MARK: - Scan

  func startScan(posts: [Post], data: DataKind, title: String, limit: Int? = nil) {
    stopScan()
    refreshStatus()
    let o = scanOrder(posts)
    var st = ScanState()
    st.data = data; st.title = title; st.total = posts.count
    st.order = limit.map { Array(o.order.prefix($0)) } ?? o.order
    st.fastPass = min(o.fastPass, st.order.count); st.empty = o.empty
    st.running = true; st.startedAt = Date()
    scan = st
    scanTask = Task { [weak self] in await self?.runScan() }
  }

  func stopScan() {
    scanTask?.cancel()
    scanTask = nil
    if scan.running { scan.running = false; scan.current = nil; scan.finishedAt = Date() }
  }

  private func runScan() async {
    var retry: [Post] = []
    var streak = 0
    for (i, post) in scan.order.enumerated() {
      if Task.isCancelled { break }
      scan.current = post
      if await readOne(post) { streak = 0 } else {
        if scan.blocked { break }
        retry.append(post); streak += 1
      }
      scan.done = i + 1
      // The on-device model slows down under long sustained load; give it a breather.
      if streak >= 2 { try? await Task.sleep(nanoseconds: 8_000_000_000); streak = 0 }
    }
    if !Task.isCancelled && !scan.blocked {
      for post in retry {
        if Task.isCancelled { break }
        scan.current = post
        if !(await readOne(post)) { scan.failed += 1 }
      }
    }
    scan.current = nil
    scan.running = false
    scan.finishedAt = Date()
  }

  private func readOne(_ post: Post) async -> Bool {
    do {
      let r = try await ai.extract(post, data: scan.data)
      scan.facts.append(contentsOf: r.outcome.facts)
      scan.rejected += r.outcome.rejected
      scan.lastMs = r.ms
      if r.source == .on_device { scan.onDevice += 1 } else { scan.inCloud += 1 }
      return true
    } catch AIError.blocked {
      scan.blocked = true
      return false
    } catch {
      return false
    }
  }

  // MARK: - Base rates

  var plannedLookups: [PlannedLookup] { OneOfCore.plannedLookups(scan.facts, cache: rateCache) }

  func refineRates(_ plan: [PlannedLookup]) async {
    refreshing = true
    defer { refreshing = false }
    let country = dossier.region.key.hasPrefix("in") ? "India" : "United States"
    for item in plan {
      if let r = await ai.lookupBaseRate(item.fact, country: country) {
        rateCache[item.key] = r
        RateCache.save(rateCache)
      }
    }
  }

  func clearLedger() { ledger.removeAll() }
}

/// Base rates fetched from the cloud, kept on this device (one generic attribute each).
enum RateCache {
  private static let key = "oneof.baserates.v1"
  static func load() -> [String: BaseRate] {
    guard let d = UserDefaults.standard.data(forKey: key), let m = try? JSONDecoder().decode([String: BaseRate].self, from: d) else { return [:] }
    return m
  }
  static func save(_ m: [String: BaseRate]) {
    if let d = try? JSONEncoder().encode(m) { UserDefaults.standard.set(d, forKey: key) }
  }
}

/// Splits pasted text into posts: blank-line separated, or one per line if there are no blank lines.
func postsFromPaste(_ text: String) -> [Post] {
  let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
  let chunks = normalized.contains("\n\n") ? normalized.components(separatedBy: "\n\n") : normalized.components(separatedBy: "\n")
  let base = Date().addingTimeInterval(-Double(chunks.count) * 86_400)
  let iso = ISO8601DateFormatter()
  return chunks.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }.enumerated().map { i, t in
    Post(id: "own_\(i)", date: iso.string(from: base.addingTimeInterval(Double(i) * 86_400)), text: t)
  }
}
