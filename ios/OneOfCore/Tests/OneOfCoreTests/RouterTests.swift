import XCTest
@testable import OneOfCore

final class RouterTests: XCTestCase {
  func testOwnWordsNeverRouteToTheCloud() {
    for task in [AITask.extract, .draft, .blur] {
      XCTAssertEqual(route(task, .own).mode, .onlyOnDevice, "\(task)")
    }
    // A draft typed on the demo screen is still the user's own words.
    XCTAssertEqual(route(.draft, .synthetic).mode, .onlyOnDevice)
    XCTAssertEqual(route(.blur, .synthetic).mode, .onlyOnDevice)
    XCTAssertEqual(route(.extract, .synthetic).mode, .preferOnDevice)
    XCTAssertEqual(route(.baserate, .own).mode, .onlyInCloud)
  }

  func testLedgerCountsBytesBySide() {
    let s = summarize([
      LedgerEntry(task: .extract, mode: .onlyOnDevice, reason: "", source: .on_device, ms: 900, sentToCloud: ""),
      LedgerEntry(task: .baserate, mode: .onlyInCloud, reason: "", source: .in_cloud, ms: 400, sentToCloud: "Attribute: occupation: welder\nCountry: United States"),
      LedgerEntry(task: .extract, mode: .preferOnDevice, reason: "", source: .in_cloud, ms: 700, sentToCloud: "Posts:\n[0] hi", data: .synthetic),
    ])
    XCTAssertEqual(s.ownPostBytesOut, 0); XCTAssertEqual(s.demoPostBytesOut, 13)
    // A draft is the user's own words whatever the caller claims.
    XCTAssertEqual(LedgerEntry(task: .draft, mode: .onlyOnDevice, reason: "", source: .on_device, ms: 1, sentToCloud: "", data: .synthetic).data, .own)
    XCTAssertEqual(s.calls, 3); XCTAssertEqual(s.onDevice, 1); XCTAssertEqual(s.inCloud, 2)
    XCTAssertEqual(s.postBytesOut, 13); XCTAssertEqual(s.attrBytesOut, "Attribute: occupation: welder\nCountry: United States".utf8.count)
  }
}
