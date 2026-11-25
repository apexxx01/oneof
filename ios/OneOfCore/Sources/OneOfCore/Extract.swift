import Foundation

/// Pure half of extraction: model text in, verified facts out. No model, no network,
/// so it runs in tests on any platform.

private struct FactBatch: Decodable { var facts: [LooseFact] }


/// The on-device model sometimes returns `p` as a string or misses `certainty`; accept what is
/// unambiguous, drop the rest. The checker (verify) is what decides whether a fact counts.
private struct LooseFact: Decodable {
  var p: Int?; var cat: String?; var value: String?; var quote: String?; var about_self: Bool?; var certainty: String?
  enum K: String, CodingKey { case p, cat, value, quote, about_self, certainty }
  init(from d: Decoder) throws {
    let c = try d.container(keyedBy: K.self)
    p = (try? c.decode(Int.self, forKey: .p)) ?? (try? c.decode(String.self, forKey: .p)).flatMap { Int($0) }
    cat = try? c.decode(String.self, forKey: .cat)
    value = try? c.decode(String.self, forKey: .value)
    quote = try? c.decode(String.self, forKey: .quote)
    about_self = (try? c.decode(Bool.self, forKey: .about_self)) ?? (try? c.decode(String.self, forKey: .about_self)).map { $0.lowercased() == "true" }
    certainty = try? c.decode(String.self, forKey: .certainty)
  }
}

/// Pulls the JSON object out of a model reply (handles ```json fences and chatter around it).
public func jsonObject(in text: String) -> String? {
  let brace = text.firstIndex(of: "{"), bracket = text.firstIndex(of: "[")
  // A bare array of facts ("[{...}]") is accepted too.
  if let k = bracket, brace == nil || k < brace!, let e = text.lastIndex(of: "]"), k < e { return String(text[k...e]) }
  guard let a = brace, let b = text.lastIndex(of: "}"), a < b else { return nil }
  return String(text[a...b])
}

/// "Occupation", "home location", "home-location" all mean home_location.
func normalizeCategory(_ c: String) -> String {
  c.lowercased().trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: " ", with: "_").replacingOccurrences(of: "-", with: "_")
}

/// Parsed facts plus how many entries were too malformed to check (missing quote, unknown category...).
public func parseFactBatchCounting(_ text: String) -> (facts: [RawFact], malformed: Int)? {
  guard let json = jsonObject(in: text), let data = json.data(using: .utf8) else { return nil }
  let batch: FactBatch
  if let b = try? JSONDecoder().decode(FactBatch.self, from: data) { batch = b }
  else if let arr = try? JSONDecoder().decode([LooseFact].self, from: data) { batch = FactBatch(facts: arr) }
  else { return nil }
  var malformed = 0
  let facts: [RawFact] = batch.facts.compactMap { f in
    guard let rawCat = f.cat, case let cat = normalizeCategory(rawCat), CATEGORIES.contains(cat),
          let value = f.value, !value.isEmpty, let quote = f.quote, !quote.isEmpty, let about = f.about_self else { malformed += 1; return nil }
    let certainty = (f.certainty?.lowercased() == "implied") ? "implied" : "stated"
    return RawFact(p: f.p ?? 0, cat: cat, value: String(value.prefix(120)), quote: String(quote.prefix(300)), about_self: about, certainty: certainty)
  }
  return (facts, malformed)
}

public func parseFactBatch(_ text: String) -> [RawFact]? { parseFactBatchCounting(text)?.facts }

public struct RawVerdict: Codable, Equatable, Sendable {
  public var cat: String; public var value: String; public var aboutSelf: Bool; public var certainty: String; public var why: String
}

public struct ExtractOutcome: Equatable, Sendable {
  public var facts: [Fact]
  public var rejected: Int
  public var raw: [RawVerdict]
  /// The model's reply could not be read as JSON at all.
  public var unreadable: Bool
  /// Entries dropped before the checker because a field was missing or unknown.
  public var malformed: Int = 0
}

/// Model reply for ONE post → verified facts, exactly as the web build does it (ai.ts extractFromPost).
public func processReply(_ reply: String, post: Post, source: FactSource) -> ExtractOutcome {
  guard let (raws, malformed) = parseFactBatchCounting(reply) else { return ExtractOutcome(facts: [], rejected: 0, raw: [], unreadable: true) }
  var o = processFacts(raws, post: post, source: source)
  o.malformed = malformed
  return o
}

/// Already-structured facts (typed generation) → verified facts. The deterministic checker is the
/// same single gate whichever way the model answered.
public func processFacts(_ raws: [RawFact], post: Post, source: FactSource) -> ExtractOutcome {
  var facts: [Fact] = [], raw: [RawVerdict] = [], rejected = 0
  for f in raws where f.p == 0 {
    let v = verify(f, post)
    raw.append(RawVerdict(cat: f.cat, value: String(f.value.prefix(60)), aboutSelf: f.about_self, certainty: f.certainty, why: v.ok ? "ok" : (v.why ?? "rejected")))
    if !v.ok { rejected += 1; continue }
    facts.append(Fact(id: "\(post.id):\(facts.count)", postId: post.id, date: post.date, cat: f.cat, value: String(f.value.prefix(60)),
                      quote: String(f.quote.prefix(160)), certainty: f.certainty, source: source))
  }
  return ExtractOutcome(facts: facts, rejected: rejected, raw: raw, unreadable: false)
}

/// Cloud base-rate reply → BaseRate. Grade B only when grounded (a source came back), else C,
/// and a C rate is shown but never counted (see isCited).
public func parseBaseRate(_ reply: String, cat: String, value: String, sourceURL: String?) -> BaseRate? {
  guard let json = jsonObject(in: reply), let data = json.data(using: .utf8),
        let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
  func num(_ v: Any?) -> Double? { (v as? NSNumber)?.doubleValue ?? (v as? String).flatMap(Double.init) }
  guard let l = num(o["low"]), let h = num(o["high"]), l.isFinite, h.isFinite else { return nil }
  let low = max(1e-7, min(1, l)), high = max(low, min(1, h))
  let basis = (o["basis"] as? String) ?? ""
  let grounded = sourceURL != nil
  return BaseRate(key: rateKey(cat: cat, value: value), label: value, cat: cat, low: low, high: high, grade: grounded ? .B : .C,
                  source: grounded ? String(basis.prefix(200)) : "Model estimate, no source: \(basis.prefix(160))",
                  url: sourceURL, origin: .cloud)
}
