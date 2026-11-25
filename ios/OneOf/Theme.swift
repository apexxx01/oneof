import OneOfCore
import SwiftUI
import UIKit

/// OneOf's identity (docs/DESIGN.md): brutalist editorial, a front page about you. Black and white, one
/// hot signal colour, hard 2px rules, hard offset shadows, huge compressed numerals, mono for data.
enum Theme {
  static let bg = Color.dyn(dark: 0x000000, light: 0xFFFFFF)
  static let fg = Color.dyn(dark: 0xF5F5F2, light: 0x0A0A0A)
  static let text = fg
  static let muted = Color.dyn(dark: 0x9B9B9B, light: 0x5E5E5E)
  static let faint = Color.dyn(dark: 0x5C5C5C, light: 0xA3A3A3)
  static let line = Color.dyn(dark: 0x232323, light: 0xD9D9D9)
  static let line2 = Color.dyn(dark: 0x3A3A3A, light: 0xBDBDBD)
  static let well = Color.dyn(dark: 0x0E0E0E, light: 0xF1F1EF)
  static let panel = bg
  static let signal = Color.dyn(dark: 0xFF4A1C, light: 0xE8380D)
  static let device = Color.dyn(dark: 0x1FE07F, light: 0x007A3F)
  static let cloud = Color.dyn(dark: 0x6EA8FF, light: 0x1F5FD1)
  static let amber = Color.dyn(dark: 0xF5B544, light: 0xA86500)
  static let danger = signal

  /// Data only: bytes, ms, badges, status cells.
  static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight, design: .monospaced) }
  /// The crowd numeral and big headings: SF Pro Compressed, black.
  static func numeral(_ size: CGFloat) -> Font { .system(size: size, weight: .black).width(.compressed) }
  static func heading(_ size: CGFloat = 30) -> Font { .system(size: size, weight: .heavy).width(.condensed) }
}

extension Color {
  init(hex: UInt32) {
    self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
  }
  static func dyn(dark: UInt32, light: UInt32) -> Color {
    Color(UIColor { t in
      let h = t.userInterfaceStyle == .light ? light : dark
      return UIColor(red: CGFloat((h >> 16) & 0xFF) / 255, green: CGFloat((h >> 8) & 0xFF) / 255, blue: CGFloat(h & 0xFF) / 255, alpha: 1)
    })
  }
}

/// A section: 2px rule box, squared. `lead` gets the hard offset shadow (one per screen).
struct Panel<Content: View>: View {
  var padding: CGFloat = 16
  var lead = false
  @ViewBuilder var content: Content
  var body: some View {
    VStack(alignment: .leading, spacing: 12) { content }
      .padding(padding)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Theme.bg)
      .overlay(Rectangle().stroke(Theme.fg, lineWidth: 2))
      .background(lead ? Rectangle().fill(Theme.fg).offset(x: 6, y: 6) : nil)
      .padding(.trailing, lead ? 6 : 0)
      .padding(.bottom, lead ? 6 : 0)
  }
}

/// Section heading: condensed heavy, sentence case.
struct SectionHead: View {
  let text: String
  var note: String? = nil
  init(_ text: String, note: String? = nil) { self.text = text; self.note = note }
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(text).font(Theme.heading(26)).foregroundStyle(Theme.fg).accessibilityAddTraits(.isHeader)
      if let note { Text(note).font(.footnote).foregroundStyle(Theme.muted) }
    }
  }
}

/// Squared buttons. Primary: solid signal, 2px rule, hard shadow that collapses on press.
struct Brutal: ButtonStyle {
  var primary = false
  @Environment(\.isEnabled) private var enabled
  func makeBody(configuration: Configuration) -> some View {
    let pressed = configuration.isPressed
    configuration.label
      .font(.system(size: 16, weight: .bold).width(.condensed))
      .padding(.horizontal, 14).padding(.vertical, 11)
      .foregroundStyle(primary ? Color.black : Theme.fg)
      .background(primary ? (enabled ? Theme.signal : Theme.faint) : Theme.bg)
      .overlay(Rectangle().stroke(Theme.fg, lineWidth: 2))
      .background(Rectangle().fill(Theme.fg).offset(x: pressed || !enabled ? 0 : 4, y: pressed || !enabled ? 0 : 4))
      .offset(x: pressed ? 4 : 0, y: pressed ? 4 : 0)
      .padding(.trailing, 4).padding(.bottom, 4)
      .opacity(enabled ? 1 : 0.55)
      .animation(.easeOut(duration: 0.08), value: pressed)
  }
}

struct Badge: View {
  let text: String
  let color: Color
  var body: some View {
    Text(text)
      .font(Theme.mono(10, .bold))
      .tracking(0.9)
      .padding(.horizontal, 6).padding(.vertical, 3)
      .foregroundStyle(color)
      .overlay(Rectangle().stroke(color, lineWidth: 1.5))
  }

  static func source(_ s: LedgerEntry.Source) -> Badge {
    switch s {
    case .on_device: return Badge(text: "ON DEVICE", color: Theme.device)
    case .in_cloud: return Badge(text: "IN CLOUD", color: Theme.cloud)
    case .blocked: return Badge(text: "BLOCKED", color: Theme.signal)
    case .error: return Badge(text: "ERROR", color: Theme.signal)
    }
  }
  static func fact(_ s: FactSource) -> Badge { source(s == .on_device ? .on_device : .in_cloud) }
}

struct GradeBadge: View {
  let grade: Grade
  var color: Color { grade == .A ? Theme.device : grade == .B ? Theme.cloud : Theme.amber }
  var body: some View {
    Text(grade.rawValue)
      .font(Theme.mono(12, .black))
      .frame(width: 22, height: 22)
      .foregroundStyle(Color.black)
      .background(color)
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
  switch b { case .crowd: return Theme.fg; case .neighbourhood: return Theme.amber; case .room, .handful: return Theme.signal }
}

/// The crowd field (docs/DESIGN.md): 1,600 dots, each a slice of the crowd. lit = N × (p50/adults)^0.35,
/// the same mapping as the web and the extension; a fixed shuffle so the same dots stay lit as it thins.
struct CrowdField: View, Animatable {
  var lit: Double
  var previewLit: Double? = nil
  var band: Band
  var animatableData: Double { get { lit } set { lit = newValue } }

  static let N = 1600
  static let order: [Int] = {
    var r = Mulberry32(seed: 7)
    var a = Array(0..<N)
    for i in stride(from: N - 1, to: 0, by: -1) { a.swapAt(i, Int(r.next() * Double(i + 1))) }
    return a
  }()
  static func litCount(p50: Double, adults: Double) -> Double {
    let ratio = min(1, max(0, p50 / max(1, adults)))
    return min(Double(N), max(1, (Double(N) * pow(ratio, 0.35)).rounded()))
  }

  var body: some View {
    Canvas { ctx, size in
      // Fill the frame: pick the grid whose aspect matches it (still exactly N dots or a few spare).
      let columns = max(10, Int((Double(Self.N) * Double(size.width / max(1, size.height))).squareRoot().rounded()))
      let rows = (Self.N + columns - 1) / columns
      let cell = min(size.width / CGFloat(columns), size.height / CGFloat(rows))
      let dot = max(1.5, cell * 0.62)
      let ox = (size.width - cell * CGFloat(columns)) / 2, oy = (size.height - cell * CGFloat(rows)) / 2
      let n = Int(lit.rounded()), p = previewLit.map { Int($0.rounded()) }
      var rank = [Int](repeating: 0, count: Self.N)
      for (r, i) in Self.order.enumerated() { rank[i] = r }
      let on = bandColor(band), off = Theme.line
      for i in 0..<Self.N {
        let x = ox + CGFloat(i % columns) * cell + (cell - dot) / 2, y = oy + CGFloat(i / columns) * cell + (cell - dot) / 2
        let rect = CGRect(x: x, y: y, width: dot, height: dot)
        let isLit = rank[i] < n
        if isLit, let p, rank[i] >= p {
          ctx.stroke(Path(rect.insetBy(dx: 0.5, dy: 0.5)), with: .color(Theme.signal), lineWidth: 1)
        } else {
          ctx.fill(Path(rect), with: .color(isLit ? on : off))
        }
      }
    }
    .accessibilityHidden(true)
  }
}

/// Lit dots for an estimate against its region's adults.
func crowdLit(_ e: CrowdEstimate, _ r: Region) -> Double { CrowdField.litCount(p50: e.p50, adults: r.population * r.adultShare) }

/// "one of ~50" with its range, bits and a hard log meter from 1 to 100M.
struct Meter: View {
  let e: CrowdEstimate
  var label: String? = nil
  var compact = false

  private func pos(_ n: Double, _ w: CGFloat) -> CGFloat { CGFloat(min(1, max(0, log10(max(1, n)) / 8))) * w }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let label { Text(label).font(Theme.mono(11, .bold)).foregroundStyle(Theme.muted) }
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text("one of").font(Theme.mono(compact ? 13 : 15, .bold)).foregroundStyle(Theme.muted)
        Text("~\(humanCount(e.p50))")
          .font(Theme.numeral(compact ? 64 : 112))
          .foregroundStyle(bandColor(e.band))
          .contentTransition(.numericText())
          .monospacedDigit()
          .lineLimit(1).minimumScaleFactor(0.5)
      }
      .accessibilityElement(children: .combine)
      .accessibilityLabel("One of about \(humanCount(e.p50)) people")
      Text("range \(humanCount(e.p10))–\(humanCount(e.p90)), \(String(format: "%.1f", e.bits)) bits given away")
        .font(Theme.mono(12)).foregroundStyle(Theme.muted)
      GeometryReader { g in
        ZStack(alignment: .leading) {
          Rectangle().fill(Theme.line).frame(height: 10)
          Rectangle().fill(bandColor(e.band).opacity(0.45))
            .frame(width: max(8, pos(e.p90, g.size.width) - pos(e.p10, g.size.width)), height: 10)
            .offset(x: pos(e.p10, g.size.width))
          Rectangle().fill(bandColor(e.band)).frame(width: 14, height: 18).overlay(Rectangle().stroke(Theme.fg, lineWidth: 2))
            .offset(x: pos(e.p50, g.size.width) - 7)
        }
        .frame(height: 18)
      }
      .frame(height: 18)
      .animation(.spring(duration: 0.5), value: e.p50)
      .accessibilityHidden(true)
      HStack { ForEach(["1", "100", "10k", "1M", "100M"], id: \.self) { t in Text(t); if t != "100M" { Spacer() } } }
        .font(Theme.mono(10)).foregroundStyle(Theme.muted)
        .accessibilityHidden(true)
      if !compact, let c = BAND_COPY[e.band] {
        Text("\(c.title). \(c.line)").font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.fg)
      }
    }
  }
}

/// Live facts, scrolling. Pauses under Reduce Motion.
struct Ticker: View {
  let items: [String]
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  var body: some View {
    let text = items.joined(separator: "   ///   ") + "   ///   "
    TimelineView(.animation(paused: reduceMotion)) { tl in
      GeometryReader { g in
        let w = CGFloat(text.count) * 7.4
        let x = reduceMotion ? 0 : -CGFloat(tl.date.timeIntervalSinceReferenceDate * 28).truncatingRemainder(dividingBy: max(1, w))
        HStack(spacing: 0) { Text(text); Text(text) }
          .font(Theme.mono(11, .bold))
          .foregroundStyle(Theme.bg)
          .fixedSize()
          .offset(x: x)
          .frame(width: g.size.width, alignment: .leading)
      }
    }
    .frame(height: 26)
    .background(Theme.fg)
    .clipped()
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(items.joined(separator: ". "))
  }
}

/// Brand cell: "1/" on a solid square + the wordmark.
struct BrandMark: View {
  var body: some View {
    HStack(spacing: 8) {
      Text("1/").font(Theme.numeral(20)).foregroundStyle(Theme.bg).frame(width: 30, height: 30).background(Theme.fg)
      Text("OneOf").font(.system(size: 24, weight: .black).width(.expanded)).foregroundStyle(Theme.fg)
    }
    .accessibilityElement(children: .ignore).accessibilityLabel("OneOf")
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

/// A fact as a chip: category in mono, value in heavy; counted ones carry a signal rule.
struct FactChip: View {
  let fact: Fact
  var counted = true
  var count = 1
  var body: some View {
    HStack(spacing: 6) {
      Text(fact.cat.replacingOccurrences(of: "_", with: " ")).font(Theme.mono(10)).foregroundStyle(Theme.muted)
      Text(fact.value).font(.system(size: 14, weight: .bold).width(.condensed)).foregroundStyle(counted ? Theme.fg : Theme.muted).lineLimit(2)
      if count > 1 { Text("×\(count)").font(Theme.mono(10, .bold)).foregroundStyle(Theme.muted) }
    }
    .padding(.horizontal, 10).padding(.vertical, 7)
    .overlay(Rectangle().stroke(counted ? Theme.signal : Theme.line2, lineWidth: counted ? 2 : 1))
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(fact.cat.replacingOccurrences(of: "_", with: " ")): \(fact.value)\(count > 1 ? ", \(count) posts" : ""), \(counted ? "counted" : "not counted")")
  }
}
