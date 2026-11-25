import OneOfCore
import SwiftUI
import UIKit

enum Screen: Hashable { case scan, dossier, draft, ledger, paste }

struct RootView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.scenePhase) private var scenePhase
  @State private var path: [Screen] = []

  var body: some View {
    NavigationStack(path: $path) {
      HomeView(path: $path)
        .navigationDestination(for: Screen.self) { s in
          Group {
            switch s {
            case .scan: ScanView(path: $path)
            case .dossier: DossierView()
            case .draft: DraftView()
            case .ledger: LedgerView()
            case .paste: PasteView(path: $path)
            }
          }
          .background(Theme.bg.ignoresSafeArea())
        }
        .background(Theme.bg.ignoresSafeArea())
    }
    // The app switcher snapshot never shows pasted posts or drafts.
    .overlay { if scenePhase != .active { Theme.bg.ignoresSafeArea().overlay(Text("one/of").font(Theme.mono(15, .bold)).foregroundStyle(Theme.signal)) } }
    .onChange(of: scenePhase) { _, p in model.setActive(p == .active) }
    .task {
      // Apple Intelligence may still be downloading its model: keep checking until it's ready.
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: 5_000_000_000)
        if model.status != .available { model.refreshStatus() }
      }
    }
  }
}

struct LedgerButton: View {
  @Environment(AppModel.self) private var model
  @Binding var path: [Screen]
  var body: some View {
    Button { path.append(.ledger) } label: {
      Label("What the cloud saw", systemImage: "icloud.and.arrow.up")
    }
    .accessibilityHint("\(model.summary.calls) model calls so far")
  }
}

struct HomeView: View {
  @Environment(AppModel.self) private var model
  @Binding var path: [Screen]

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        HStack(spacing: 10) {
          Text("one/of").font(Theme.mono(15, .bold)).foregroundStyle(Color(hex: 0x120604))
            .padding(.horizontal, 8).padding(.vertical, 3).background(Theme.signal, in: RoundedRectangle(cornerRadius: 7))
          Text("OneOf").font(.title3.weight(.semibold))
          Spacer()
        }
        VStack(alignment: .leading, spacing: 8) {
          Text("Pseudonymous until you're not.").font(.system(size: 32, weight: .bold)).foregroundStyle(Theme.text)
          Text("OneOf reads your posts on this iPhone with Apple's on-device model, builds the dossier a stranger would, and tells you how many people you could be. Your posts never leave the phone.")
            .font(.body).foregroundStyle(Theme.muted)
        }

        StatusPanel()

        if let p = model.persona {
          Panel {
            Text("WATCH A SCAN").font(Theme.mono(11)).tracking(1).foregroundStyle(Theme.muted)
            Text("@\(p.handle)").font(.headline)
            Text("\(p.posts.count) synthetic posts by an invented night-shift nurse. No real person. Watch the crowd shrink one detail at a time.")
              .font(.subheadline).foregroundStyle(Theme.muted)
            if model.status.ok {
              HStack {
                Button {
                  model.startScan(posts: p.asPosts, data: .synthetic, title: "@\(p.handle)")
                  path.append(.scan)
                } label: { Text("Scan all \(p.posts.count) posts").frame(maxWidth: .infinity) }
                  .buttonStyle(.borderedProminent)
                Button {
                  model.startScan(posts: p.asPosts, data: .synthetic, title: "@\(p.handle)", limit: 60)
                  path.append(.scan)
                } label: { Text("Quick · 60") }
                  .buttonStyle(.bordered)
              }
              Text("About 2–3 minutes on this iPhone, nothing sent anywhere.").font(.caption).foregroundStyle(Theme.muted)
            } else {
              Button {
                model.startScan(posts: p.asPosts, data: .synthetic, title: "@\(p.handle)", limit: 25)
                path.append(.scan)
              } label: { Text("Run 25 posts via the cloud").frame(maxWidth: .infinity) }
                .buttonStyle(.bordered)
              Text("Without Apple Intelligence this demo data falls back to Gemini in the cloud (free tier, so capped at 25 posts and a partial dossier). Your own posts never do.")
                .font(.caption).foregroundStyle(Theme.muted)
            }
          }
        }

        Panel {
          Text("YOUR OWN POSTS").font(Theme.mono(11)).tracking(1).foregroundStyle(Theme.muted)
          Text("Paste your post history").font(.headline)
          Text("Only on this iPhone. If Apple Intelligence is off, OneOf refuses rather than send your words anywhere.")
            .font(.subheadline).foregroundStyle(Theme.muted)
          Button { path.append(.paste) } label: { Text("Paste posts").frame(maxWidth: .infinity) }
            .buttonStyle(.bordered)
            .disabled(!model.status.ok)
          if !model.status.ok { Text("Needs Apple Intelligence: your posts are never sent to the cloud instead.").font(.caption).foregroundStyle(Theme.amber) }
        }

        Panel {
          Text("BEFORE YOU POST").font(Theme.mono(11)).tracking(1).foregroundStyle(Theme.muted)
          Text("Check a draft").font(.headline)
          Text("See what a draft gives away before you post it, and get a blurred rewrite. On-device only.")
            .font(.subheadline).foregroundStyle(Theme.muted)
          Button { path.append(.draft) } label: { Text("Open the draft checker").frame(maxWidth: .infinity) }
            .buttonStyle(.bordered)
        }

        Button { path.append(.ledger) } label: {
          let s = model.summary
          HStack {
            Image(systemName: "icloud.and.arrow.up")
            Text("What the cloud saw: \(s.ownPostBytesOut) bytes of your posts\(s.demoPostBytesOut > 0 ? " · \(s.demoPostBytesOut) B of demo posts" : "")")
            Spacer()
            Image(systemName: "chevron.right")
          }
          .font(Theme.mono(12))
          .foregroundStyle(Theme.muted)
        }

        Text("Built on Firebase AI Logic hybrid inference: Apple's on-device model for anything you write, Gemini in the cloud only for public statistics. English only.")
          .font(.caption2).foregroundStyle(Theme.muted)
      }
      .padding(20)
    }
    .scrollIndicators(.hidden)
    .onAppear { model.refreshStatus() }
    .toolbar(.hidden, for: .navigationBar)
  }
}

struct StatusPanel: View {
  @Environment(AppModel.self) private var model
  var body: some View {
    Panel {
      HStack {
        Circle().fill(model.status.ok ? Theme.device : Theme.amber).frame(width: 9, height: 9)
        Text("On-device model").font(.subheadline.weight(.semibold))
        Spacer()
        Badge(text: model.status.ok ? "APPLE INTELLIGENCE" : "UNAVAILABLE", color: model.status.ok ? Theme.device : Theme.amber)
      }
      Text(model.status.label).font(.footnote).foregroundStyle(Theme.muted)
      if model.status == .notEnabled || model.status == .notReady {
        Button("Open Settings") {
          if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
        }
        .font(.footnote)
        Text("Settings › Apple Intelligence & Siri. The model downloads once; OneOf checks again automatically.").font(.caption2).foregroundStyle(Theme.muted)
      }
      Divider().overlay(Theme.line)
      VStack(alignment: .leading, spacing: 4) {
        routeRow("Your posts and drafts", "this iPhone only", Theme.device)
        routeRow("Demo persona", "on-device, cloud as backup", Theme.device)
        routeRow("Public statistics", "cloud, one generic word", Theme.cloud)
      }
    }
  }
  private func routeRow(_ what: String, _ mode: String, _ c: Color) -> some View {
    HStack { Text(what).font(.caption).foregroundStyle(Theme.muted); Spacer(); Text(mode).font(Theme.mono(10)).foregroundStyle(c) }
  }
}
