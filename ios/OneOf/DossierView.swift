import Charts
import OneOfCore
import SwiftUI

struct DossierView: View {
  @Environment(AppModel.self) private var model
  @State private var showLookups = false
  @State private var trail: [TrailPoint] = []
  @State private var fix: [Attribute] = []
  @State private var afterFix: CrowdEstimate?

  var body: some View {
    let d = model.dossier
    let crowd = model.crowd
    let left = leftTheCrowd(trail)
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        Panel { Meter(e: crowd, label: "The dossier") }

        Text("OneOf can miss details an attacker would find (on held-out data the on-device model caught about 4 in 10), so treat this as an upper bound on how many people you could be.")
          .font(.caption).foregroundStyle(Theme.muted)

        if trail.count > 1 {
          Panel {
            Text("THE CRUMB TRAIL").font(Theme.mono(11)).tracking(1).foregroundStyle(Theme.muted)
            Text("No single post gave you away. Together, they did. Drag across the chart.").font(.caption).foregroundStyle(Theme.muted)
            TrailChart(points: trail, leftDate: left?.date)
            if let left {
              Text("You left the crowd in \(shortDate(left.date)), when you mentioned **\(left.added.joined(separator: ", "))**.")
                .font(.subheadline)
            }
          }
        }

        Panel {
          Text("WHAT A STRANGER LEARNS").font(Theme.mono(11)).tracking(1).foregroundStyle(Theme.muted)
          HStack { Text(d.region.label).font(.subheadline.weight(.semibold)); Spacer(); GradeBadge(grade: d.region.grade) }
          Text("\(Int(d.region.population).formatted()) people · \(d.region.source)").font(.caption2).foregroundStyle(Theme.muted)
          if let u = d.region.url, let url = URL(string: u) { Link("Source", destination: url).font(.caption2) }
          ForEach(d.attributes, id: \.rate.key) { a in
            Divider().overlay(Theme.line)
            AttributeRow(a: a)
          }
          if d.attributes.isEmpty { Text("Nothing identifying yet.").font(.footnote).foregroundStyle(Theme.muted) }
        }

        if !fix.isEmpty {
          Panel {
            Text("REJOIN THE CROWD").font(Theme.mono(11)).tracking(1).foregroundStyle(Theme.muted)
            let facts = fix.flatMap(\.facts)
            let posts = Set(facts.map(\.postId))
            Text("Edit or delete **\(posts.count) post\(posts.count == 1 ? "" : "s")**\(afterFix.map { " to get back to one of ~\(humanCount($0.p50))" } ?? ""): drop \(fix.map(\.rate.label).joined(separator: ", ")).")
              .font(.subheadline)
            ForEach(facts) { f in
              VStack(alignment: .leading, spacing: 2) {
                Text(shortDate(f.date)).font(Theme.mono(10)).foregroundStyle(Theme.muted)
                Text("“\(f.quote)”").font(.caption).italic()
              }
            }
          }
        }

        if !d.unresolved.isEmpty || !d.localOnly.isEmpty {
          Panel {
            Text("NOT COUNTED (YET)").font(Theme.mono(11)).tracking(1).foregroundStyle(Theme.muted)
            if !d.localOnly.isEmpty {
              Text("\(d.localOnly.count) health or religion detail\(d.localOnly.count == 1 ? "" : "s") stay on this iPhone, never looked up.")
                .font(.footnote).foregroundStyle(Theme.muted)
            }
            if !d.unresolved.isEmpty {
              let uniq = Dictionary(grouping: d.unresolved) { "\($0.cat)|\($0.value.lowercased())" }.values.map { ($0[0], $0.count) }.sorted { $0.0.date < $1.0.date }
              FlowLayout(spacing: 6) { ForEach(uniq, id: \.0.id) { f, n in FactChip(fact: f, counted: false, count: n) } }
              Text("No bundled base rate for these. A lookup sends one generic attribute per call, after you confirm.")
                .font(.footnote).foregroundStyle(Theme.muted)
              Button { showLookups = true } label: {
                Label(model.refreshing ? "Looking up…" : "Look up base rates", systemImage: "magnifyingglass")
              }
              .buttonStyle(.bordered)
              .disabled(model.refreshing || model.plannedLookups.isEmpty)
            }
          }
        }

        Text("Only numbers with a citation narrow the crowd. Grades: A official table, B derived, C rough (widest range). Ranges are P10–P90 over 4,000 draws, with a correlation correction so the crowd is never shown smaller than it is.")
          .font(.caption2).foregroundStyle(Theme.muted)
      }
      .padding(16)
    }
    .navigationTitle("Dossier")
    .navigationBarTitleDisplayMode(.inline)
    .sheet(isPresented: $showLookups) { LookupSheet().presentationDetents([.medium, .large]) }
    .task(id: d) {
      // Each crumb is a 4,000-draw estimate: compute off the main thread.
      let (t, f, a) = await Task.detached(priority: .userInitiated) { () -> ([TrailPoint], [Attribute], CrowdEstimate?) in
        let t = crumbTrail(d)
        let f = minimumFix(d)
        let a: CrowdEstimate? = f.isEmpty ? nil : estimate(d.region, d.attributes.filter { x in !f.contains { $0.rate.key == x.rate.key } })
        return (t, f, a)
      }.value
      trail = t; fix = f; afterFix = a
    }
  }
}

struct AttributeRow: View {
  let a: Attribute
  @State private var open = false
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Button { withAnimation { open.toggle() } } label: {
        HStack(alignment: .firstTextBaseline) {
          GradeBadge(grade: a.rate.grade)
          Text(a.rate.label).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.text)
          Spacer()
          Text(pct(a.rate.high)).font(Theme.mono(12)).foregroundStyle(Theme.signal)
        }
      }
      .buttonStyle(.plain)
      .accessibilityValue(open ? "expanded" : "collapsed")
      .accessibilityHint("Shows the quotes and the source")
      Text("since \(shortDate(a.firstSeen)) · \(a.facts.count) post\(a.facts.count == 1 ? "" : "s")").font(.caption2).foregroundStyle(Theme.muted)
      if open {
        ForEach(a.facts) { f in
          HStack(alignment: .top) {
            Text("“\(f.quote)”").font(.caption).italic().foregroundStyle(Theme.text)
            Spacer()
            Badge.fact(f.source)
          }
        }
        Text(a.rate.source).font(.caption2).foregroundStyle(Theme.muted)
        if let u = a.rate.url, let url = URL(string: u) { Link(u, destination: url).font(.caption2) }
      }
    }
  }
}

struct TrailChart: View {
  let points: [TrailPoint]
  var leftDate: String? = nil
  @State private var selected: Date?

  private struct Item: Identifiable { let id: Int; let date: Date; let p: TrailPoint }

  var body: some View {
    let items: [Item] = points.enumerated().compactMap { i, p in parseISO(p.date).map { Item(id: i, date: $0, p: p) } }
    let pick: Item? = selected.flatMap { s in items.last { $0.date <= s } ?? items.first }
    VStack(alignment: .leading, spacing: 6) {
      Chart {
        ForEach(items) { it in
          AreaMark(x: .value("Date", it.date), yStart: .value("P10", it.p.estimate.p10), yEnd: .value("P90", it.p.estimate.p90))
            .foregroundStyle(Theme.signal.opacity(0.18))
            .interpolationMethod(.stepEnd)
          LineMark(x: .value("Date", it.date), y: .value("Crowd", it.p.estimate.p50))
            .foregroundStyle(Theme.signal)
            .interpolationMethod(.stepEnd)
          PointMark(x: .value("Date", it.date), y: .value("Crowd", it.p.estimate.p50))
            .foregroundStyle(bandColor(it.p.estimate.band))
            .symbolSize(pick?.id == it.id ? 120 : 40)
        }
        RuleMark(y: .value("A room", 100.0)).foregroundStyle(Theme.muted.opacity(0.5)).lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
          .annotation(position: .bottom, alignment: .leading) { Text("a room").font(Theme.mono(9)).foregroundStyle(Theme.muted) }
        if let l = leftDate.flatMap(parseISO) {
          RuleMark(x: .value("Left the crowd", l)).foregroundStyle(Theme.danger.opacity(0.6))
            .annotation(position: .top, alignment: .leading) { Text("left the crowd").font(Theme.mono(9)).foregroundStyle(Theme.danger) }
        }
        if let pick {
          RuleMark(x: .value("Selected", pick.date)).foregroundStyle(Theme.text.opacity(0.4))
        }
      }
      .chartXSelection(value: $selected)
      .chartYScale(domain: 1.0...4.0e8, type: .log)
      .chartYAxis {
        AxisMarks(values: [1.0, 100.0, 1.0e4, 1.0e6, 1.0e8]) { v in
          AxisGridLine().foregroundStyle(Theme.line)
          AxisValueLabel { if let d = v.as(Double.self) { Text(axisLabel(d)).font(Theme.mono(9)) } }
        }
      }
      .chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) { _ in AxisValueLabel(format: .dateTime.year()) } }
      .frame(height: 220)
      .sensoryFeedback(.selection, trigger: pick?.id)
      .accessibilityLabel("Crowd size after each detail, from \(humanCount(points.first?.estimate.p50 ?? 0)) down to \(humanCount(points.last?.estimate.p50 ?? 0))")
      Text(pick.map { "\(shortDate($0.p.date)) · + \($0.p.added.joined(separator: ", ")) → one of ~\(humanCount($0.p.estimate.p50))" } ?? "Each step is a detail you posted, in the order you posted it.")
        .font(Theme.mono(11)).foregroundStyle(pick == nil ? Theme.muted : Theme.text)
        .contentTransition(.opacity)
    }
  }
}

struct LookupSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    let plan = model.plannedLookups
    let country = model.dossier.region.key.hasPrefix("in") ? "India" : "United States"
    NavigationStack {
      List {
        Section {
          ForEach(plan) { p in
            Text(baseRatePrompt(attribute: p.attribute, country: country)).font(Theme.mono(12))
          }
        } header: {
          Text("Exactly what will be sent")
        } footer: {
          Text("One Gemini call per entry, exactly this text. No posts, no quotes, no names: values that look like names, numbers or long phrases stay on this iPhone.")
        }
      }
      .navigationTitle("Look up base rates")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Send \(plan.count)") {
            dismiss()
            Task { await model.refineRates(plan) }
          }
          .disabled(plan.isEmpty)
        }
      }
    }
  }
}

/// Short tick labels, the same as the meter's scale (1, 100, 10k, 1M, 100M).
func axisLabel(_ d: Double) -> String {
  switch d { case ..<10: return "1"; case ..<1000: return "100"; case ..<1e5: return "10k"; case ..<1e7: return "1M"; default: return "100M" }
}
