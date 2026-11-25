# OneOf for Chrome: check before you post

While you write a comment or post on Reddit, a small pill next to the box shows how identifiable the draft makes you:

> **OneOf** · one of ~50 → ~1 if you post this

Click it and the OneOf side panel opens with:

- the details found in this draft, as chips (counted ones in orange; found but uncounted ones dimmed);
- your crowd **before** and **if you post it**, using your history dossier (P10–P90 ranges, never a single number, never a verdict);
- **Blur it (on-device)**: a rewrite by Gemini Nano, which you can put straight back into the composer or copy;
- the ledger line: **0 bytes of this draft left your computer**, with the count of on-device calls, cloud calls and network requests from the panel.

Everything is read on this computer by Gemini Nano, through Firebase AI Logic with `InferenceMode.ONLY_ON_DEVICE`. The extension reuses the web app's core (`src/lib`: router, extraction, checker, dossier, estimator, ledger) as-is.

## Your history

The panel's "Compared against" card sets what the draft is measured against. The active source is always shown.

- **Use the demo history (SYNTHETIC)**: the synthetic persona u/quietnight_rn from the web app. Its facts are from a recorded Gemini Nano run, re-checked by today's checker (`recheck()` from `src/lib/replay.ts`). No real person.
- **Paste my posts**: paste old posts (separated by blank lines) or pick your Reddit data export (.zip, only `posts.csv` and `comments.csv` are opened), JSON or CSV. Gemini Nano reads up to 50 posts on this computer, the most revealing first. The post text is not stored; only the details found (category, short value, short quote, date) go into `chrome.storage.local`.
- **No history**: the draft alone, against all US adults.

## Privacy model

**The draft never leaves your computer.** It goes from the Reddit tab's content script to the extension's service worker to the side panel over Chrome's internal extension messaging, is read by Gemini Nano in the panel, and is kept only in memory. The pill shows a one-line result in a closed shadow root, so Reddit's page scripts can't read it.

**The extension makes no network calls.** Here is every network-capable code path in the built extension and why none runs:

| Where | Code | Why it doesn't touch the network |
|---|---|---|
| Panel | `@firebase/ai` `makeRequest()` → `fetch()` to Firebase AI Logic | It's the cloud path. Every extension model is `ONLY_ON_DEVICE` (`route('draft'/'blur'/'extract', 'own')`, re-checked by `src/panel/guard.ts`, asserted at the `getGenerativeModel` boundary by `test/engine.test.ts`). In that mode the SDK prompts `LanguageModel` or throws. The SDK would fall back to the cloud only if no `LanguageModel` existed when the model was built; `extractFromPost()`/`blurDraft()` throw `BlockedError` before that can happen. |
| Panel | `@firebase/ai` Chrome adapter `fetch('data:…')` | Converts inline images to a Blob. Only text is sent, and `data:` URLs aren't network requests. |
| Panel | `src/panel/demo.ts` `fetch(chrome.runtime.getURL('demo/p1-demo.json'))` | A file inside the extension package. |
| Panel | PapaParse `XMLHttpRequest` | Only used for `Papa.parse(url, { download: true })`. `src/lib/importers.ts` only parses strings. |
| Panel | App Check token exchange, reCAPTCHA loader | Not in the bundle: App Check is compiled out (`src/panel/app-check-off.ts`), since there are no cloud calls. On-device calls never request a token (see ARCHITECTURE.md). |
| Panel | Links (Chrome built-in AI requirements) | Opens a normal browser tab when you click it; the panel itself makes no request. |
| Service worker | `fetch(chrome.runtime.getURL('build-id.txt'))` | Development builds only (absent from production builds); a file inside the package. |
| Content script | none | No fetch, XHR, WebSocket, storage, model or Firebase code (checked by `test/bundle.test.ts`). |

Chrome enforces it as well: the extension's CSP is `connect-src 'self'`, so the panel and the worker can't open a connection to anything but the extension's own files. The panel also counts its own network requests live (Resource Timing) and shows the number next to the ledger line.

Chrome downloads Gemini Nano itself, once, as a browser component. That download carries none of your text.

**Permissions:** `sidePanel`, `storage`, and host access to `https://www.reddit.com/*`, `https://old.reddit.com/*`, `https://sh.reddit.com/*`. No tabs, history, cookies, scripting or web requests.

## Install

```bash
npm install
npm run ext:build        # type-checks, then writes extension/dist
```

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose `extension/dist`.
4. Pin OneOf from the puzzle-piece menu if you like. Clicking its icon opens the side panel.

Development: `npm run ext:build -- --dev --watch` rebuilds on every change and the loaded extension reloads itself within about 3 seconds. Refresh any open Reddit tab after a reload (the old content script says "OneOf was updated · reload the page").

Tests: `npm run ext:test` (run `npm run ext:build` first so the bundle checks have something to read; they're skipped otherwise).

## Try it

1. Open the OneOf side panel (toolbar icon). The header should say **Gemini Nano · on device**. If it offers **Download Gemini Nano**, click it and wait.
2. In the panel, click **Use the demo history (SYNTHETIC)**. "Your crowd before any draft" shows about one of ~50.
3. Open any Reddit thread on www.reddit.com or old.reddit.com, click into the comment box, and type, for example: `I work nights as an ICU nurse in Columbus. My twins start school in May.` Don't post it.
4. Pause. After about 1.2 s the pill above the box shows "reading on-device…", then something like "one of ~50 → ~1 if you post this".
5. Click the pill: the panel shows the chips, the before/after meters, and "0 bytes of this draft left your computer".
6. Click **Blur it (on-device)**, then **Put it in the composer**. The pill re-checks the new text.
7. Close the panel and type more: the pill says "Open OneOf to check". Clicking it reopens the panel and the check resumes.
8. The × on the pill hides it for that box.

## Requirements

The same as the web app's on-device mode: desktop Chrome 138 or later with Gemini Nano (Windows, macOS, Linux or ChromeOS on Chromebook Plus), with enough disk space and a supported GPU or CPU. See [Chrome built-in AI: get started](https://developer.chrome.com/docs/ai/get-started). Without Gemini Nano the pill says "not checked · no on-device model". Drafts are never sent anywhere else.

## Limits

- Reddit only (www, old and sh.reddit.com). English only.
- The side panel must be open for drafts to be checked: that's where Chrome documents the Prompt API for extensions (see ARCHITECTURE.md).
- With several Reddit tabs, the panel checks the most recent draft. Another tab's pill can stay at "reading on-device…" until you type in it again.
- History scans read at most 50 posts.
- Base rates come from the bundled, cited tables only. The extension makes no cloud base-rate lookups, so details without a bundled rate are shown but not counted.
- Ranges are estimates. OneOf never outputs a name or an identity guess.
