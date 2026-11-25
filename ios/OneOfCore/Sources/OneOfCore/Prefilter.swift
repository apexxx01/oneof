import Foundation

/// Orders the scan: posts with a life-detail cue go first so the crowd estimate moves early.
/// Ported from src/lib/prefilter.ts. Only empty and link-only posts are skipped.
private let SELF = JSRegex(#"\b(i|i'm|im|i've|ive|i'd|my|me|mine|we|our|us)\b"#, caseInsensitive: true)
private let CUES = JSRegex([
  "here in", "born", "raised", "moved", "live", "living", "hometown", "district", "city", "town", "village", "near", "walk along",
  "work", "job", "shift", "nurse", "engineer", "teacher", "doctor", "office", "hospital", "school", "college", "company", "promoted", "salary", "pay", "boss", "rota",
  "kid", "kids", "son", "daughter", "twins", "wife", "husband", "mom", "mum", "dad", "divorce", "ex", "married", "single", "baby", "sister", "brother", "cousin",
  "years", "turned", "birthday", "since", "volunteer", "marathon", "graduated", "batch", "degree", #"19\d\d"#, #"20\d\d"#,
  "car", "scooter", "bike", "subaru", "truck", "cat", "dog", "kindergarten", "icu", "tip", "speak", "language", "kannada", "hindi", "tamil", "telugu", "malayalam",
].joined(separator: "|"), caseInsensitive: true)
private let LINK_ONLY = JSRegex(#"^https?:\/\/\S+$"#)

public struct PrefilterResult: Equatable, Sendable { public let keep: Bool; public let reason: String }

public func prefilter(_ text: String) -> PrefilterResult {
  let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
  if t.utf16.count < 12 { return PrefilterResult(keep: false, reason: "too_short") }
  if LINK_ONLY.test(t) { return PrefilterResult(keep: false, reason: "link_only") }
  let s = SELF.test(t), c = CUES.test(t)
  if c && s { return PrefilterResult(keep: true, reason: "self+cue") }
  if c { return PrefilterResult(keep: true, reason: "cue") }
  return PrefilterResult(keep: false, reason: "no_disclosure_cue")
}

/// Scan order: fast pass (cue) first, then the rest; empty and link-only posts dropped.
public func scanOrder(_ posts: [Post]) -> (order: [Post], fastPass: Int, empty: Int) {
  let v = posts.map { ($0, prefilter($0.text)) }
  let scannable = v.filter { $0.1.reason != "too_short" && $0.1.reason != "link_only" }
  let fast = scannable.filter { $0.1.keep }.map(\.0)
  let deep = scannable.filter { !$0.1.keep }.map(\.0)
  return (fast + deep, fast.count, posts.count - scannable.count)
}

/// Lookups a base-rate refresh would send: one generic attribute each, filtered by cloudSafeAttribute.
public let LOOKUP_CATS: Set<String> = ["occupation", "employer_type", "education", "family", "relationship", "vehicle", "pet", "rare_hobby", "language", "age"]

public struct PlannedLookup: Equatable, Sendable, Identifiable {
  public var id: String { key }
  public let key: String
  public let fact: Fact
  public let attribute: String
}

public func plannedLookups(_ facts: [Fact], cache: [String: BaseRate]) -> [PlannedLookup] {
  let d = buildDossier(facts, extraRates: cache)
  let wanted = d.unresolved.filter { LOOKUP_CATS.contains($0.cat) }
    + d.attributes.filter { $0.rate.grade == .C && $0.rate.origin == .bundled }.map { $0.facts[0] }
  var seen = Set<String>(), out: [PlannedLookup] = []
  for f in wanted {
    let k = rateKey(cat: f.cat, value: f.value)
    if seen.contains(k) || cache[k] != nil { continue }
    seen.insert(k)
    if let a = cloudSafeAttribute(cat: f.cat, value: f.value).attribute { out.append(PlannedLookup(key: k, fact: f, attribute: a)) }
  }
  return out
}
