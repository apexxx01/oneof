import OneOfCore
import SwiftUI

struct ScanView: View {
  @Environment(AppModel.self) private var model
  @Binding var path: [Screen]
  @AppStorage("oneof.dev") private var dev = false

  /// One chip per distinct detail, with a count; counted ones first.
  struct ChipGroup: Identifiable {
    var id: String
    var fact: Fact
    var count: Int
    var counted: Bool
  }

  private func groups(_ facts: [Fact], counted: Set<String>) -> [ChipGroup] {
    var order: [String] = []
    var byKey: [String: ChipGroup] = [:]
    for f in facts.reversed() {
      let k = "\(f.cat)|\(f.value.lowercased())"
      if var g = byKey[k] {
        g.count += 1; g.counted = g.counted || counted.contains(f.id); byKey[k] = g
      } else {
        byKey[k] = ChipGroup(id: k, fact: f, count: 1, counted: counted.contains(f.id)); order.append(k)
      }
    }
    let all = order.compactMap { byKey[$0] }
    return all.filter(\.counted) + all.filter { !$0.counted }
  }

  private var phaseLabel: (String, Color) {
    let s = model.scan
    if s.blocked { return ("BLOCKED", Theme.danger) }
    if s.paused { return ("PAUSED", Theme.amber) }
    if s.cooling { return ("BREATHER", Theme.amber) }
    if s.running && s.retrying > 0 { return ("RETRYING \(s.retrying)", Theme.amber) }
    if s.running { return (s.done < s.fastPass ? "READING · FAST PASS" : "READING", Theme.signal) }
    return ("DONE", Theme.device)
  }

  var body: some View {
    let s = model.scan
    let d = model.dossier
    let crowd = model.crowd
    let countedIds = Set(d.attributes.flatMap { $0.facts.map(\.id) } + d.regionFacts.map(\.id))
    let chips = groups(s.facts, counted: countedIds)
    let shown = chips.filter(\.counted)
    let hidden = chips.count - shown.count
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        if let r = s.replay {
          Text("REPLAY · recorded on-device on \(String(r.recordedAt.prefix(10))) · \(r.device) · prompt \(r.promptVersion) · 25× · facts re-checked by today's checker")
            .font(Theme.mono(10)).foregroundStyle(Theme.amber)
            .padding(8).frame(maxWidth: .infinity, alignment: .leading)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.amber.opacity(0.5)))
        }
        Panel { Meter(e: crowd, label: s.title) }

        Panel {
          HStack {
            Text(phaseLabel.0).font(Theme.mono(11)).tracking(1).foregroundStyle(phaseLabel.1)
            Spacer()
            Text("\(s.done)/\(s.order.count) posts").font(Theme.mono(12)).foregroundStyle(Theme.muted)
          }
          ProgressView(value: Double(s.done), total: Double(max(1, s.order.count)))
            .accessibilityLabel("Read \(s.done) of \(s.order.count) posts")
          HStack(spacing: 12) {
            stat("\(s.onDevice)", "on this iPhone", Theme.device)
            stat("\(s.inCloud)", "in the cloud", Theme.cloud)
            stat("\(countedIds.count)", "details counted", Theme.text)
          }
          if s.paused { Text("Paused while OneOf is in the background: Apple's model only runs in the foreground.").font(.caption).foregroundStyle(Theme.amber) }
          if s.cooling { Text("Giving the on-device model a short breather…").font(.caption).foregroundStyle(Theme.amber) }
          if s.blocked { Text(AIError.blocked.localizedDescription).font(.footnote).foregroundStyle(Theme.danger) }
          if let p = s.current {
            Text("“\(p.text)”").font(.footnote).foregroundStyle(Theme.muted).lineLimit(3)
              .transition(.opacity).id(p.id)
          }
          if s.empty > 0 { Text("\(s.empty) empty or link-only posts skipped.").font(.caption2).foregroundStyle(Theme.muted) }
          if dev {
            DisclosureGroup {
              VStack(alignment: .leading, spacing: 6) {
                Text("last post \(Int(s.lastMs)) ms · rejected by checker: \(s.rejected) · unreadable: \(s.unreadable) · malformed: \(s.malformed) · failed: \(s.failed)").font(Theme.mono(10))
                if !s.lastReply.isEmpty { Text("last reply: \(s.lastReply)").font(Theme.mono(10)).foregroundStyle(Theme.muted).lineLimit(12) }
                if !s.lastError.isEmpty { Text("last error: \(s.lastError)").font(Theme.mono(10)).foregroundStyle(Theme.danger).lineLimit(6) }
              }
              .textSelection(.enabled)
            } label: { Text("Developer diagnostics").font(Theme.mono(11)).foregroundStyle(Theme.muted) }
          }
        }

        if !s.running && s.facts.isEmpty && !s.blocked && s.done > 0 {
          Panel {
            Text("Nothing identifying found in \(s.done) posts.").font(.subheadline.weight(.semibold))
            Text("You're one of ~\(humanCount(crowd.p50)) adults by this measure. OneOf can miss details an attacker would find, so treat that as an upper bound, not a promise.")
              .font(.footnote).foregroundStyle(Theme.muted)
          }
        }

        if !chips.isEmpty {
          VStack(alignment: .leading, spacing: 8) {
            Text("WHAT IT FOUND").font(Theme.mono(11)).tracking(1).foregroundStyle(Theme.muted)
            Text("\(shown.count) detail\(shown.count == 1 ? "" : "s") counted (cited base rates only)\(hidden > 0 ? " · \(hidden) more found, not counted" : "").")
              .font(.caption).foregroundStyle(Theme.muted)
            FlowLayout(spacing: 8) {
              ForEach(dev ? chips : shown) { g in FactChip(fact: g.fact, counted: g.counted, count: g.count) }
            }
          }
        }
      }
      .padding(16)
      .animation(.easeOut(duration: 0.25), value: s.facts.count)
    }
    .safeAreaInset(edge: .bottom) {
      HStack {
        if s.running {
          Button(role: .destructive) { model.stopScan() } label: { Text("Stop").frame(maxWidth: .infinity) }.buttonStyle(.bordered)
        }
        Button { path.append(.dossier) } label: { Text("Open the dossier").frame(maxWidth: .infinity) }
          .buttonStyle(.borderedProminent)
          .disabled(s.done == 0)
      }
      .controlSize(.large)
      .padding(.horizontal, 16).padding(.vertical, 10)
      .background(.bar)
    }
    .sensoryFeedback(.impact(weight: .heavy), trigger: crowd.band)
    .sensoryFeedback(.success, trigger: s.finishedAt)
    .sensoryFeedback(.warning, trigger: s.blocked)
    .onChange(of: crowd.band) { _, b in
      AccessibilityNotification.Announcement("Now one of about \(humanCount(crowd.p50)). \(BAND_COPY[b]?.title ?? "")").post()
    }
    .navigationTitle("Scan")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar { ToolbarItem(placement: .topBarTrailing) { LedgerButton(path: $path) } }
  }

  private func stat(_ n: String, _ l: String, _ c: Color) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(n).font(Theme.mono(18, .bold)).foregroundStyle(c).contentTransition(.numericText())
      Text(l).font(.caption2).foregroundStyle(Theme.muted)
    }
    .accessibilityElement(children: .combine)
  }
}

/// Wrapping row layout for chips.
struct FlowLayout: Layout {
  var spacing: CGFloat = 8
  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? .infinity
    var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, maxX: CGFloat = 0
    for v in subviews {
      let s = v.sizeThatFits(ProposedViewSize(width: proposal.width, height: nil))
      if x > 0 && x + s.width > width { x = 0; y += rowH + spacing; rowH = 0 }
      x += s.width + spacing; rowH = max(rowH, s.height); maxX = max(maxX, x)
    }
    return CGSize(width: min(width, maxX), height: y + rowH)
  }
  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
    for v in subviews {
      let s = v.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
      if x > bounds.minX && x + s.width > bounds.maxX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
      v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
      x += s.width + spacing; rowH = max(rowH, s.height)
    }
  }
}
