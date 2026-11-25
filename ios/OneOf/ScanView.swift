import OneOfCore
import SwiftUI

struct ScanView: View {
  @Environment(AppModel.self) private var model
  @Binding var path: [Screen]

  var body: some View {
    let s = model.scan
    let d = model.dossier
    let crowd = crowdNow(d)
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        Panel { Meter(e: crowd, label: s.title) }

        Panel {
          HStack {
            Text(s.running ? "READING" : (s.blocked ? "BLOCKED" : "DONE")).font(Theme.mono(11)).tracking(1)
              .foregroundStyle(s.running ? Theme.signal : (s.blocked ? Theme.danger : Theme.device))
            Spacer()
            Text("\(s.done)/\(s.order.count)").font(Theme.mono(12)).foregroundStyle(Theme.muted)
          }
          ProgressView(value: Double(s.done), total: Double(max(1, s.order.count)))
          HStack(spacing: 12) {
            stat("\(s.onDevice)", "on-device", Theme.device)
            stat("\(s.inCloud)", "in cloud", Theme.cloud)
            stat("\(s.facts.count)", "facts kept", Theme.text)
            stat("\(s.rejected)", "rejected", Theme.muted)
          }
          if s.lastMs > 0 { Text("last post: \(Int(s.lastMs)) ms").font(Theme.mono(11)).foregroundStyle(Theme.muted) }
          if s.unreadable + s.malformed > 0 || !s.lastError.isEmpty || !s.lastReply.isEmpty {
            DisclosureGroup {
              VStack(alignment: .leading, spacing: 6) {
                Text("unreadable replies: \(s.unreadable) · malformed facts: \(s.malformed) · retried: \(s.failed)").font(Theme.mono(10))
                if !s.lastReply.isEmpty { Text("last reply: \(s.lastReply)").font(Theme.mono(10)).foregroundStyle(Theme.muted).lineLimit(12) }
                if !s.lastError.isEmpty { Text("last error: \(s.lastError)").font(Theme.mono(10)).foregroundStyle(Theme.danger).lineLimit(6) }
              }
              .textSelection(.enabled)
            } label: {
              Text("Model replies").font(Theme.mono(11)).foregroundStyle(Theme.muted)
            }
          }
          if s.blocked {
            Text(AIError.blocked.localizedDescription).font(.footnote).foregroundStyle(Theme.danger)
          }
          if let p = s.current {
            Text("“\(p.text)”").font(.footnote).foregroundStyle(Theme.muted).lineLimit(3)
              .transition(.opacity).id(p.id)
          }
        }

        if !s.facts.isEmpty {
          let counted = Set(d.attributes.flatMap { $0.facts.map(\.id) } + d.regionFacts.map(\.id))
          VStack(alignment: .leading, spacing: 8) {
            Text("WHAT IT FOUND").font(Theme.mono(11)).tracking(1).foregroundStyle(Theme.muted)
            Text("\(counted.count) of \(s.facts.count) details count toward the estimate (cited base rates only).")
              .font(.caption).foregroundStyle(Theme.muted)
            FlowLayout(spacing: 8) {
              ForEach(s.facts.reversed()) { f in FactChip(fact: f, counted: counted.contains(f.id)) }
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
          .disabled(s.facts.isEmpty)
      }
      .controlSize(.large)
      .padding(.horizontal, 16).padding(.vertical, 10)
      .background(.bar)
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
  }
}

/// Wrapping row layout for chips.
struct FlowLayout: Layout {
  var spacing: CGFloat = 8
  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? .infinity
    var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, maxX: CGFloat = 0
    for v in subviews {
      let s = v.sizeThatFits(.unspecified)
      if x > 0 && x + s.width > width { x = 0; y += rowH + spacing; rowH = 0 }
      x += s.width + spacing; rowH = max(rowH, s.height); maxX = max(maxX, x)
    }
    return CGSize(width: min(width, maxX), height: y + rowH)
  }
  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
    for v in subviews {
      let s = v.sizeThatFits(.unspecified)
      if x > bounds.minX && x + s.width > bounds.maxX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
      v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
      x += s.width + spacing; rowH = max(rowH, s.height)
    }
  }
}
