import Foundation

/// What may leave the device for a base-rate lookup: ONE generic attribute, never the user's words.
/// Ported from src/lib/attribute.ts. Places, health and dated events never leave the device.
private let NEVER_CATS: Set<String> = ["home_location", "work_location", "health", "religion_community", "dated_event", "other"]
private let MAX_WORDS = 4
private let PRONOUNS = JSRegex(#"\b(my|our|his|her|their)\b"#, caseInsensitive: true)
private let SPACES = JSRegex(#"\s+"#)
private let DIGIT = JSRegex(#"\d"#)
private let POSSESSIVE = JSRegex(#"['’]s\b"#)
private let CAPITALISED = JSRegex(#"^[A-Z][a-z]"#)
private let PLAIN = JSRegex(#"^[a-zA-Z][a-zA-Z \-/&]*$"#)

public enum AttributeVerdict: Equatable, Sendable {
  case ok(attribute: String)
  case rejected(why: String)
  public var attribute: String? { if case .ok(let a) = self { return a }; return nil }
}

public func cloudSafeAttribute(cat: String, value raw: String) -> AttributeVerdict {
  if NEVER_CATS.contains(cat) { return .rejected(why: "places, health and dated events never leave the device") }
  let value = SPACES.replaceAll(PRONOUNS.replaceAll(raw, with: " "), with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
  if value.isEmpty { return .rejected(why: "empty") }
  if DIGIT.test(value) { return .rejected(why: "contains a number") }
  if POSSESSIVE.test(value) { return .rejected(why: "possessive name") }
  let words = value.components(separatedBy: " ")
  if words.count > MAX_WORDS { return .rejected(why: "too specific") }
  if words.contains(where: { CAPITALISED.test($0) }) { return .rejected(why: "looks like a name") }
  if !PLAIN.test(value) { return .rejected(why: "unusual characters") }
  return .ok(attribute: "\(cat.replacingOccurrences(of: "_", with: " ")): \(value.lowercased())")
}
