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
  /// The rewrite, re-checked on-device: the honest measure of what the blur removed.
  @State private var blurredFacts: [Fact]?
  @State private var lastMs: Double = 0
  @FocusState private var focused: Bool

  var body: some View {
    let draftDossier = buildDossier(facts, extraRates: model.rateCache)
    let alone = crowdNow(draftDossier)
    let history = model.scan.facts
    let combined = history.isEmpty ? nil : crowdNow(buildDossier(history + facts, extraRates: model.rateCache))
    let before: CrowdEstimate? = history.isEmpty ? nil : model.crowd
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        Panel {
          SectionHead("Your draft")
          TextEditor(text: $text)
            .focused($focused)
            .overlay(alignment: .topLeading) {
              if text.isEmpty { Text("Write a post or comment…").foregroundStyle(Theme.muted).padding(.top, 8).padding(.leading, 5).allowsHitTesting(false) }
            }
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
            if let combined, let before {
              CrowdField(lit: crowdLit(before, model.dossier.region), previewLit: crowdLit(combined, model.dossier.region), band: combined.band)
                .frame(height: 140)
              Text("Outlined dots switch off if you post this.").font(.caption).foregroundStyle(Theme.muted)
            }
            Meter(e: alone, label: "This draft alone", compact: true)
            if let combined, let before {
              Divider().overlay(Theme.line)
              Text("With the posts already scanned: one of ~\(humanCount(before.p50)) → **one of ~\(humanCount(combined.p50))**")
                .font(.subheadline)
            }
            if !facts.isEmpty {
              FlowLayout(spacing: 6) { ForEach(facts) { f in FactChip(fact: f) } }
            } else {
              Text("No new details found in this draft.").font(.footnote).foregroundStyle(Theme.muted)
            }
            if lastMs > 0 { Text("checked on-device in \(Int(lastMs)) ms").font(Theme.mono(10)).foregroundStyle(Theme.muted) }
          }
        }

        if !facts.isEmpty {
          Panel {
            SectionHead("Blur it")
            if let b = blurred {
              Text(b.rewrite).font(.body).textSelection(.enabled)
              if let bf = blurredFacts {
                let after = crowdNow(buildDossier(bf, extraRates: model.rateCache))
                let gone = facts.filter { f in !bf.contains { $0.cat == f.cat && $0.value.lowercased() == f.value.lowercased() } }
                Text("Re-checked on-device: this draft alone goes from one of ~\(humanCount(alone.p50)) to **one of ~\(humanCount(after.p50))**.").font(.subheadline)
                if !gone.isEmpty { Text("No longer gives away: \(gone.map(\.value).joined(separator: ", "))").font(.caption).foregroundStyle(Theme.muted) }
                if !bf.isEmpty { Text("Still there: \(bf.map(\.value).joined(separator: ", "))").font(.caption).foregroundStyle(Theme.amber) }
              } else {
                HStack { ProgressView().controlSize(.small); Text("Re-checking the rewrite on-device…").font(.caption).foregroundStyle(Theme.muted) }
              }
              HStack {
                Button("Use this") { text = b.rewrite; blurred = nil; blurredFacts = nil }.buttonStyle(Brutal(primary: true))
                Button("Copy") { UIPasteboard.general.string = b.rewrite }.buttonStyle(Brutal())
              }
            } else {
              Button { Task { await blur() } } label: {
                Label(blurring ? "Rewriting on-device…" : "Rewrite without the giveaways", systemImage: "eye.slash")
              }
              .buttonStyle(Brutal())
              .disabled(blurring || !model.status.ok)
            }
          }
        }
      }
      .padding(16)
    }
    .navigationTitle("Draft checker")
    .navigationBarTitleDisplayMode(.inline)
    .onAppear { takeInbox() }
    .onChange(of: IntentInbox.shared.draft) { _, _ in takeInbox() }
    .task(id: text) {
      // Debounce: check once typing pauses.
      try? await Task.sleep(nanoseconds: 900_000_000)
      if Task.isCancelled { return }
      await check()
    }
  }

  private func takeInbox() {
    if let d = IntentInbox.shared.draft { text = d; IntentInbox.shared.draft = nil }
  }

  private func check() async {
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard t.count >= 12, t != checkedText, model.status.ok else { return }
    checking = true
    defer { checking = false }
    do {
      let r = try await model.ai.extract(Post(id: "draft", date: ISO8601DateFormatter().string(from: Date()), text: t), data: .own, task: .draft)
      guard !Task.isCancelled else { return }
      facts = r.outcome.facts
      lastMs = r.ms
      checkedText = t
      blurred = nil
      blurredFacts = nil
      error = nil
    } catch is CancellationError {
      // Typing again cancels the check in flight; not an error.
    } catch {
      if !Task.isCancelled { self.error = error.localizedDescription }
    }
  }

  private func blur() async {
    blurring = true
    defer { blurring = false }
    blurredFacts = nil
    do {
      let b = try await model.ai.blur(text)
      blurred = b
      let r = try await model.ai.extract(Post(id: "draft-blurred", date: ISO8601DateFormatter().string(from: Date()), text: b.rewrite), data: .own, task: .draft)
      blurredFacts = r.outcome.facts
    } catch is CancellationError {} catch { self.error = error.localizedDescription }
  }
}
