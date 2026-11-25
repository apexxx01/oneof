import Foundation
import XCTest
@testable import OneOfCore

/// Cross-language parity: every expected value in golden.json was produced by the TypeScript
/// core that ships on the web (scripts/golden-ios.ts). The Swift core must agree exactly
/// (strings, keys, orderings) and to 1e-9 relative on floating-point estimates.
final class GoldenTests: XCTestCase {
  struct G: Decodable {
    struct Mul: Decodable { let seed: UInt32; let first10: [Double] }
    struct V: Decodable { let fact: RawFact; let post: Post; let ok: Bool; let why: String? }
    struct AF: Decodable { let cat: String; let value: String }
    struct AR: Decodable { let ok: Bool; let why: String?; let attribute: String? }
    struct A: Decodable { let fact: AF; let result: AR }
    struct MP: Decodable { let cat: String; let value: String; let quote: String; let key: String? }
    struct MR: Decodable { let text: String; let key: String? }
    struct LF: Decodable { let key: String; let present: [String]; let lift: Double; let with: String? }
    struct RK: Decodable { let fact: AF; let key: String }
    struct HC: Decodable { let n: Double; let s: String }
    struct E: Decodable { let region: Region; let attrs: [Attribute]; let seed: UInt32; let result: CrowdEstimate }
    struct DS: Decodable {
      let regionKey: String; let regionFactIds: [String]; let attributeKeys: [String]; let attributeFactIds: [[String]]
      let attributeFirstSeen: [String]; let unresolvedIds: [String]; let localOnlyIds: [String]
    }
    struct TP: Decodable { let date: String; let added: [String]; let estimate: CrowdEstimate }
    struct D: Decodable {
      let name: String; let facts: [Fact]; let extraRates: [[RateOrKey]]; let dossier: DS; let crowd: CrowdEstimate
      let trail: [TP]; let leftTheCrowdDate: String?; let minimumFixKeys: [String]
    }
    enum RateOrKey: Decodable {
      case key(String), rate(BaseRate)
      init(from d: Decoder) throws {
        let c = try d.singleValueContainer()
        if let s = try? c.decode(String.self) { self = .key(s) } else { self = .rate(try c.decode(BaseRate.self)) }
      }
    }
    let mulberry32: [Mul]; let verify: [V]; let attribute: [A]; let matchPack: [MP]; let matchRegion: [MR]
    let liftFor: [LF]; let rateKey: [RK]; let humanCount: [HC]; let estimate: [E]; let dossier: [D]
  }

  static let g: G = {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Resources/golden.json")
    return try! JSONDecoder().decode(G.self, from: Data(contentsOf: url))
  }()

  func close(_ a: Double, _ b: Double, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssert(abs(a - b) <= 1e-9 * max(1, abs(b)), "\(what): swift \(a) vs ts \(b)", file: file, line: line)
  }
  func same(_ a: CrowdEstimate, _ b: CrowdEstimate, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
    close(a.p10, b.p10, "\(what) p10", file: file, line: line); close(a.p50, b.p50, "\(what) p50", file: file, line: line)
    close(a.p90, b.p90, "\(what) p90", file: file, line: line); close(a.bits, b.bits, "\(what) bits", file: file, line: line)
    XCTAssertEqual(a.band, b.band, "\(what) band", file: file, line: line)
  }

  func testMulberry32BitIdentical() {
    for c in Self.g.mulberry32 {
      var r = Mulberry32(seed: c.seed)
      XCTAssertEqual((0..<10).map { _ in r.next() }, c.first10, "seed \(c.seed)")
    }
  }

  func testVerify() {
    XCTAssertGreaterThan(Self.g.verify.count, 100)
    for c in Self.g.verify {
      let v = OneOfCore.verify(c.fact, c.post)
      XCTAssertEqual(v.ok, c.ok, "\(c.fact.cat) '\(c.fact.value)' in '\(c.post.text)'")
      XCTAssertEqual(v.why, c.why, "\(c.fact.cat) '\(c.fact.value)' in '\(c.post.text)'")
    }
  }

  func testCloudSafeAttribute() {
    for c in Self.g.attribute {
      let v = cloudSafeAttribute(cat: c.fact.cat, value: c.fact.value)
      if c.result.ok { XCTAssertEqual(v, .ok(attribute: c.result.attribute!), "\(c.fact)") }
      else { XCTAssertEqual(v, .rejected(why: c.result.why!), "\(c.fact)") }
    }
  }

  func testMatchPackRegionLift() {
    for c in Self.g.matchPack { XCTAssertEqual(OneOfCore.matchPack(c.cat, c.value, c.quote)?.rate.key, c.key, "\(c.cat) \(c.value) | \(c.quote)") }
    for c in Self.g.matchRegion { XCTAssertEqual(OneOfCore.matchRegion(c.text)?.key, c.key, c.text) }
    for c in Self.g.liftFor {
      let r = OneOfCore.liftFor(c.key, c.present)
      close(r.lift, c.lift, "lift \(c.key)"); XCTAssertEqual(r.with, c.with, "lift with \(c.key)")
    }
    for c in Self.g.rateKey { XCTAssertEqual(OneOfCore.rateKey(cat: c.fact.cat, value: c.fact.value), c.key) }
  }

  func testHumanCount() {
    for c in Self.g.humanCount { XCTAssertEqual(OneOfCore.humanCount(c.n), c.s, "n=\(c.n)") }
  }

  func testEstimate() {
    for (i, c) in Self.g.estimate.enumerated() { same(OneOfCore.estimate(c.region, c.attrs, seed: c.seed), c.result, "estimate #\(i)") }
  }

  func testDossierCrowdTrailFix() {
    for c in Self.g.dossier {
      var extra: [String: BaseRate] = [:]
      for pair in c.extraRates { if case .key(let k) = pair[0], case .rate(let r) = pair[1] { extra[k] = r } }
      let d = buildDossier(c.facts, extraRates: extra)
      XCTAssertEqual(d.region.key, c.dossier.regionKey, c.name)
      XCTAssertEqual(d.regionFacts.map(\.id), c.dossier.regionFactIds, c.name)
      XCTAssertEqual(d.attributes.map(\.rate.key), c.dossier.attributeKeys, c.name)
      XCTAssertEqual(d.attributes.map { $0.facts.map(\.id) }, c.dossier.attributeFactIds, c.name)
      XCTAssertEqual(d.attributes.map(\.firstSeen), c.dossier.attributeFirstSeen, c.name)
      XCTAssertEqual(d.unresolved.map(\.id), c.dossier.unresolvedIds, c.name)
      XCTAssertEqual(d.localOnly.map(\.id), c.dossier.localOnlyIds, c.name)
      same(crowdNow(d), c.crowd, "\(c.name) crowd")
      let t = crumbTrail(d)
      XCTAssertEqual(t.count, c.trail.count, c.name)
      for (a, b) in zip(t, c.trail) {
        XCTAssertEqual(a.date, b.date, c.name); XCTAssertEqual(a.added, b.added, c.name); same(a.estimate, b.estimate, "\(c.name) trail")
      }
      XCTAssertEqual(leftTheCrowd(t)?.date, c.leftTheCrowdDate, c.name)
      XCTAssertEqual(minimumFix(d).map(\.rate.key), c.minimumFixKeys, c.name)
    }
  }
}
