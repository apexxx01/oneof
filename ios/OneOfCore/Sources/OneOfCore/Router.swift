import Foundation

/// Where each model call may run. Same table as the web build (src/lib/ai.ts route()).
/// Own data never leaves the device; synthetic demo data may fall back to the cloud;
/// base rates go to the cloud as one generic attribute, never the user's words.
public enum DataKind: String, Codable, Sendable { case own, synthetic }
public enum AITask: String, Codable, Sendable { case extract, draft, blur, baserate }
public enum RouteMode: String, Codable, Sendable {
  case onlyOnDevice = "ONLY_ON_DEVICE"
  case preferOnDevice = "PREFER_ON_DEVICE"
  case onlyInCloud = "ONLY_IN_CLOUD"
}

public struct Route: Equatable, Sendable {
  public let mode: RouteMode
  public let reason: String
}

public func route(_ task: AITask, _ data: DataKind) -> Route {
  if task == .baserate {
    return Route(mode: .onlyInCloud, reason: "Needs current statistics. Sends one generic attribute, never your words.")
  }
  // Drafts and rewrites are always the user's own words, whatever screen they come from.
  if data == .own || task == .draft || task == .blur {
    return Route(mode: .onlyOnDevice, reason: "Your own posts and drafts never leave this iPhone.")
  }
  return Route(mode: .preferOnDevice, reason: "Synthetic demo data: runs on-device when available, cloud fallback allowed.")
}

/// One model call, as shown in "What the cloud saw".
public struct LedgerEntry: Identifiable, Codable, Equatable, Sendable {
  public enum Source: String, Codable, Sendable { case on_device, in_cloud, blocked, error }
  public var id = UUID()
  public var at = Date()
  public var task: AITask
  public var mode: RouteMode
  public var reason: String
  public var source: Source
  public var ms: Double
  /// Exactly the text that left the device ("" when nothing did).
  public var sentToCloud: String
  public var model: String?
  public var error: String?
  /// Whose words these were. Drafts and rewrites are always the user's own.
  public var data: DataKind
  public init(task: AITask, mode: RouteMode, reason: String, source: Source, ms: Double, sentToCloud: String, model: String? = nil, error: String? = nil, data: DataKind = .own) {
    self.task = task; self.mode = mode; self.reason = reason; self.source = source; self.ms = ms
    self.sentToCloud = sentToCloud; self.model = model; self.error = error
    self.data = (task == .draft || task == .blur) ? .own : data
  }
}

public struct LedgerSummary: Equatable, Sendable {
  public var calls = 0, onDevice = 0, inCloud = 0, blocked = 0, errors = 0
  /// Bytes of post or draft text that left the device. The privacy claim is that this is 0
  /// for the user's own data.
  public var postBytesOut = 0
  /// The user's own posts and drafts. The privacy claim is that this stays 0.
  public var ownPostBytesOut = 0
  /// Synthetic demo posts that went to the cloud (fallback when on-device was unavailable or failed).
  public var demoPostBytesOut = 0
  /// Bytes of generic attributes sent for base-rate lookups.
  public var attrBytesOut = 0
}

public func summarize(_ entries: [LedgerEntry]) -> LedgerSummary {
  var s = LedgerSummary()
  for e in entries {
    s.calls += 1
    switch e.source { case .on_device: s.onDevice += 1; case .in_cloud: s.inCloud += 1; case .blocked: s.blocked += 1; case .error: s.errors += 1 }
    let bytes = e.sentToCloud.utf8.count
    if e.task == .baserate { s.attrBytesOut += bytes } else {
      s.postBytesOut += bytes
      if e.data == .own { s.ownPostBytesOut += bytes } else { s.demoPostBytesOut += bytes }
    }
  }
  return s
}
