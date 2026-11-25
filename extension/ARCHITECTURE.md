# OneOf extension: architecture and what was verified

## Where the model runs

**Decision: the side panel page is the engine.** It hosts Firebase AI Logic (`getGenerativeModel` with `InferenceMode.ONLY_ON_DEVICE`) and is also the main UI. The content script only reads the composer and draws the pill. The service worker only relays messages and opens the panel.

```
Reddit tab                         extension service worker             side panel (extension page)
content.js (isolated world)        sw.js                                React UI + engine
  focusin/input, composedPath()      relay.ts                              DraftEngine (engine.ts)
  debounce 1200 ms  ── draft ──▶     runtime.onMessage ── Port ──▶          extractFromPost(...,'own','draft')
  pill (closed shadow root) ◀──      tabs.sendMessage  ◀── verdict ──        blurDraft(...,'own')
  click ── open-panel ──▶            sidePanel.open({tabId})                scan(posts,'own',...)  (≤ 50 posts)
                                                                            buildDossier + estimate (pure)
                                                                            chrome.storage.local: history facts
```

### What the Chrome docs say (checked 2026-11-25)

| Question | Finding | Source |
|---|---|---|
| Is the Prompt API (`LanguageModel`) available to extensions? | Yes. The availability table lists **Chrome 138** for Extensions (Chrome 148 for the web). | [developer.chrome.com/docs/ai/prompt-api](https://developer.chrome.com/docs/ai/prompt-api), [developer.chrome.com/docs/extensions/ai/prompt-api](https://developer.chrome.com/docs/extensions/ai/prompt-api) |
| Which extension context does Google's own sample use? | The side panel. The Prompt API page links its extension demo, `ai.gemini-on-device`, whose manifest is `side_panel.default_path` + `"permissions": ["sidePanel"]` + `"minimum_chrome_version": "138"`, and whose worker only calls `setPanelBehavior({ openPanelOnActionClick: true })`. | [prompt-api (Demo section)](https://developer.chrome.com/docs/ai/prompt-api), [sample source](https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/ai.gemini-on-device) |
| Content scripts? | **Not documented** either way. Content scripts run in an isolated world of the *page* ([content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)); the Prompt API is gated by the page's Permissions Policy and is "only available to top-level windows and to their same-origin iframes" ([prompt-api, Permission Policy section](https://developer.chrome.com/docs/ai/prompt-api)). | see links |
| Workers? | "The Prompt API isn't available in Web Workers for now." An older Chromium page on the extension origin trial said the API can be detected "from extension window and worker scripts". | [prompt-api](https://developer.chrome.com/docs/ai/prompt-api), [chromium docs/experiments/prompt-api-for-extension.md](https://chromium.googlesource.com/chromium/src/+/main/docs/experiments/prompt-api-for-extension.md) (origin-trial era) |
| Offscreen document? | Not mentioned for the Prompt API. `chrome.offscreen.createDocument()` requires a `reasons` value from a fixed enum (TESTING, AUDIO_PLAYBACK, IFRAME_SCRIPTING, DOM_SCRAPING, BLOBS, DOM_PARSER, USER_MEDIA, DISPLAY_MEDIA, WEB_RTC, CLIPBOARD, LOCAL_STORAGE, WORKERS, BATTERY_STATUS, MATCH_MEDIA, GEOLOCATION). None of them describes running a language model, so there's no honest reason to give. | [offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen) |
| Downloading the model | "To trigger the download and instantiate the language model, check for user activation." Built-in AI APIs "can be used when building Chrome Extensions". | [get-started](https://developer.chrome.com/docs/ai/get-started) |
| Opening the panel from the pill | `sidePanel.open()` "may only be called in response to a user action", and a "user gesture on an extension page or content script" counts. Google's `cookbook.sidepanel-open` sample has the content script message the worker, which calls `sidePanel.open({ tabId: sender.tab.id })`. | [sidePanel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), [sample](https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/cookbook.sidepanel-open) |
| Keeping the worker reachable | A worker stops after 30 s of inactivity; "Receiving an event or calling an extension API resets this timer"; "Sending a message with long-lived messaging keeps the service worker alive. Opening a port no longer resets the timers." | [service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) |
| CSP | The `extension_pages` policy "applies to page and worker contexts in the extension", may be made stricter but not looser than `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`. | [manifest CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy) |

### What was observed in a real browser

Google Chrome for Testing 153.0.8010.12, headless, Linux, extension loaded from `extension/dist`. That machine has no Gemini Nano, so `availability()` reports `unavailable`:

| Context | `typeof LanguageModel` | `availability()` |
|---|---|---|
| side panel page (`chrome-extension://…/sidepanel.html`) | `function` | `unavailable` |
| content script isolated world on a reddit.com page | `function` | `unavailable` |
| the page's own main world | `function` | (not called) |
| extension service worker | `function` | (not called) |

So the global exists in all of them on Chrome 153, but only the extension-page path is documented and used by Google's sample. Inference itself could not be exercised on that machine. The whole pipeline (content script → worker → panel → real Firebase AI Logic SDK → `LanguageModel.create().prompt()` → verdict in the pill → Blur rewrite put back into the composer) was exercised with a stand-in `LanguageModel` injected into the panel page: 0 network requests from the panel, 0 requests outside the extension and the fixture pages.

### Why the side panel, not the content script or the worker

- **Documented and sampled.** Google's Prompt API extension demo is a side panel.
- **The dossier never enters Reddit's renderer.** The history facts and the draft's detected details live in the extension's own process. The content script only ever sees the composer text the user is typing (which the page already has) and the pill's one-line verdict, which it draws in a *closed* shadow root.
- **Not the page's permissions or origin.** A content-script call would be made from reddit.com's document and be subject to its Permissions Policy.
- **Not the worker.** Workers aren't a documented Prompt API context, the worker can be stopped after 30 s idle (killing a session mid-prompt), and a model download needs user activation, which a worker never has.
- **Not offscreen.** No legitimate `reasons` value exists for it.

Cost: the pill needs the panel open. With the panel closed the pill says **"Open OneOf to check"**; clicking it sends `open-panel` to the worker, which calls `chrome.sidePanel.open({ tabId })` synchronously inside that click's gesture. When the panel connects, the worker tells every tab with a composer, and each re-sends its draft. While the panel is open it pings the worker every 25 s over the port so verdicts stay fast.

## Firebase AI Logic and App Check

- **Same project, same public config** (`src/lib/firebase.ts`, reused unchanged).
- **Every model call goes through `getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE, ... })`** inside `src/lib/ai.ts` (reused unchanged). The extension calls only `extractFromPost(post, 'own', 'draft' | 'extract')`, `blurDraft(text, 'own')` and `scan(posts, 'own', …)`; `route(task, 'own')` returns `ONLY_ON_DEVICE` for all three. `src/panel/guard.ts` re-asks the router before each call and refuses anything else. `LanguageModel.availability()` is called directly only for the status pill (`onDeviceAvailability()`).
- **An on-device call never asks for an App Check token.** Read in `node_modules/@firebase/ai/dist/esm/index.esm.js` (v3.1.0): `callCloudOrDevice()` sends `ONLY_ON_DEVICE` to `chromeAdapter.generateContent()` (→ `LanguageModel.create()` + `session.prompt()`) or throws; the App Check token is read only in `getHeaders()`, which only `makeRequest()` (the HTTP path to the cloud) calls.
- **One sharp edge in the SDK:** if `LanguageModel` doesn't exist when `getGenerativeModel()` runs, no Chrome adapter is created and `callCloudOrDevice()` goes to the cloud *whatever the mode*. The web core already guards this: `extractFromPost()` and `blurDraft()` check `onDeviceAvailability() === 'available'` first and throw `BlockedError` otherwise, before any model is built. `test/engine.test.ts` asserts that with no `LanguageModel` no model is even constructed.
- **App Check is compiled out of the extension.** The build sets `VITE_APPCHECK=off`, so `getFirebase()` skips `initializeAppCheck()`, and `vite.config.ts` resolves `firebase/app-check` (only when imported from `src/lib/firebase.ts`) to `src/panel/app-check-off.ts`, a stub that throws. Reason: the reCAPTCHA providers load a script from google.com, which MV3 forbids and the panel's CSP blocks, and there are no cloud calls to protect. If a cloud call is added later: remove the alias, add the Firebase hosts to `connect-src`, and initialise App Check lazily right before that call with a debug or custom provider.

## Build

`extension/scripts/build.ts` runs Vite twice with `extension/vite.config.ts`:

1. **app**: `sidepanel.html` (React) and `src/background/sw.ts` as ES modules (`"background": { "type": "module" }`), plus `manifest.json`, generated icons, and `demo/p1-demo.json`.
2. **content**: `src/content/index.ts` as one classic IIFE (`content.js`); MV3 content scripts can't be modules.

`build-id.txt` is written after both passes. In `--dev` builds the worker fetches it from its own package every 3 s and calls `chrome.runtime.reload()` when it changes (each poll also calls `chrome.runtime.getPlatformInfo()` to reset the idle timer). Verified: after a rebuild the old worker closed 0.7 s after the build finished and the panel then served the new build. Chrome only re-enables a reloaded unpacked extension when Developer mode is on, which "Load unpacked" requires anyway.

`zod` is put in jitless mode before any schema is built (`src/panel/zod-csp.ts`), because its JIT probe uses `new Function`, which extension pages forbid.

## Files

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest: `sidePanel`, `storage`, three Reddit host patterns, strict CSP (`connect-src 'self'`) |
| `sidepanel.html`, `src/panel/main.tsx`, `src/panel/App.tsx`, `src/panel/panel.css` | Side panel UI (reuses `src/ui/bits.tsx` and `src/index.css`) |
| `src/panel/engine.ts` | Draft engine: sentence cache, one model call at a time, supersede on new text, verdict text |
| `src/panel/guard.ts` | Refuses any extension model call the router wouldn't run `ONLY_ON_DEVICE` |
| `src/panel/demo.ts` | Synthetic demo history, re-checked with `recheck()` from `src/lib/replay.ts` |
| `src/panel/port.ts`, `src/panel/netwatch.ts`, `src/panel/zod-csp.ts`, `src/panel/app-check-off.ts` | Worker link, network counter, CSP helpers |
| `src/background/sw.ts`, `src/background/relay.ts` | Worker: relay + open panel; dev auto-reload |
| `src/content/index.ts`, `controller.ts`, `composer.ts`, `pill.ts` | Content script |
| `src/shared/messages.ts`, `src/shared/history.ts` | Message types; history storage |
| `scripts/build.ts`, `scripts/demo-file.ts`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json` | Build and test config |
| `test/*.test.ts` | Unit tests (see README) |
