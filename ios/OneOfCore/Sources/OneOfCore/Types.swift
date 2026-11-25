import Foundation

/// Fact categories the extractor may emit (same list and order as the web build).
public let CATEGORIES: [String] = [
  "home_location", "work_location", "occupation", "employer_type", "education", "age", "gender",
  "family", "relationship", "vehicle", "pet", "health", "religion_community", "language",
  "dated_event", "rare_hobby", "other",
]

/// One post or comment from the user's own history.
public struct Post: Codable, Equatable, Hashable, Sendable, Identifiable {
  public var id: String
  public var date: String  // ISO 8601
  public var text: String
  public var `where`: String?
  public var permalink: String?
  public init(id: String, date: String, text: String, where w: String? = nil, permalink: String? = nil) {
    self.id = id; self.date = date; self.text = text; self.where = w; self.permalink = permalink
  }
}

/// What the model returns for one fact, before the deterministic checker.
public struct RawFact: Codable, Equatable, Sendable {
  public var p: Int
  public var cat: String
  public var value: String
  public var quote: String
  public var about_self: Bool
  public var certainty: String  // "stated" | "implied"
  public init(p: Int, cat: String, value: String, quote: String, about_self: Bool, certainty: String) {
    self.p = p; self.cat = cat; self.value = value; self.quote = quote; self.about_self = about_self; self.certainty = certainty
  }
}

public enum FactSource: String, Codable, Sendable { case on_device, in_cloud }

/// A fact extracted from one post, after verification.
public struct Fact: Codable, Equatable, Hashable, Sendable, Identifiable {
  public var id: String
  public var postId: String
  public var date: String
  public var cat: String
  public var value: String
  public var quote: String
  public var certainty: String
  public var source: FactSource
  public init(id: String, postId: String, date: String, cat: String, value: String, quote: String, certainty: String, source: FactSource) {
    self.id = id; self.postId = postId; self.date = date; self.cat = cat; self.value = value; self.quote = quote; self.certainty = certainty; self.source = source
  }
}

public enum Grade: String, Codable, Sendable { case A, B, C }
public enum RateOrigin: String, Codable, Sendable { case bundled, cache, cloud, fallback }

public struct BaseRate: Codable, Equatable, Sendable {
  public var key: String
  public var label: String
  public var cat: String
  /// Fraction of the reference population that has this attribute.
  public var low: Double
  public var high: Double
  public var grade: Grade
  public var source: String
  public var url: String?
  public var origin: RateOrigin
  /// Key this one is a strict subset of ("occupation:icu_nurse" within "occupation:nurse").
  public var within: String?
  public init(key: String, label: String, cat: String, low: Double, high: Double, grade: Grade, source: String, url: String? = nil, origin: RateOrigin, within: String? = nil) {
    self.key = key; self.label = label; self.cat = cat; self.low = low; self.high = high; self.grade = grade
    self.source = source; self.url = url; self.origin = origin; self.within = within
  }
}

public struct Region: Codable, Equatable, Sendable {
  public var key: String
  public var label: String
  public var population: Double
  /// Share of the population aged 18+. Attributes are measured against adults.
  public var adultShare: Double
  public var grade: Grade
  public var source: String
  public var url: String?
  public init(key: String, label: String, population: Double, adultShare: Double, grade: Grade, source: String, url: String? = nil) {
    self.key = key; self.label = label; self.population = population; self.adultShare = adultShare
    self.grade = grade; self.source = source; self.url = url
  }
}

/// An attribute in the dossier: a base rate plus the facts that support it.
public struct Attribute: Codable, Equatable, Sendable {
  public var rate: BaseRate
  public var facts: [Fact]
  public var firstSeen: String
  public init(rate: BaseRate, facts: [Fact], firstSeen: String) { self.rate = rate; self.facts = facts; self.firstSeen = firstSeen }
}

public enum Band: String, Codable, Sendable { case crowd, neighbourhood, room, handful }

public struct CrowdEstimate: Codable, Equatable, Sendable {
  public var p10: Double
  public var p50: Double
  public var p90: Double
  public var band: Band
  public var bits: Double
}
