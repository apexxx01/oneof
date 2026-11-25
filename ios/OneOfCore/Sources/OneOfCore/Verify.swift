import Foundation

// Deterministic checks between the model and the dossier. Hallucinations die here.
// Ported line for line from src/lib/verify.ts; golden fixtures prove the two agree.

private let PLACEHOLDER = JSRegex(#"\b(unknown|unspecified|not specified|n\/a|none|near me|somewhere|location|self|myself|me)\b"#, caseInsensitive: true)
private let HYPOTHETICAL = JSRegex(#"\b(imagine|if i (had|were|was|lived)|i wish i|someday|hypothetically|pretend)\b"#, caseInsensitive: true)
/// "I feel 80 years old after that shift": a figure of speech, not an age (designed persona trap).
private let FIGURATIVE_AGE = JSRegex(#"\b(feel|feels|feeling|felt)( like)?( i'?m| i am)? (\d+|a hundred|ancient|old)\b"#, caseInsensitive: true)
/// "the bus driver waited for me": a job named with "the" belongs to someone else, unless the
/// author claims it ("as the", "I'm the").
func othersJob(_ value: String, _ quote: String) -> Bool {
  let v = NSRegularExpression.escapedPattern(for: value.trimmingCharacters(in: .whitespacesAndNewlines))
  if v.isEmpty { return false }
  let named = JSRegex(#"\bthe "# + v + #"\b"#, caseInsensitive: true).test(quote)
  let claimed = JSRegex(#"\b(as|i'?m|i am|work as|working as) (an?|the) "# + v + #"\b"#, caseInsensitive: true).test(quote)
  return named && !claimed
}
private let GENERIC = JSRegex(#"\b(cooking|board games?|football|soccer|basketball|music|movies?|tv|netflix|reading|books?|gaming|video games?|coffee|tea|sleep|food|baking|walking|shopping|travel)\b"#, caseInsensitive: true)
private let SOMEONE_ELSE = JSRegex(#"\bmy (sister|brother|cousin|friend|best friend|bff|mom|mum|mother|dad|father|aunt|uncle|grand(ma|pa|mother|father)|neighbou?r|co-?worker|colleague|boss|roommate|son|daughter|kid|niece|nephew|in-laws?)s?\b"#, caseInsensitive: true)
private let THIRD_PARTY_CATS: Set<String> = ["home_location", "work_location", "occupation", "employer_type", "education", "vehicle", "pet", "rare_hobby", "age"]
private let FAMILY_ROLE = JSRegex(#"\b(mom|mum|mother|dad|father|parent|single|twins?|kids?|children|son|daughter|wife|husband|divorced|widow)"#, caseInsensitive: true)
private let VAGUE_OCCUPATION = JSRegex(#"^(an? )?(job|work|worker|grind|person|people|professional|expert|individual|employee|staff|someone|flexible.*|intellectual.*|career)$"#, caseInsensitive: true)
private let GROUNDED_CATS: Set<String> = ["home_location", "work_location", "vehicle", "pet", "language", "education", "employer_type"]
private let UPPER = JSRegex(#"[A-Z]"#)
private let SHIFT_WORDS = JSRegex(#"night|day|shift|remote|hospital|office"#, caseInsensitive: true)
private let NON_ALNUM = JSRegex(#"[^a-z0-9 ]"#)
private let SPACES = JSRegex(#"\s+"#)

func tokens(_ s: String) -> Set<String> {
  let cleaned = NON_ALNUM.replaceAll(s.lowercased(), with: " ")
  return Set(cleaned.split(whereSeparator: { $0.isWhitespace }).map(String.init).filter { $0.utf16.count > 2 })
}

public func normalize(_ s: String) -> String {
  var t = SPACES.replaceAll(s.lowercased(), with: " ")
  t = t.replacingOccurrences(of: "\u{201C}", with: "\"").replacingOccurrences(of: "\u{201D}", with: "\"")
  t = t.replacingOccurrences(of: "\u{2018}", with: "'").replacingOccurrences(of: "\u{2019}", with: "'")
  return t.trimmingCharacters(in: .whitespacesAndNewlines)
}

public struct Verdict: Equatable, Sendable {
  public let ok: Bool
  public let why: String?
  static let pass = Verdict(ok: true, why: nil)
  static func fail(_ why: String) -> Verdict { Verdict(ok: false, why: why) }
}

public func verify(_ f: RawFact, _ post: Post) -> Verdict {
  if !f.about_self { return .fail("not about the author") }
  if f.cat == "other" { return .fail("uncategorized") }
  if PLACEHOLDER.test(f.value) { return .fail("placeholder value") }
  let np = normalize(post.text), nq = normalize(f.quote)
  guard let hit = np.range(of: nq) else { return .fail("quote not in post") }
  if THIRD_PARTY_CATS.contains(f.cat) && SOMEONE_ELSE.test(f.quote) { return .fail("about someone else") }
  let lead = String(np[np.startIndex..<hit.upperBound])
  if HYPOTHETICAL.test(lead) { return .fail("hypothetical") }
  // The words just before the quote count too: the model may quote "80 years old" without "I feel".
  if f.cat == "age" {
    let back = min(25, np.distance(from: np.startIndex, to: hit.lowerBound))
    if FIGURATIVE_AGE.test(String(np[np.index(hit.lowerBound, offsetBy: -back)..<hit.upperBound])) { return .fail("figure of speech") }
  }
  if (f.cat == "occupation" || f.cat == "employer_type") && othersJob(f.value, f.quote) { return .fail("about someone else") }
  if f.cat == "rare_hobby" && GENERIC.test(f.value) { return .fail("generic interest") }
  if (f.cat == "occupation" || f.cat == "employer_type") && VAGUE_OCCUPATION.test(f.value.trimmingCharacters(in: .whitespacesAndNewlines)) { return .fail("vague job") }
  if (f.cat == "rare_hobby" || f.cat == "age") && f.certainty == "implied" { return .fail("implied hobby or age") }
  if f.cat == "family" && f.certainty == "implied" && !FAMILY_ROLE.test(f.value) { return .fail("implied family, no role") }
  if (f.cat == "home_location" || f.cat == "work_location") && !UPPER.test(f.value) && !SHIFT_WORDS.test(f.value) {
    return .fail("not a place name")
  }
  if GROUNDED_CATS.contains(f.cat) {
    let pt = tokens(post.text)
    if !tokens(f.value).contains(where: { pt.contains($0) }) { return .fail("value not grounded in post") }
  }
  return .pass
}
