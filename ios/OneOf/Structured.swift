import FoundationModels
import OneOfCore

/// Typed output for Apple's on-device model (guided generation). Firebase AI Logic passes the same
/// schema to Gemini when the hybrid session falls back, so both sides answer in this shape.
@Generable
struct GFact {
  @Guide(description: "category", .anyOf(["home_location", "work_location", "occupation", "employer_type", "education", "age", "gender", "family", "relationship", "vehicle", "pet", "health", "religion_community", "language", "dated_event", "rare_hobby", "other"]))
  var cat: String
  @Guide(description: "a short generic phrase, like registered nurse, Columbus, parent of twins")
  var value: String
  @Guide(description: "the exact words copied from the post")
  var quote: String
  @Guide(description: "true only if this detail is about the author themself")
  var about_self: Bool
  @Guide(description: "stated if said outright, implied if inferred", .anyOf(["stated", "implied"]))
  var certainty: String
}

@Generable
struct GFactBatch {
  @Guide(description: "details the post reveals about its author; empty if none", .maximumCount(8))
  var facts: [GFact]
}

extension GFactBatch {
  var rawFacts: [RawFact] {
    facts.map { RawFact(p: 0, cat: $0.cat, value: $0.value, quote: $0.quote, about_self: $0.about_self, certainty: $0.certainty) }
  }
}
