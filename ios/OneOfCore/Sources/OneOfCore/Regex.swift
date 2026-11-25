import Foundation

/// A regular expression with JavaScript `RegExp.prototype.test` semantics for the
/// patterns this project uses (ASCII word boundaries, character classes, alternation).
/// The patterns are copied character for character from the web build so both
/// clients reject and accept exactly the same text.
public struct JSRegex: @unchecked Sendable {
  public let pattern: String
  private let re: NSRegularExpression

  public init(_ pattern: String, caseInsensitive: Bool = false) {
    self.pattern = pattern
    var opts: NSRegularExpression.Options = []
    if caseInsensitive { opts.insert(.caseInsensitive) }
    // Patterns are compile-time constants; a bad one is a programming error.
    self.re = try! NSRegularExpression(pattern: pattern, options: opts)
  }

  public func test(_ s: String) -> Bool {
    re.firstMatch(in: s, options: [], range: NSRange(s.startIndex..., in: s)) != nil
  }

  /// `s.replace(/pattern/g, template)` for literal templates.
  public func replaceAll(_ s: String, with template: String) -> String {
    re.stringByReplacingMatches(in: s, options: [], range: NSRange(s.startIndex..., in: s), withTemplate: NSRegularExpression.escapedTemplate(for: template))
  }
}

extension Array {
  /// JavaScript's `Array.prototype.sort` is stable; Swift's `sort` is not documented as stable.
  /// Ties keep their original order, so rankings match the web build exactly.
  func stableSorted(by less: (Element, Element) -> Bool) -> [Element] {
    enumerated().sorted { x, y in
      if less(x.element, y.element) { return true }
      if less(y.element, x.element) { return false }
      return x.offset < y.offset
    }.map(\.element)
  }
}
