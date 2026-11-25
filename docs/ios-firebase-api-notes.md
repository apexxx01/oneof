# Firebase AI Logic iOS 12.19.3: API notes

Verified against the SDK source at tag 12.19.3 while building the iOS app. Kept for reference.

# Firebase AI Logic on-device / hybrid API (firebase-ios-sdk 12.x)

Source: `https://github.com/firebase/firebase-ios-sdk`, tag `CocoaPods-12.19.3`, commit `42cf1417c51c5e3bfbae5d3ab89b778f8fdc4bb8` ("package.swift update for 12.19.3 (#16941)").
Paths below are relative to the repo root (clone at `/tmp/fis`). Line numbers refer to that tag.

## 0. Version selection

`git ls-remote --tags` for `12.N.M` shows only `CocoaPods-` prefixed tags (no bare `12.N.M` tags). Highest stable: `CocoaPods-12.19.3`. Highest beta/nightly are not used.

`Package.swift:21`: `let firebaseVersion = "12.19.3"`

## 1. Package / platforms / products

`Package.swift:27`
```swift
  platforms: [.iOS(.v15), .macCatalyst(.v15), .macOS(.v10_15), .tvOS(.v15), .watchOS(.v7)],
```

`Package.swift:38-44` (AI Logic products)
```swift
    .library(
      name: "FirebaseAI",
      targets: [
        "FirebaseAI",
        "FirebaseAILogic",
      ]
    ),
    .library(
      name: "FirebaseAILogic",
      targets: [
        "FirebaseAILogic",
      ]
    ),
```

`Package.swift:72-73` (App Check product)
```swift
      name: "FirebaseAppCheck",
      targets: ["FirebaseAppCheck"]
```

`Package.swift:1690-1703` (`firebaseAILogicDependencies()`): FirebaseAILogic depends on `FirebaseAppCheck`, `FirebaseAppCheckInterop`, `FirebaseAuthInterop`, `FirebaseCore`, `FirebaseCoreExtension`, and on `GeminiLanguageModel` only when `#if compiler(>=6.4) && canImport(FoundationModels)`.

Minimum deployment: package-wide iOS 15. On-device APIs are gated to iOS 26 / macOS 26 / visionOS 26 and are unavailable on tvOS and watchOS (see section 2).

Compiler gate: almost all new surface is wrapped in `#if compiler(>=6.2.3)` (Xcode 26.2+). Example: `FirebaseAI/Sources/Types/Public/HybridModel.swift:15`, `FirebaseAI/Sources/FirebaseAI.swift:114`.

Import line used by the integration tests: `FirebaseAI/Tests/TestApp/Tests/Integration/GenerativeModelSessionHybridTests.swift:17`: `@testable import FirebaseAILogic`. Module name is `FirebaseAILogic` (the `FirebaseAI` product contains both targets).

## 2. SystemLanguageModel (on-device, Apple Foundation Models wrapper)

File: `FirebaseAI/Sources/Types/Public/SystemLanguageModel.swift`

Gating at file top (line 15-19):
```swift
#if compiler(>=6.2.3)
  import Foundation
  #if canImport(FoundationModels)
    import FoundationModels
  #endif // canImport(FoundationModels)
```

Declaration (line 21-28):
```swift
  public extension FirebaseAI {
    /// An on-device text generation model provided by Apple's Foundation Models framework.
    ...
    final class SystemLanguageModel: Sendable {
```

Availability property (line 52-53):
```swift
      /// The availability status for the on-device model.
      public var availability: SystemLanguageModel.Availability {
```

`isAvailable` (line 81):
```swift
      public var isAvailable: Bool {
```

Availability enum (line 179-181, 216-226):
```swift
  public extension FirebaseAI.SystemLanguageModel {
    /// Availability states for the on-device model.
    @frozen enum Availability: Equatable, Sendable {
...
      case available
...
      case unavailable(FirebaseAI.SystemLanguageModel.Availability.UnavailableReason)
    }
```

UnavailableReason (line 187-188): `@nonexhaustive` / `public enum UnavailableReason: Hashable, Equatable, Sendable {`
Cases (lines 193, 201, 207, 213):
```swift
        case deviceNotEligible
        case appleIntelligenceNotEnabled
        case modelNotReady
        case unknown
```

`default` (line 233-241):
```swift
    static var `default`: FirebaseAI.SystemLanguageModel {
      #if canImport(FoundationModels) && IS_FOUNDATION_MODELS_SUPPORTED_PLATFORM
        if #available(iOS 26.0, macOS 26.0, visionOS 26.0, *) {
          return FirebaseAI
            .SystemLanguageModel(systemLanguageModel: FoundationModels.SystemLanguageModel.default)
        }
      #endif // canImport(FoundationModels) && IS_FOUNDATION_MODELS_SUPPORTED_PLATFORM
      return FirebaseAI.SystemLanguageModel(systemLanguageModel: nil)
    }
```
Note: `default` has no `@available` attribute. On unsupported OS it returns a wrapper whose `availability` is `.unavailable(.deviceNotEligible)` (line 75).

Initializer (line 252-253; no explicit access keyword, inside `public extension FirebaseAI.SystemLanguageModel` opened at line 179, so public by extension default):
```swift
    convenience init(useCase: FirebaseAI.SystemLanguageModel.UseCase = .general,
                     guardrails: FirebaseAI.SystemLanguageModel.Guardrails = .default) {
```

Other members in the same public extension: `supportedLanguages` (line 288, `@available(iOS 16.0, macOS 13.0, tvOS 16.0, watchOS 9.0, *)`), `func supportsLocale(_ locale: Locale = Locale.current) -> Bool` (line 304).

UseCase (line 96-115): `public struct UseCase: Sendable, Equatable` with `public static let general` and `public static let contentTagging`.

Guardrails (line 140-152): `struct Guardrails: Sendable, Equatable` with `public static let default` and `public static let permissiveContentTransformations`.

Convenience factory on LanguageModelProvider: `FirebaseAI/Sources/Protocols/Public/LanguageModelProvider.swift:50-69`:
```swift
  public extension LanguageModelProvider where Self == FirebaseAI.SystemLanguageModel {
    ...
    static func systemModel(useCase: FirebaseAI.SystemLanguageModel.UseCase = .general,
                            guardrails: FirebaseAI.SystemLanguageModel.Guardrails = .default)
      -> FirebaseAI.SystemLanguageModel {
```

### Errors when on-device is unavailable

`FirebaseAI/Sources/Extensions/Public/SystemLanguageModel+LanguageModel.swift:36-45`:
```swift
      switch availability {
      case .available:
        break
      case let .unavailable(reason):
        throw GenerativeModelSession.GenerationError.assetsUnavailable(
```
And lines 89-94 throw the same `assetsUnavailable` when the platform is not supported. So a standalone on-device session throws `GenerativeModelSession.GenerationError.assetsUnavailable(_:)` at session start (`_startSession`), not at `availability` time.

Model name used for the on-device model (line 22): `static let modelName = "apple-foundation-models-system-language-model"`.

## 3. HybridModel

File: `FirebaseAI/Sources/Types/Public/HybridModel.swift`

```swift
#if compiler(>=6.2.3)
  /// A hybrid model combining a primary, or main, model and a secondary, or fallback, model.
  ///
  /// **Public Preview**: This API is a public preview and may be subject to change.
  public struct HybridModel: FirebaseAI.LanguageModel {
```
(line 15-19)

Initializer (line 23-33):
```swift
    /// **[Public Preview]** Creates a ``HybridModel`` for the specified models.
    ///
    /// > Warning: This API is a public preview and may be subject to change.
    ///
    /// - Parameters:
    ///   - primary: The main, or default, model to use.
    ///   - secondary: The backup model to fallback to if the `primary` model is unavailable.
    public init(primary: any FirebaseAI.LanguageModel, secondary: any FirebaseAI.LanguageModel) {
```

Provider form: `FirebaseAI/Sources/Types/Public/HybridModelProvider.swift:17` (`public struct HybridModelProvider: LanguageModelProvider`) and `LanguageModelProvider.swift:72-84`:
```swift
  public extension LanguageModelProvider where Self == HybridModelProvider {
    static func hybridModel(primary: any LanguageModelProvider,
                            secondary: any LanguageModelProvider) -> HybridModelProvider {
```
So `model: .hybridModel(primary: ..., secondary: ...)` works with `generativeModelSession(model:)`.

Note: `HybridModel` has no `@available` attribute; only the on-device leg needs iOS 26. Any `SystemLanguageModel` used as primary/secondary will go through `_startSession` above.

### Fallback logic (what triggers the secondary)

`FirebaseAI/Sources/Types/Internal/HybridModelSession.swift`:
- Line 63: `return try await TaskLocals.$isHybridRequest.withValue(true) {`
- Lines 64-65: `// If the secondary session contains history then a previous fallback occurred.` / `// Stick with the secondary session to maintain conversation consistency.`
- Lines 88-89: `// Fallback to the second session if the first fails or is unavailable.` then `AILog.notice(code: .hybridPrimarySessionInitializationFailed, """`
- Lines 115-121: `// Do not fallback to second session if the primary session contains history.` / `let primaryHasHistory = ...` / `if primaryHasHistory { throw error }`
- Lines 199-200 (streaming): `// Do not fallback to second session if the primary session contains history or has` / `// already yielded data.`

So fallback happens on primary session init failure, or on a primary request error when the primary has no history yet. It does not fall back after a stream has already yielded data, and never after a cancellation.

## 4. GenerativeModelSession, respond / streamResponse, response types

File: `FirebaseAI/Sources/GenerativeModelSession.swift`

Class (line 54): `public final class GenerativeModelSession: Sendable {`

Its initializer (line 76-77) is `init(model: any FirebaseAI.LanguageModel, tools: [any ToolRepresentable]? = nil, instructions: String? = nil)` with NO `public` modifier. Create sessions only via `FirebaseAI.generativeModelSession(model:tools:instructions:)`. There is no public initializer on the class.

### Factory

`FirebaseAI/Sources/FirebaseAI.swift:152-154` (inside `#if compiler(>=6.2.3)`, line 114):
```swift
    public func generativeModelSession(model: any LanguageModelProvider,
                                       tools: [any ToolRepresentable]? = nil,
                                       instructions: String? = nil) -> GenerativeModelSession {
```
Parameters: `model` (any `LanguageModelProvider`: a `String` model name, `geminiModel(...)`, `systemModel(...)`, `hybridModel(...)`), `tools` (`[any ToolRepresentable]`, e.g. `.googleSearch()`, or types conforming to `ToolRepresentable`), `instructions` (system instructions). There is NO generation-config parameter on the session factory. Generation options are passed per call (below).

FoundationModels overload (`FirebaseAI.swift:164-187`): gated `#if canImport(FoundationModels)`, `@available(iOS 26.0, macOS 26.0, visionOS 26.0, *)`, `@available(tvOS, unavailable)`, `@available(watchOS, unavailable)`, takes `tools: [any FoundationModels.Tool]` (non-optional) and `instructions: String? = nil`.

### respond (String)

`GenerativeModelSession.swift:91-96` (no `@available`, so iOS 15 base):
```swift
    @discardableResult
    public nonisolated(nonsending)
    func respond(to prompt: PartsRepresentable...,
                 options: any GenerationOptionsRepresentable
                   = ResponseGenerationOptions.default) async throws
      -> GenerativeModelSession.Response<String> {
```
Prompt is variadic `PartsRepresentable...`; `String` conforms (`FirebaseAI/Sources/PartsRepresentable.swift:42`).

### respond (Generable, structured output on iOS 26)

`GenerativeModelSession.swift:156-166`:
```swift
      @available(iOS 26.0, macOS 26.0, visionOS 26.0, *)
      @available(tvOS, unavailable)
      @available(watchOS, unavailable)
      @discardableResult
      public nonisolated(nonsending)
      func respond<Content>(to prompt: PartsRepresentable...,
                            generating type: Content.Type = Content.self,
                            includeSchemaInPrompt: Bool = true,
                            options: any GenerationOptionsRepresentable
                              = ResponseGenerationOptions.default) async throws
        -> GenerativeModelSession.Response<Content> where Content: Generable {
```
Also a public-API-free `respond(to:schema: FoundationModels.GenerationSchema, ...)` at lines 120-130 is `nonisolated(nonsending) func` with no `public` (internal, comment at 131: "TODO: Replace `FoundationModels.GenerationSchema` and make this method public when `FirebaseAI.GenerationSchema`'s public API is ready.").

Generable requires the `FoundationModels` `@Generable` macro (doc example lines 33-52 use `@Generable` / `@Guide`). There is no public JSON-schema entry point (see section 6).

### streamResponse

String (`GenerativeModelSession.swift:246-250`):
```swift
    @available(macOS 12.0, watchOS 8.0, *)
    public func streamResponse(to prompt: PartsRepresentable...,
                               options: any GenerationOptionsRepresentable
                                 = ResponseGenerationOptions.default)
      -> sending GenerativeModelSession.ResponseStream<String, String> {
```

Generable (`GenerativeModelSession.swift:218-228`):
```swift
      @available(iOS 26.0, macOS 26.0, visionOS 26.0, *)
      @available(tvOS, unavailable)
      @available(watchOS, unavailable)
      public func streamResponse<Content>(to prompt: PartsRepresentable...,
                                          generating type: Content.Type = Content.self,
                                          includeSchemaInPrompt: Bool = true,
                                          options: any GenerationOptionsRepresentable =
                                            ResponseGenerationOptions.default)
        -> sending GenerativeModelSession.ResponseStream<
          Content, Content.PartiallyGenerated
        > where Content: Generable {
```

The `streamResponse(to:schema:...)` overload taking `FoundationModels.GenerationSchema` (lines 186-196) is NOT public (no `public` keyword).

### Response types

`GenerativeModelSession.swift:457-466`:
```swift
  public extension GenerativeModelSession {
    /// The response from a `respond` call.
    struct Response<Content> {
      /// The generated content, decoded into the requested `Generable` type.
      public let content: Content
      /// The raw, undecoded `GeneratedContent` from the model.
      public let rawContent: FirebaseAI.GeneratedContent
      /// The raw `GenerateContentResponse` from the model.
      public let rawResponse: GenerateContentResponse
    }
  }
```

Streaming snapshot (`GenerativeModelSession.swift:471-482`): `ResponseStream<Content, PartialContent>: AsyncSequence`, `Element = Snapshot`, with `Snapshot` having `public let content: PartialContent`, `public let rawContent: FirebaseAI.GeneratedContent`, `public let rawResponse: GenerateContentResponse`. `collect()` (line 580-581) returns `Response<Content>`.

### Which model answered (no `isOnDevice` / source field)

Grep for `isOnDevice`, `inferenceSource`, or any source/location field across `FirebaseAI/Sources/Types/Public` returned nothing. The only public signal is `rawResponse` (`GenerateContentResponse`). The integration test uses `rawResponse.modelVersion` to see which model served the request:

`FirebaseAI/Tests/TestApp/Tests/Integration/GenerativeModelSessionHybridTests.swift:83-87`:
```swift
      if await foundationModelsIsAvailable() {
        #expect(response.rawResponse.modelVersion == systemModel._modelName)
      } else {
        #expect(response.rawResponse.modelVersion == geminiModel._modelName)
      }
```
Compare against `FirebaseAI.SystemLanguageModel` `_modelName` (`"apple-foundation-models-system-language-model"`, `SystemLanguageModel+LanguageModel.swift:22`). This is an internal-looking `_modelName`, so it is test-only evidence, not a documented contract.

### Errors

`GenerativeModelSession.swift:712-734`:
```swift
    public enum GenerationError: Error, LocalizedError {
      public struct Context: Sendable {
        public let debugDescription: String
        ...
      }
      case assetsUnavailable(GenerativeModelSession.GenerationError.Context)
      case decodingFailure(GenerativeModelSession.GenerationError.Context)
      case concurrentRequests(GenerativeModelSession.GenerationError.Context)
      case unsupportedPromptContent(GenerativeModelSession.GenerationError.Context)
      case internalError(GenerativeModelSession.GenerationError.Context, underlyingError: any Error)
    }
```
Note: `case` declarations here have no explicit `public`, but they are in a `public enum`, so they are public. `FunctionCallingError` (line 736) is internal.

Concurrency: `GenerativeModelSession.swift:419-428` throws `concurrentRequests` if a second `respond`/stream starts while one is in progress.

## 5. Generation options, structured output, GenerationConfig

### GenerationConfig (Gemini)

`FirebaseAI/Sources/GenerationConfig.swift:19`: `public struct GenerationConfig: Sendable, Equatable {`

Public init (lines 177-183):
```swift
  public init(temperature: Float? = nil, topP: Float? = nil, topK: Int? = nil,
              candidateCount: Int? = nil, maxOutputTokens: Int? = nil,
              presencePenalty: Float? = nil, frequencyPenalty: Float? = nil,
              stopSequences: [String]? = nil, responseMIMEType: String? = nil,
              responseSchema: Schema? = nil, responseModalities: [ResponseModality]? = nil,
              thinkingConfig: ThinkingConfig? = nil, imageConfig: ImageConfig? = nil,
              speechConfig: SpeechConfig? = nil) {
```
Important: the public `responseSchema` parameter is the `Schema` type (`FirebaseAI/Sources/Types/Public/Schema.swift`), a hand-built schema (`.object(properties:...)`, `.string(...)`, etc., Schema.swift:176-450). There is NO public `responseJSONSchema` init: the JSON-schema init at `GenerationConfig.swift:203-207` has no `public` modifier (`init(temperature: Float? = nil, ..., responseMIMEType: String, responseJSONSchema: JSONObject, ...)`). Also `var responseMIMEType: String?` (line 45), `var responseSchema: Schema?` (line 48), `var responseJSONSchema: JSONObject?` (line 53) are internal `var`s.

Doc note from `GenerationConfig.swift:147-150`: `text/x.enum` for classification; `responseSchema` requires `responseMIMEType` ("If set, a compatible `responseMIMEType` must also be set."). In the public init, `responseMIMEType` is optional, so set `responseMIMEType: "application/json"` yourself with `responseSchema`.

### How a GenerationConfig reaches the session

`GenerationOptionsRepresentable.swift:29-38`:
```swift
  public protocol GenerationOptionsRepresentable: Sendable {
    var responseGenerationOptions: ResponseGenerationOptions { get }
  }

  extension GenerationConfig: GenerationOptionsRepresentable {
    public var responseGenerationOptions: ResponseGenerationOptions {
```
The `respond` / `streamResponse` `options:` param takes `any GenerationOptionsRepresentable`, default `ResponseGenerationOptions.default`. Per-request, not per-session.

`GenerationOptionsRepresentable.swift:59-77` (static factories on `ResponseGenerationOptions`):
```swift
    static var `default`: ResponseGenerationOptions { return ResponseGenerationOptions() }
    static func gemini(_ generationConfig: GenerationConfig) -> ResponseGenerationOptions {
    static func foundationModels(_ generationOptions: FirebaseAI.GenerationOptions)
```
Hybrid (`GenerationOptionsRepresentable.swift:117-119`, available without FoundationModels):
```swift
    static func hybrid(gemini: GenerationConfig,
                       foundationModels: FirebaseAI.GenerationOptions)
      -> ResponseGenerationOptions {
```
And with `FoundationModels.GenerationOptions` at lines 101-103 (`@available(iOS 26.0, ...)`).

Usage example: `session.respond(to: prompt, options: .gemini(GenerationConfig(temperature: 0.2)))`. Hybrid: `options: .hybrid(gemini: GenerationConfig(...), foundationModels: FirebaseAI.GenerationOptions(temperature: 0.2))`. (Both constructor signatures are as quoted in sections above; `GenerationConfig` init is at 177-183.)

### On-device options: `FirebaseAI.GenerationOptions`

`FirebaseAI/Sources/Types/Public/GenerationOptions.swift:26`: `struct GenerationOptions: Sendable, Equatable` (inside `#if compiler(>=6.2.3)`, line 15). Public members:
- line 131: `public var sampling: GenerationOptions.SamplingMode?`
- line 134: `public var temperature: Double?`
- line 137: `public var maximumResponseTokens: Int?`
- line 143: `public init(sampling: GenerationOptions.SamplingMode? = nil, temperature: Double? = nil,` (continues with `maximumResponseTokens`).

Sampling modes (lines 30-59): `SamplingMode.greedy`, `random(top:seed:)` (line 52), `random(probabilityThreshold:...)` (line 59).

### Structured output on the session

There is no session-level JSON-schema or response-MIME setting. Structured output works only through `respond(to:generating:)` / `streamResponse(to:generating:)` with a `Generable` type (iOS 26 only, see section 4), or internally via a `FirebaseAI.GenerationSchema` (not public).

## 6. GeminiModel / generativeModel (Gemini cloud models)

Factories on `FirebaseAI`:

- `FirebaseAI.swift:51-53`:
```swift
  public static func firebaseAI(app: FirebaseApp? = nil,
                                backend: Backend = .googleAI(),
                                useLimitedUseAppCheckTokens: Bool = false) -> FirebaseAI {
```
- `FirebaseAI.swift:83-89`:
```swift
  public func generativeModel(modelName: String,
                              generationConfig: GenerationConfig? = nil,
                              safetySettings: [SafetySetting]? = nil,
                              tools: [Tool]? = nil,
                              toolConfig: ToolConfig? = nil,
                              systemInstruction: ModelContent? = nil,
                              requestOptions: RequestOptions = RequestOptions())
    -> GenerativeModel {
```
- `FirebaseAI.swift:127-129` (inside `#if compiler(>=6.2.3)`):
```swift
    public func geminiModel(name: String, safetySettings: [SafetySetting]? = nil,
                            requestOptions: RequestOptions = RequestOptions())
      -> GeminiModel {
```
- Provider form `LanguageModelProvider.swift:27-47`: `public extension LanguageModelProvider where Self == GeminiModelProvider { static func geminiModel(name: String, safetySettings: [SafetySetting]? = nil, requestOptions: RequestOptions = RequestOptions()) -> GeminiModelProvider`.
- `LanguageModelProvider.swift:89-93`: `extension String: LanguageModelProvider` returns `firebaseAI.geminiModel(name: self)`, so a plain string works as `model:`.

Note: `generativeModel(...)` takes `generationConfig:` and `systemInstruction:` (line 84, 88). `geminiModel(name:)` takes neither: system instructions go through `generativeModelSession(..., instructions:)`, generation config goes per call via `options:`.

Backends (`FirebaseAI/Sources/Types/Public/Backend.swift`):
- line 27: `public static func vertexAI() -> Backend` (`@available(*, deprecated, message: ...)` at 24-26)
- line 62: `public static func agentPlatform(location: String = "global") -> Backend`
- line 72: `public static func googleAI() -> Backend`

`firebaseAI(backend:)` defaults to `.googleAI()` (FirebaseAI.swift:52).

## 7. App Check debug provider

Factory: `FirebaseAppCheck/Sources/Public/FirebaseAppCheck/FIRAppCheckDebugProviderFactory.h:24-26`
```objc
NS_SWIFT_NAME(AppCheckDebugProviderFactory)
@interface FIRAppCheckDebugProviderFactory : NSObject <FIRAppCheckProviderFactory>
```
Implementation: `FirebaseAppCheck/Sources/DebugProvider/FIRAppCheckDebugProviderFactory.m:24`.

Provider: `FirebaseAppCheck/Sources/Public/FirebaseAppCheck/FIRAppCheckDebugProvider.h:63-64`:
```objc
NS_SWIFT_NAME(AppCheckDebugProvider)
@interface FIRAppCheckDebugProvider : NSObject <FIRAppCheckProvider>
```

Usage doc (`FIRAppCheckDebugProvider.h:36-38`):
```
/// To use `AppCheckDebugProvider` on a local simulator:
/// 1. Configure `AppCheckDebugProviderFactory` before `FirebaseApp.configure()`:
///    ```AppCheck.setAppCheckProviderFactory(AppCheckDebugProviderFactory())```
```

Swift usage (from App Check test code, FirebaseAppCheck/Tests/Integration/AppCheckE2ETests.swift and test app): `AppCheck.setAppCheckProviderFactory(TestAppCheckProviderFactory())` is what the AI test app calls (`FirebaseAI/Tests/TestApp/Sources/TestApp.swift:22`) before `FirebaseApp.configure()` (line 25). For debug, substitute `AppCheckDebugProviderFactory()`, as the header documents at line 38.

Debug token priority (`FIRAppCheckDebugProvider.h:73-78`):
```
/** Returns the currently used App Check debug token. The priority:
 *  - `AppCheckDebugToken` env variable value
 *  - `FIRAAppCheckDebugToken` env variable value (deprecated)
 *  - A previously generated token, stored locally on the device
 *  - A newly generated random token. ...
```
Env var names: `AppCheckDebugToken` (preferred), `FIRAAppCheckDebugToken` (deprecated).

Env var read: this repo does NOT contain the code that reads the environment. The Objective-C provider delegates to `GACAppCheckDebugProvider` (`FirebaseAppCheck/Sources/DebugProvider/FIRAppCheckDebugProvider.m:66-67`):
```objc
  GACAppCheckDebugProvider *debugProvider =
      [[GACAppCheckDebugProvider alloc] initWithServiceName:app.name
```
That class is in the external GoogleAppCheck dependency. The only in-repo line that reads the env var by name is in the GeminiLanguageModel test helper (`GeminiLanguageModel/Tests/GeminiTestUtilities/IntegrationTestEnvironment.swift:107-110`):
```swift
    if let token = variables["AppCheckDebugToken"], !token.isEmpty {
      return token
    }
    if let legacyToken = variables["FIRAAppCheckDebugToken"], !legacyToken.isEmpty {
```
(This is test code. Treat it as the name-resolution order, not the SDK implementation.)

Xcode scheme setup: add an env var `AppCheckDebugToken` = `$(APP_CHECK_DEBUG_TOKEN)` (doc, `FIRAppCheckDebugProvider.h:57-58`), and pass the token from CI as an `xcodebuild` build setting (`FIRAppCheckDebugProvider.h:59-61`). The debug token must be registered in the Firebase console (`FIRAppCheckDebugProvider.h:45`).

Never ship the debug provider in real-user builds (`FIRAppCheckDebugProvider.h:30`: "NOTE: Do not use the debug provider in applications used by real users.").

## 8. Shortest end-to-end example from the repo

`FirebaseAI/Tests/TestApp/Tests/Integration/GenerativeModelSessionHybridTests.swift:63-72` (on-device primary, Gemini fallback; needs iOS 26 at runtime, and the test is annotated `@available(iOS 26.0, macOS 26.0, visionOS 26.0, *)`, `@available(tvOS, unavailable)`, `@available(watchOS, unavailable)` at lines 60-62):
```swift
      let firebaseAI = FirebaseAI.componentInstance(config)
      let systemModel = FirebaseAI.SystemLanguageModel.default
      let geminiModel = firebaseAI.geminiModel(name: ModelNames.gemini2_5_FlashLite)
      let session = firebaseAI.generativeModelSession(
        model: HybridModel(primary: systemModel, secondary: geminiModel)
      )
      let prompt = "In one sentence, why is the sky blue?"

      let response = try await session.respond(to: prompt)
```
`FirebaseAI.componentInstance(config)` is a test helper, so for an app use `FirebaseAI.firebaseAI()` (FirebaseAI.swift:51). The tests pass `HybridModel(primary:secondary:)` directly, not the `.hybridModel(...)` provider form.

Minimal app version (derived from the lines above, not a file in the repo):
```swift
import FirebaseCore
import FirebaseAILogic

let ai = FirebaseAI.firebaseAI()
let session = ai.generativeModelSession(
  model: HybridModel(
    primary: FirebaseAI.SystemLanguageModel.default,
    secondary: ai.geminiModel(name: "gemini-2.5-flash-lite")
  ),
  instructions: "Be concise."
)
let response = try await session.respond(to: "Why is the sky blue?")
print(response.content)
print(response.rawResponse.modelVersion)
```
Caveat: `FirebaseAI.firebaseAI()` and `geminiModel(name:)` are from the public API above. The `"gemini-2.5-flash-lite"` model name is from the test helper `ModelNames.gemini2_5_FlashLite` and was not verified against a model-names file in this repo.

More tests: `FirebaseAI/Tests/Unit/HybridModelTests.swift` (mock `_ModelSession`s, `testStartSession_primaryFails_secondarySucceeds` at line 102, `testStreamResponse_primaryFails_secondarySucceeds` at line 294).

## 9. Summary table

| Item | Public? | Where | Gate |
|---|---|---|---|
| `FirebaseAI.SystemLanguageModel` | yes | SystemLanguageModel.swift:28 | `compiler(>=6.2.3)` |
| `.default` | yes (static var) | SystemLanguageModel.swift:233 | none (returns unavailable wrapper on older OS) |
| `.availability`, `.isAvailable` | yes | :53, :81 | iOS 26 path inside, else `.unavailable(.deviceNotEligible)` |
| `UnavailableReason` | yes | :188 | `@nonexhaustive` |
| `HybridModel(primary:secondary:)` | yes | HybridModel.swift:30 | `compiler(>=6.2.3)`, PUBLIC PREVIEW |
| `generativeModelSession(model:tools:instructions:)` | yes | FirebaseAI.swift:152 | `compiler(>=6.2.3)` |
| `GenerativeModelSession` init | NO (internal) | GenerativeModelSession.swift:76 | |
| `respond(to:options:)` -> `Response<String>` | yes | GenerativeModelSession.swift:91-96 | none |
| `respond(to:generating:...)` | yes | GenerativeModelSession.swift:156-166 | iOS 26, not tvOS/watchOS |
| `streamResponse(to:options:)` | yes | GenerativeModelSession.swift:247 | macOS 12 / watchOS 8 |
| `streamResponse(to:generating:...)` | yes | GenerativeModelSession.swift:221 | iOS 26 |
| `Response.content/rawContent/rawResponse` | yes | GenerativeModelSession.swift:459-466 | |
| on-device/cloud source field | NO | | use `rawResponse.modelVersion` (test-only evidence) |
| `GenerationConfig(...)` (responseSchema: Schema) | yes | GenerationConfig.swift:177 | |
| `responseJSONSchema` init | NO (internal) | GenerationConfig.swift:203 | |
| `FirebaseAI.GenerationOptions(temperature: Double)` | yes | GenerationOptions.swift:143 | iOS 26 type |
| `ResponseGenerationOptions.hybrid(gemini:foundationModels:)` | yes | GenerationOptionsRepresentable.swift:117 | |
| `FirebaseAI.firebaseAI(backend:)` | yes | FirebaseAI.swift:51 | |
| `Backend.googleAI()` / `agentPlatform(location:)` | yes | Backend.swift:72, :62 | |
| `AppCheckDebugProviderFactory` | yes (ObjC, Swift name) | FIRAppCheckDebugProviderFactory.h:24-26 | |
| env vars `AppCheckDebugToken`, `FIRAAppCheckDebugToken` | documented in header | FIRAppCheckDebugProvider.h:73-75 | read in external GoogleAppCheck |
| SPM products `FirebaseAI`, `FirebaseAILogic`, `FirebaseAppCheck` | yes | Package.swift:38-44, 72 | |
| Platforms | iOS 15, macCatalyst 15, macOS 10.15, tvOS 15, watchOS 7 | Package.swift:27 | |
| On-device | iOS 26, macOS 26, visionOS 26; not tvOS/watchOS | many | |
| Unavailable error | `GenerativeModelSession.GenerationError.assetsUnavailable(Context)` | SystemLanguageModel+LanguageModel.swift:40, :89 | |

## 10. Not verified

- Whether `rawResponse.modelVersion` is always set for on-device responses (only asserted in an integration test, not checked in the implementation).
- Whether `respond(to:options:)` String overload with an unavailable `HybridModel` needs `@available` at the call site: `respond(to:options:)` has no `@available`, but the on-device leg does, so a `HybridModel` with `SystemLanguageModel` compiles on iOS 15 but fails over to the secondary model at run time.
- Only 12.19.3 was read. 13.0.0 removal was not re-checked.
