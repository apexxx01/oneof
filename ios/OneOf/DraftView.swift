import OneOfCore
import SwiftUI
import UIKit

struct DraftView: View {
  @Environment(AppModel.self) private var model
  @State private var text = ""
  @State private var facts: [Fact] = []
  @State private var checking = false
  @State private var checkedText = ""
  @State private var error: String?
  @State private var blurred: AIService.Blurred?
  @State private var blurring = false
  @State private var lastMs: Double = 0
  @FocusState private var focused: Bool

  var body: some View {
    let draftDossier = buildDossier(facts, extraRates: model.rateCache)
    let alone = crowdNow(draftDossier)
    let history = model.scan.facts
    let combined = history.isEmpty ? nil : crowdNow(buildDossier(history + facts, extraRates: model.rateCache))
    let before = history.isEmpty ? nil : crowdNow(model.dossier)
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        Panel {
          Text("YOUR DRAFT").font(Theme.mono(11)).tracking(1).foregroundStyle(Theme.muted)
          TextEditor(text: $text)
            .focused($focused)
            .frame(minHeight: 120)
            .scrollContentBackground(.hidden)
            .font(.body)
          HStack {
            if text.isEmpty, let sample = model.persona?.draft {
              Button("Use the sample draft") { text = sample }.font(.footnote)
            }
            Spacer()
            if checking { ProgressView().controlSize(.small) }
            Badge(text: "ON DEVICE ONLY", color: Theme.device)
          }
        }

        if !model.status.ok {
          Panel {
            Text("Apple Intelligence is off, so the draft isn't checked. Your words are never sent to the cloud to make up for it.")
              .font(.footnote).foregroundStyle(Theme.amber)
          }
        }

        if let error { Text(error).font(.footnote).foregroundStyle(Theme.danger) }

        if !checkedText.isEmpty {
          Panel {
            Meter(e: alone, label: "This draft alone", compact: true)
            if let combined, let before {
              Divider().overlay(Theme.line)
              Text("With the posts already scanned: one of ~\(humanCount(before.p50)) → **one of ~\(humanCount(combined.p50))**")
                .font(.subheadline)
            }
            if !facts.isEmpty {
              FlowLayout(spacing: 6) { ForEach(facts) { f in FactChip(fact: f) } }
            } else {
              Text("Nothing identifying found.").font(.footnote).foregroundStyle(Theme.device)
            }
            if lastMs > 0 { Text("checked on-device in \(Int(lastMs)) ms").font(Theme.mono(10)).foregroundStyle(Theme.muted) }
          }
        }

        if !facts.isEmpty {
          Panel {
            Text("BLUR IT").font(Theme.mono(11)).tracking(1).foregroundStyle(Theme.muted)
            if let b = blurred {
              Text(b.rewrite).font(.body)
              if let r = b.removed, !r.isEmpty { Text("Removed: \(r.joined(separator: ", "))").font(.caption).foregroundStyle(Theme.muted) }
              HStack {
                Button("Use this") { text = b.rewrite; blurred = nil }.buttonStyle(.borderedProminent)
                Button("Copy") { UIPasteboard.general.string = b.rewrite }.buttonStyle(.bordered)
              }
            } else {
              Button { Task { await blur() } } label: {
                Label(blurring ? "Rewriting on-device…" : "Rewrite without the giveaways", systemImage: "eye.slash")
              }
              .buttonStyle(.bordered)
              .disabled(blurring || !model.status.ok)
            }
          }
        }
      }
      .padding(16)
    }
    .navigationTitle("Draft checker")
    .navigationBarTitleDisplayMode(.inline)
    .task(id: text) {
      // Debounce: check once typing pauses.
      try? await Task.sleep(nanoseconds: 900_000_000)
      if Task.isCancelled { return }
      await check()
    }
  }

  private func check() async {
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard t.count >= 12, t != checkedText, model.status.ok else { return }
    checking = true
    defer { checking = false }
    do {
      let r = try await model.ai.extract(Post(id: "draft", date: ISO8601DateFormatter().string(from: Date()), text: t), data: .own, task: .draft)
      facts = r.outcome.facts
      lastMs = r.ms
      checkedText = t
      blurred = nil
      error = nil
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func blur() async {
    blurring = true
    defer { blurring = false }
    do { blurred = try await model.ai.blur(text) } catch { self.error = error.localizedDescription }
  }
}
