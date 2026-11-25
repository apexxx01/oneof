import Foundation

/// Turns verified facts into a dossier. Ported from src/lib/dossier.ts, including JavaScript's
/// insertion-ordered maps and stable sorts, so the attribute order (and therefore every number)
/// matches the web build.
private let LOCATION_CATS: Set<String> = ["home_location", "work_location"]
public let NOT_IDENTIFYING: Double = 0.15

public struct Dossier: Equatable, Sendable {
  public var region: Region
  public var regionFacts: [Fact]
  public var attributes: [Attribute]
  /// Facts with no bundled base rate yet: candidates for a cloud lookup.
  public var unresolved: [Fact]
  /// Facts that stay on this device entirely (sensitive categories).
  public var localOnly: [Fact]
}

/// Insertion-ordered dictionary, like a JavaScript Map.
struct OrderedMap<V> {
  private(set) var keys: [String] = []
  private var store: [String: V] = [:]
  subscript(key: String) -> V? {
    get { store[key] }
    set {
      if store[key] == nil, newValue != nil { keys.append(key) }
      if newValue == nil { keys.removeAll { $0 == key } }
      store[key] = newValue
    }
  }
  var values: [V] { keys.map { store[$0]! } }
}

/// A rate counts only if it comes from a table we ship or a lookup that returned a source.
public func isCited(_ r: BaseRate) -> Bool {
  r.origin == .bundled || (r.url != nil && !(r.url!.isEmpty) && r.grade != .C)
}

private let NON_ALNUM_KEY = JSRegex(#"[^a-z0-9]+"#)
public func rateKey(cat: String, value: String) -> String {
  "\(cat):\(NON_ALNUM_KEY.replaceAll(value.lowercased(), with: " ").trimmingCharacters(in: .whitespacesAndNewlines))"
}

public func buildDossier(_ facts: [Fact], extraRates: [String: BaseRate] = [:]) -> Dossier {
  // 1. Region: the smallest-population place the facts mention.
  var region = DEFAULT_REGION
  var regionFacts: [Fact] = []
  for f in facts where LOCATION_CATS.contains(f.cat) {
    guard let r = matchRegion("\(f.value) \(f.quote)") else { continue }
    regionFacts.append(f)
    if r.population < region.population { region = r }
  }

  // 2. Attributes.
  var byKey = OrderedMap<Attribute>()
  var unresolved: [Fact] = []
  var localOnly: [Fact] = []
  for f in facts {
    if LOCAL_ONLY_CATS.contains(f.cat) { localOnly.append(f); continue }
    if f.cat == "other" { continue }
    if LOCATION_CATS.contains(f.cat) && matchRegion("\(f.value) \(f.quote)") != nil { continue }
    let pack = matchPack(f.cat, f.value, f.quote)
    // Only cited numbers narrow the crowd; an unsourced model guess is shown, never counted.
    let fetched = extraRates[rateKey(cat: f.cat, value: f.value)]
    let live = (fetched.map(isCited) ?? false) ? fetched : nil
    var rate: BaseRate?
    if let pack {
      var p = pack.rate
      if let live, p.grade == .C {
        p.low = live.low; p.high = live.high; p.grade = live.grade; p.source = live.source; p.url = live.url; p.origin = live.origin
      } else {
        p.origin = .bundled
      }
      rate = p
    } else {
      rate = live
    }
    guard let rate else { unresolved.append(f); continue }
    if rate.cat == "home_location" { continue }
    // True of more than 15% of adults: can't narrow anyone down, never moves the meter.
    if rate.low > NOT_IDENTIFYING { continue }
    if var cur = byKey[rate.key] {
      cur.facts.append(f)
      if f.date < cur.firstSeen { cur.firstSeen = f.date }
      byKey[rate.key] = cur
    } else {
      byKey[rate.key] = Attribute(rate: rate, facts: [f], firstSeen: f.date)
    }
  }

  // 3. Nested attributes: within one family keep only the most specific, pool the evidence.
  var families = OrderedMap<[Attribute]>()
  for a in byKey.values {
    let root = a.rate.within ?? a.rate.key
    families[root] = (families[root] ?? []) + [a]
  }
  var merged: [Attribute] = []
  for members in families.values {
    let sorted = members.stableSorted { $0.rate.high < $1.rate.high }
    var keep = sorted[0]
    for m in sorted.dropFirst() {
      keep.facts.append(contentsOf: m.facts)
      if m.firstSeen < keep.firstSeen { keep.firstSeen = m.firstSeen }
    }
    merged.append(keep)
  }
  let attributes = merged.stableSorted { $0.rate.high < $1.rate.high }
  return Dossier(region: region, regionFacts: regionFacts, attributes: attributes, unresolved: unresolved, localOnly: localOnly)
}

public func crowdNow(_ d: Dossier, seed: UInt32 = 7) -> CrowdEstimate { estimate(d.region, d.attributes, seed: seed) }

public struct TrailPoint: Equatable, Sendable, Identifiable {
  public var id: String { "\(date)|\(added.joined(separator: ","))" }
  public var date: String
  public var estimate: CrowdEstimate
  public var added: [String]
}

/// The crowd estimate after each new attribute appears, in posting order.
public func crumbTrail(_ d: Dossier, seed: UInt32 = 7) -> [TrailPoint] {
  let regionDate = d.regionFacts.map(\.date).sorted().first
  var events: [(date: String, label: String, attr: Attribute?)] = []
  if let regionDate, d.region.key != DEFAULT_REGION.key { events.append((regionDate, d.region.label, nil)) }
  for a in d.attributes { events.append((a.firstSeen, a.rate.label, a)) }
  events = events.stableSorted { $0.date < $1.date }
  var points: [TrailPoint] = []
  var regionOn = false
  var on: [Attribute] = []
  for e in events {
    if let a = e.attr { on.append(a) } else { regionOn = true }
    let region = regionOn ? d.region : DEFAULT_REGION
    let sorted = on.stableSorted { $0.rate.high < $1.rate.high }
    points.append(TrailPoint(date: e.date, estimate: estimate(region, sorted, seed: seed), added: [e.label]))
  }
  return points
}

/// The first point where the median crowd drops below `threshold`: "here you left the crowd".
public func leftTheCrowd(_ trail: [TrailPoint], threshold: Double = 100) -> TrailPoint? {
  trail.first { $0.estimate.p50 < threshold }
}

/// Minimum set of attributes whose removal brings the median crowd back above `target`.
public func minimumFix(_ d: Dossier, target: Double = 1000, seed: UInt32 = 7) -> [Attribute] {
  var remaining = d.attributes
  var removed: [Attribute] = []
  while !remaining.isEmpty && estimate(d.region, remaining, seed: seed).p50 < target {
    remaining = remaining.stableSorted { $0.rate.high < $1.rate.high }
    removed.append(remaining.removeFirst())
  }
  return removed
}
