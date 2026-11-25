import XCTest
@testable import OneOfCore

final class ExtractTests: XCTestCase {
  let post = Post(id: "p1", date: "2024-03-01T00:00:00Z", text: "finally got my first night-shift rota at the county hospital, ICU here we go")

  func testFencedJSONWithChatter() {
    let reply = """
    Sure! Here is the JSON:
    ```json
    {"facts":[{"p":0,"cat":"occupation","value":"ICU nurse","quote":"night-shift rota at the county hospital, ICU","about_self":true,"certainty":"implied"}]}
    ```
    """
    let o = processReply(reply, post: post, source: .on_device)
    XCTAssertFalse(o.unreadable)
    XCTAssertEqual(o.facts.map(\.value), ["ICU nurse"])
    XCTAssertEqual(o.facts.first?.id, "p1:0")
  }

  func testLooseTypesAndUnknownCategory() {
    let reply = #"{"facts":[{"p":"0","cat":"occupation","value":"ICU nurse","quote":"county hospital, ICU","about_self":"true"},{"p":0,"cat":"zodiac","value":"leo","quote":"ICU","about_self":true,"certainty":"stated"}]}"#
    let o = processReply(reply, post: post, source: .on_device)
    XCTAssertEqual(o.facts.count, 1)
    XCTAssertEqual(o.facts.first?.certainty, "stated")
  }

  func testHallucinatedQuoteIsRejected() {
    let reply = #"{"facts":[{"p":0,"cat":"occupation","value":"surgeon","quote":"I am a surgeon","about_self":true,"certainty":"stated"}]}"#
    let o = processReply(reply, post: post, source: .on_device)
    XCTAssertEqual(o.facts.count, 0); XCTAssertEqual(o.rejected, 1); XCTAssertEqual(o.raw.first?.why, "quote not in post")
  }

  func testUnreadable() { XCTAssertTrue(processReply("I can't help with that.", post: post, source: .on_device).unreadable) }

  func testBaseRateGradesAndCitation() {
    let grounded = parseBaseRate(#"{"low":0.01,"high":0.02,"basis":"BLS 2024"}"#, cat: "occupation", value: "welder", sourceURL: "https://bls.gov")!
    XCTAssertEqual(grounded.grade, .B); XCTAssertTrue(isCited(grounded))
    let guess = parseBaseRate(#"{"low":"0.5","high":2,"basis":"guess"}"#, cat: "occupation", value: "welder", sourceURL: nil)!
    XCTAssertEqual(guess.grade, .C); XCTAssertFalse(isCited(guess)); XCTAssertEqual(guess.high, 1)
  }

  func testPromptCarriesOnlyThePost() {
    let p = extractPrompt("hello world from Columbus")
    XCTAssertTrue(p.hasSuffix("Posts:\n[0] hello world from Columbus"))
    XCTAssertEqual(extractPrompt(String(repeating: "a", count: 5000)).components(separatedBy: "[0] ").last?.count, MAX_POST_CHARS)
  }

  func testPlannedLookupsNeverCarryNamesOrPlaces() {
    let facts = [
      Fact(id: "a", postId: "a", date: "2024", cat: "occupation", value: "welder", quote: "I weld", certainty: "stated", source: .on_device),
      Fact(id: "b", postId: "b", date: "2024", cat: "employer_type", value: "Acme Steel", quote: "Acme Steel", certainty: "stated", source: .on_device),
      Fact(id: "c", postId: "c", date: "2024", cat: "home_location", value: "Maple Street", quote: "Maple Street", certainty: "stated", source: .on_device),
    ]
    XCTAssertEqual(plannedLookups(facts, cache: [:]).map(\.attribute), ["occupation: welder"])
  }

  func testScanOrder() {
    let posts = [Post(id: "1", date: "", text: "ok"), Post(id: "2", date: "", text: "https://x.com/abc"), Post(id: "3", date: "", text: "lovely weather today friends"), Post(id: "4", date: "", text: "my twins started kindergarten")]
    let o = scanOrder(posts)
    XCTAssertEqual(o.order.map(\.id), ["4", "3"]); XCTAssertEqual(o.fastPass, 1); XCTAssertEqual(o.empty, 2)
  }
}

final class ExtractLooseTests: XCTestCase {
  func testCategoryCaseAndBareArray() {
    let post = Post(id: "x", date: "2024", text: "I work nights as a nurse in Columbus")
    let o = processReply(#"[{"p":0,"cat":"Occupation","value":"nurse","quote":"I work nights as a nurse","about_self":true,"certainty":"Stated"},{"cat":"occupation","value":"nurse"}]"#, post: post, source: .on_device)
    XCTAssertFalse(o.unreadable); XCTAssertEqual(o.facts.map(\.cat), ["occupation"]); XCTAssertEqual(o.malformed, 1)
  }
}
