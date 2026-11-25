import Foundation

/// Crowd-size estimator, ported from src/lib/estimate.ts. Pure and deterministic given a seed:
/// the same seed gives the same P10/P50/P90 on iPhone and in the browser (golden-tested).
///
///   k = N(region) × Π fᵢ × C
public let GRADE_SPREAD: [Grade: Double] = [.A: 1.1, .B: 2, .C: 5]
public let CORR_MAX: Double = 1.6
private let DRAWS = 4000

/// mulberry32, bit-identical to the JavaScript version (Math.imul, >>> 0).
public struct Mulberry32 {
  private var s: UInt32
  public init(seed: UInt32) { s = seed }
  public mutating func next() -> Double {
    s = s &+ 0x6d2b_79f5
    var t = s
    t = (t ^ (t >> 15)) &* (t | 1)
    t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
    return Double(t ^ (t >> 14)) / 4_294_967_296
  }
}

@inline(__always) private func logUniform(_ r: Double, _ lo: Double, _ hi: Double) -> Double {
  exp(log(lo) + r * (log(hi) - log(lo)))
}

public func bandFor(_ k: Double) -> Band {
  if k >= 10_000 { return .crowd }
  if k >= 1_000 { return .neighbourhood }
  if k >= 10 { return .room }
  return .handful
}

private func quantile(_ sorted: [Double], _ q: Double) -> Double {
  sorted[min(sorted.count - 1, max(0, Int((q * Double(sorted.count)).rounded(.down))))]
}

public func estimate(_ region: Region, _ attrs: [Attribute], seed: UInt32 = 7) -> CrowdEstimate {
  var rnd = Mulberry32(seed: seed)
  let regionSpread = GRADE_SPREAD[region.grade]!
  let adults = region.population * region.adultShare
  var draws = [Double](repeating: 0, count: DRAWS)
  for d in 0..<DRAWS {
    var k = logUniform(rnd.next(), adults / regionSpread, adults * regionSpread)
    var seen: [String] = []
    for (i, a) in attrs.enumerated() {
      let s = GRADE_SPREAD[a.rate.grade]!
      let lo = max(1e-9, a.rate.low / s)
      let hi = min(1, a.rate.high * s)
      let f = min(1, logUniform(rnd.next(), lo, max(lo, hi)) * liftFor(a.rate.key, seen).lift)
      seen.append(a.rate.key)
      let c = i > 0 ? logUniform(rnd.next(), 1, CORR_MAX) : 1
      k *= min(1, f * c)
    }
    draws[d] = k
  }
  draws.sort()
  let clamp = { (x: Double) in max(1, x) }
  let p10 = clamp(quantile(draws, 0.1)), p50 = clamp(quantile(draws, 0.5)), p90 = clamp(quantile(draws, 0.9))
  return CrowdEstimate(p10: p10, p50: p50, p90: p90, band: bandFor(p50), bits: max(0, log2(adults / p50)))
}

/// JavaScript `Number.prototype.toFixed`: ties round away from zero on the exact value.
func toFixed(_ x: Double, _ digits: Int) -> String {
  let p = pow(10.0, Double(digits))
  let n = (x * p).rounded(.toNearestOrAwayFromZero) / p
  return String(format: "%.\(digits)f", n)
}

/// `String(Number(x.toFixed(d)))` in JavaScript: fixed digits, then trailing zeros dropped.
func trimmed(_ x: Double, _ digits: Int) -> String {
  let v = Double(toFixed(x, digits))!
  return v == v.rounded() && abs(v) < 1e15 ? String(Int(v)) : "\(v)"
}

/// How many people, rounded for humans: 1,752,753 → "1.75M", 1,000,000 → "1M", 23.4 → "25".
public func humanCount(_ n: Double) -> String {
  if n < 2 { return "1" }
  if n < 10 { return String(Int(n.rounded(.toNearestOrAwayFromZero))) }
  if n < 100 { return String(Int((n / 5).rounded(.toNearestOrAwayFromZero) * 5)) }
  if n < 1000 { return String(Int((n / 10).rounded(.toNearestOrAwayFromZero) * 10)) }
  if n < 1e6 { return "\(trimmed(n / 1000, n < 1e4 ? 1 : 0))k" }
  if n < 1e9 { return "\(trimmed(n / 1e6, n < 1e7 ? 2 : 1))M" }
  return "\(trimmed(n / 1e9, 2))B"
}

public func rangeLabel(_ e: CrowdEstimate) -> String { "\(humanCount(e.p10))–\(humanCount(e.p90))" }
