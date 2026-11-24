> Historical: the Nov 20–22 spike plan, kept for the record. Some details changed later (App Check provider, persona size: the final persona has 8 planted facts).

# Day-1 spikes (run these before any product code)

## Setup (once)
1. Use Chrome 148 or later on the Mac or the Legion. Open `chrome://on-device-internals` and check that the model shows as available. You need 22 GB free on the drive that holds your Chrome profile.
2. Firebase console:
   - **Create a project.** Spark (free) plan is fine.
   - **AI Logic:** go to Build → AI Logic → Get started → Gemini Developer API.
   - **Register a web app.** Copy its config values into `.env.local` (start from `.env.example`).
   - **App Check:** register the web app with **reCAPTCHA Enterprise**. Put the site key in `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`, and add `localhost` as a debug environment, **not** as a reCAPTCHA domain.
3. Run:
   ```bash
   npm install
   npm run personas   # regenerates public/personas/p1.json (already included)
   npm test           # unit tests
   npm run dev        # http://localhost:5173
   ```
4. The first time the page loads, the DevTools console prints **"App Check debug token: …"**. Register it at Firebase console → App Check → Apps → ⋮ → Manage debug tokens. Never commit it.

## S1: on-device extraction (the go/no-go gate)
Click the buttons in order:
1. **Load persona**
2. **Check availability**
3. **Prepare on-device model.** This is a click, because the download needs a user gesture.
4. **Run full suite.** It runs the batch sizes 1/5/10 on-device, then 5 with two runs in parallel, then a cloud baseline.
5. **Test grounding.** It checks whether Google Search grounding works on the free tier, with and without a JSON schema.
6. **Download results.** Save the JSON into `receipts/`.

Gate **G1**:
- ✅ GO: recall ≥ 70% and precision ≥ 80%, ≤ 6 s per call, and ≥ 95% of responses are valid JSON.
- 🟡 RESCOPE: recall between 50% and 70%.
- ❌ PIVOT: recall below 50%.

The persona is **synthetic**: 200 posts, 25 planted facts, and 8 traps (jokes, other people, hypotheticals).

## S3: Apple Foundation Models on the M5 simulator (in parallel)
You need:
- macOS 26 with Apple Intelligence turned on, and the language set to English (US).
- Xcode with an iOS **26.2+** simulator.

New SwiftUI app, then paste this:
```swift
import FoundationModels
@Generable struct Fact { var category: String; var value: String; var quote: String }
@Generable struct FactList { var facts: [Fact] }
let s = LanguageModelSession(instructions: "List facts about the author that could identify them. Quote exactly.")
let r = try await s.respond(to: "my blue Activa survived another monsoon here in Shivamogga", generating: FactList.self)
print(r.content)
```
Tell me whether it prints facts, and how many seconds it takes.
