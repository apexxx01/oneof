import OneOfCore
import SwiftUI

struct LedgerView: View {
  @Environment(AppModel.self) private var model
  @AppStorage("oneof.dev") private var dev = false
  var body: some View {
    let s = model.summary
    List {
      Section {
        row("Your posts and drafts sent to the cloud", "\(s.ownPostBytesOut) bytes", s.ownPostBytesOut == 0 ? Theme.device : Theme.danger)
        if s.demoPostBytesOut > 0 { row("Synthetic demo posts (cloud fallback)", "\(s.demoPostBytesOut) bytes", Theme.cloud) }
        row("Generic attributes sent for base rates", "\(s.attrBytesOut) bytes", Theme.cloud)
        row("Calls on-device / in cloud", "\(s.onDevice) / \(s.inCloud)", Theme.text)
        if s.blocked > 0 { row("Refused (no on-device model)", "\(s.blocked)", Theme.amber) }
        if s.errors > 0 { row("Errors", "\(s.errors)", Theme.danger) }
      } footer: {
        Text("Every model call, newest first. \"Sent\" is exactly the text that left this iPhone. Synthetic demo posts may show here if the on-device model was unavailable; your own never do.")
      }
      Section("Calls") {
        if model.ledger.isEmpty { Text("No calls yet.").foregroundStyle(Theme.muted) }
        ForEach(model.ledger) { e in
          VStack(alignment: .leading, spacing: 4) {
            HStack {
              Badge.source(e.source)
              Text(e.task.rawValue).font(Theme.mono(12))
              Spacer()
              Text("\(Int(e.ms)) ms").font(Theme.mono(11)).foregroundStyle(Theme.muted)
            }
            Text("\(e.mode.rawValue): \(e.reason)").font(.caption2).foregroundStyle(Theme.muted)
            if !e.sentToCloud.isEmpty {
              Text("Sent: \(e.sentToCloud)").font(Theme.mono(10)).foregroundStyle(Theme.cloud).lineLimit(dev ? nil : 4).textSelection(.enabled)
            } else {
              Text("Sent: nothing").font(Theme.mono(10)).foregroundStyle(Theme.device)
            }
            if let m = e.model { Text(m).font(Theme.mono(9)).foregroundStyle(Theme.muted) }
            if let err = e.error { Text(err).font(Theme.mono(9)).foregroundStyle(Theme.danger).lineLimit(3) }
          }
          .padding(.vertical, 2)
        }
      }
    }
    .safeAreaInset(edge: .bottom) {
      Toggle("Developer diagnostics", isOn: $dev).font(.caption).padding(.horizontal, 20).padding(.vertical, 8).background(.bar)
    }
    .scrollContentBackground(.hidden)
    .navigationTitle("What the cloud saw")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Clear") { model.clearLedger() }.disabled(model.ledger.isEmpty) } }
  }
  private func row(_ l: String, _ v: String, _ c: Color) -> some View {
    HStack { Text(l).font(.footnote); Spacer(); Text(v).font(Theme.mono(13, .semibold)).foregroundStyle(c) }
  }
}

struct PasteView: View {
  @Environment(AppModel.self) private var model
  @Binding var path: [Screen]
  @State private var text = ""
  var body: some View {
    let posts = postsFromPaste(text)
    VStack(alignment: .leading, spacing: 12) {
      Text("Paste posts or comments, separated by blank lines (or one per line). Oldest first gives the best crumb trail.")
        .font(.footnote).foregroundStyle(Theme.muted)
      TextEditor(text: $text)
        .scrollContentBackground(.hidden)
        .padding(8)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line))
      HStack {
        Text("\(posts.count) post\(posts.count == 1 ? "" : "s")").font(Theme.mono(12)).foregroundStyle(Theme.muted)
        Spacer()
        Badge(text: "ONLY_ON_DEVICE", color: Theme.device)
      }
      Button {
        model.startScan(posts: posts, data: .own, title: "Your posts")
        path.append(.scan)
      } label: { Text("Scan on this iPhone").frame(maxWidth: .infinity) }
        .buttonStyle(.borderedProminent)
        .disabled(posts.isEmpty || !model.status.ok)
    }
    .padding(16)
    .navigationTitle("Your posts")
    .navigationBarTitleDisplayMode(.inline)
  }
}
