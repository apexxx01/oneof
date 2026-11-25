import OneOfCore
import SwiftUI

enum Screen: Hashable { case scan, dossier, draft, ledger, paste }

struct RootView: View {
  @Environment(AppModel.self) private var model
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
            HStack {
              Button {
                model.startScan(posts: p.asPosts, data: .synthetic, title: "@\(p.handle)", limit: 60)
                path.append(.scan)
              } label: { Text("Quick scan · 60 posts").frame(maxWidth: .infinity) }
                .buttonStyle(.borderedProminent)
              Button {
                model.startScan(posts: p.asPosts, data: .synthetic, title: "@\(p.handle)")
                path.append(.scan)
              } label: { Text("All \(p.posts.count)") }
                .buttonStyle(.bordered)
            }
            Text("Route: PREFER_ON_DEVICE. Synthetic data may fall back to Gemini in the cloud if the on-device model is missing.")
              .font(Theme.mono(10)).foregroundStyle(Theme.muted)
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
          if !model.status.ok { Text("Needs Apple Intelligence").font(Theme.mono(11)).foregroundStyle(Theme.amber) }
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
            Text("What the cloud saw: \(s.calls) calls · \(s.postBytesOut) bytes of posts")
            Spacer()
            Image(systemName: "chevron.right")
          }
          .font(Theme.mono(12))
          .foregroundStyle(Theme.muted)
        }

        Text("Synthetic demo data only on this screen. Built on Firebase AI Logic hybrid inference: Apple Foundation Models on-device, Gemini in the cloud. Firebase config: \(FirebaseBoot.configSource).")
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
      Divider().overlay(Theme.line)
      VStack(alignment: .leading, spacing: 4) {
        routeRow("your posts & drafts", "ONLY_ON_DEVICE", Theme.device)
        routeRow("synthetic demo", "PREFER_ON_DEVICE", Theme.device)
        routeRow("base rates (1 generic attribute)", "ONLY_IN_CLOUD", Theme.cloud)
      }
    }
  }
  private func routeRow(_ what: String, _ mode: String, _ c: Color) -> some View {
    HStack { Text(what).font(.caption).foregroundStyle(Theme.muted); Spacer(); Text(mode).font(Theme.mono(10)).foregroundStyle(c) }
  }
}
