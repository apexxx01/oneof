import Charts
import OneOfCore
import SwiftUI

struct DossierView: View {
  @Environment(AppModel.self) private var model
  @State private var showLookups = false

  var body: some View {
    let d = model.dossier
    let crowd = crowdNow(d)
    let trail = crumbTrail(d)
    let left = leftTheCrowd(trail)
    let fix = minimumFix(d)
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        Panel { Meter(e: crowd, label: "The dossier") }

        if trail.count > 1 {
          Panel {
            Text("THE CRUMB TRAIL").font(Theme.mono(11)).tracking(1).foregroundStyle(Theme.muted)
            TrailChart(points: trail)
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
          ForEach(d.attributes, id: \.rate.key) { a in
            Divider().overlay(Theme.line)
            AttributeRow(a: a)
          }
          if d.attributes.isEmpty { Text("Nothing identifying yet.").font(.footnote).foregroundStyle(Theme.muted) }
        }

        if !fix.isEmpty {
          Panel {
            Text("THE SMALLEST FIX").font(Theme.mono(11)).tracking(1).foregroundStyle(Theme.muted)
            let posts = Set(fix.flatMap { $0.facts.map(\.postId) })
            Text("Edit or delete **\(posts.count) post\(posts.count == 1 ? "" : "s")** to get back above 1,000 people: drop \(fix.map(\.rate.label).joined(separator: ", ")).")
              .font(.subheadline)
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
              FlowLayout(spacing: 6) { ForEach(d.unresolved) { f in FactChip(fact: f, counted: false) } }
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
  var body: some View {
    let items = points.enumerated().map { (i: $0.offset, p: $0.element) }
    Chart {
      ForEach(items, id: \.i) { it in
        AreaMark(x: .value("Step", it.i), yStart: .value("P10", it.p.estimate.p10), yEnd: .value("P90", it.p.estimate.p90))
          .foregroundStyle(Theme.signal.opacity(0.18))
          .interpolationMethod(.stepEnd)
        LineMark(x: .value("Step", it.i), y: .value("Crowd", it.p.estimate.p50))
          .foregroundStyle(Theme.signal)
          .interpolationMethod(.stepEnd)
        PointMark(x: .value("Step", it.i), y: .value("Crowd", it.p.estimate.p50))
          .foregroundStyle(bandColor(it.p.estimate.band))
          .annotation(position: .top, alignment: .leading, spacing: 4) {
            Text(it.p.added.first ?? "").font(.system(size: 9)).foregroundStyle(Theme.muted).lineLimit(1).frame(maxWidth: 90, alignment: .leading)
          }
      }
      RuleMark(y: .value("A room", 100)).foregroundStyle(Theme.muted.opacity(0.5)).lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
        .annotation(position: .bottom, alignment: .leading) { Text("a room").font(Theme.mono(9)).foregroundStyle(Theme.muted) }
    }
    .chartYScale(domain: 1.0...4.0e8, type: .log)
    .chartYAxis {
      AxisMarks(values: [1.0, 100.0, 1.0e4, 1.0e6, 1.0e8]) { v in
        AxisGridLine().foregroundStyle(Theme.line)
        AxisValueLabel { if let d = v.as(Double.self) { Text(humanCount(d)).font(Theme.mono(9)) } }
      }
    }
    .chartXAxis(.hidden)
    .frame(height: 220)
    .accessibilityLabel("Crowd size after each detail, from \(humanCount(points.first?.estimate.p50 ?? 0)) down to \(humanCount(points.last?.estimate.p50 ?? 0))")
  }
}

struct LookupSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    let plan = model.plannedLookups
    NavigationStack {
      List {
        Section {
          ForEach(plan) { p in
            Text(p.attribute).font(Theme.mono(13))
          }
        } header: {
          Text("Exactly what will be sent")
        } footer: {
          Text("One Gemini call per line, with the country. No posts, no quotes, no names. Values that look like names, numbers or long phrases are filtered out and stay here.")
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
