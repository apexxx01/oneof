import OneOfCore
import SwiftUI

/// Same palette as the web build (src/index.css), so both clients read as one product.
enum Theme {
  static let bg = Color(hex: 0x0C0C0D)
  static let panel = Color(hex: 0x141416)
  static let line = Color(hex: 0x26262A)
  static let text = Color(hex: 0xECEBE6)
  static let muted = Color(hex: 0x9A988F)
  static let signal = Color(hex: 0xFF5B2E)
  static let device = Color(hex: 0x39D98A)
  static let cloud = Color(hex: 0x6EA8FF)
  static let amber = Color(hex: 0xF5B544)
  static let danger = Color(hex: 0xFF4D5E)
  static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight, design: .monospaced) }
}

extension Color {
  init(hex: UInt32) {
    self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
  }
}

struct Panel<Content: View>: View {
  var padding: CGFloat = 16
  @ViewBuilder var content: Content
  var body: some View {
    VStack(alignment: .leading, spacing: 10) { content }
      .padding(padding)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Theme.panel, in: RoundedRectangle(cornerRadius: 14))
      .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.line, lineWidth: 1))
  }
}

struct Badge: View {
  let text: String
  let color: Color
  var body: some View {
    Text(text)
      .font(Theme.mono(10, .semibold))
      .tracking(0.6)
      .padding(.horizontal, 6).padding(.vertical, 2)
      .foregroundStyle(color)
      .overlay(RoundedRectangle(cornerRadius: 5).stroke(color.opacity(0.6), lineWidth: 1))
  }

  static func source(_ s: LedgerEntry.Source) -> Badge {
    switch s {
    case .on_device: return Badge(text: "ON DEVICE", color: Theme.device)
    case .in_cloud: return Badge(text: "IN CLOUD", color: Theme.cloud)
    case .blocked: return Badge(text: "BLOCKED", color: Theme.danger)
    case .error: return Badge(text: "ERROR", color: Theme.danger)
    }
  }
  static func fact(_ s: FactSource) -> Badge { source(s == .on_device ? .on_device : .in_cloud) }
}

struct GradeBadge: View {
  let grade: Grade
  var color: Color { grade == .A ? Theme.device : grade == .B ? Theme.cloud : Theme.amber }
  var body: some View {
    Text(grade.rawValue)
      .font(Theme.mono(11, .bold))
      .frame(width: 20, height: 20)
      .foregroundStyle(color)
      .background(color.opacity(0.14), in: RoundedRectangle(cornerRadius: 4))
      .accessibilityLabel(grade == .A ? "Grade A, official table" : grade == .B ? "Grade B, derived source" : "Grade C, rough estimate")
  }
}

let BAND_COPY: [Band: (title: String, line: String)] = [
  .crowd: ("A crowd", "More people than a stadium could hold."),
  .neighbourhood: ("A neighbourhood", "A few streets’ worth of people."),
  .room: ("A room", "Few enough to check one by one."),
  .handful: ("A handful", "Few enough to name."),
]

func bandColor(_ b: Band) -> Color {
  switch b { case .crowd: return Theme.device; case .neighbourhood: return Theme.amber; case .room: return Theme.signal; case .handful: return Theme.danger }
}

/// "one of ~50" with its range, bits and a log-scale track from 1 to 100M.
struct Meter: View {
  let e: CrowdEstimate
  var label: String? = nil
  var compact = false

  private func pos(_ n: Double, _ w: CGFloat) -> CGFloat { CGFloat(min(1, max(0, log10(max(1, n)) / 8))) * w }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let label { Text(label.uppercased()).font(Theme.mono(11)).tracking(1).foregroundStyle(Theme.muted) }
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text("one of").font(.system(size: compact ? 16 : 20, weight: .medium)).foregroundStyle(Theme.muted)
        Text("~\(humanCount(e.p50))")
          .font(.system(size: compact ? 40 : 64, weight: .bold, design: .rounded))
          .foregroundStyle(bandColor(e.band))
          .contentTransition(.numericText())
          .monospacedDigit()
      }
      .accessibilityElement(children: .combine)
      .accessibilityLabel("One of about \(humanCount(e.p50)) people")
      Text("range \(humanCount(e.p10)) – \(humanCount(e.p90)) · \(String(format: "%.1f", e.bits)) bits given away")
        .font(Theme.mono(12)).foregroundStyle(Theme.muted)
      GeometryReader { g in
        ZStack(alignment: .leading) {
          Capsule().fill(Theme.line).frame(height: 6)
          Capsule().fill(bandColor(e.band).opacity(0.35))
            .frame(width: max(6, pos(e.p90, g.size.width) - pos(e.p10, g.size.width)), height: 6)
            .offset(x: pos(e.p10, g.size.width))
          Circle().fill(bandColor(e.band)).frame(width: 12, height: 12).offset(x: pos(e.p50, g.size.width) - 6)
        }
      }
      .frame(height: 12)
      .animation(.spring(duration: 0.5), value: e.p50)
      HStack { ForEach(["1", "100", "10k", "1M", "100M"], id: \.self) { t in Text(t); if t != "100M" { Spacer() } } }
        .font(Theme.mono(10)).foregroundStyle(Theme.muted)
      if !compact, let c = BAND_COPY[e.band] {
        (Text(c.title + ". ").bold() + Text(c.line)).font(.subheadline).foregroundStyle(Theme.text)
      }
    }
  }
}

func pct(_ x: Double) -> String {
  if x >= 0.1 { return String(format: "%.0f%%", x * 100) }
  if x >= 0.01 { return String(format: "%.1f%%", x * 100) }
  if x >= 0.001 { return String(format: "%.2f%%", x * 100) }
  return "1 in \(humanCount(1 / x))"
}

let isoParser: ISO8601DateFormatter = {
  let f = ISO8601DateFormatter()
  f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return f
}()

func parseISO(_ s: String) -> Date? { isoParser.date(from: s) ?? ISO8601DateFormatter().date(from: s) }

func shortDate(_ s: String) -> String {
  guard let d = parseISO(s) else { return String(s.prefix(10)) }
  return d.formatted(.dateTime.month(.abbreviated).year())
}

/// A fact as a chip: category, value, where it ran.
struct FactChip: View {
  let fact: Fact
  var counted = true
  var body: some View {
    HStack(spacing: 6) {
      Text(fact.cat.replacingOccurrences(of: "_", with: " ")).font(Theme.mono(10)).foregroundStyle(Theme.muted)
      Text(fact.value).font(.footnote.weight(.semibold)).foregroundStyle(counted ? Theme.text : Theme.muted)
    }
    .padding(.horizontal, 10).padding(.vertical, 6)
    .background(Theme.bg, in: Capsule())
    .overlay(Capsule().stroke(counted ? Theme.signal.opacity(0.6) : Theme.line, lineWidth: 1))
  }
}
