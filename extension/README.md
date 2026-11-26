# OneOf for Chrome: check before you post

While you write a post, comment or message, a small pill next to the box shows how identifiable the draft makes you:

> **1/** ONE OF **~1** WAS ~50 · IF YOU POST THIS

It works out of the box on Reddit and on the [practice composer](https://oneof-app.vercel.app/practice/), and on any other site you turn on (Hacker News, X, LinkedIn, GitHub, Discord web, Gmail…). Click the pill and the OneOf side panel opens with:

- the details found in this draft, as chips (counted ones outlined in signal orange; found but uncounted ones dimmed);
- a small **crowd field**: 1,600 dots, one lit for every slice of the crowd you could still be. Dots this draft would darken are outlined before you post;
- your crowd **before** and **if you post it**, using your history dossier (P10–P90 ranges, never a single number, never a verdict, always marked as an upper bound);
- **Blur it on this device**: a rewrite by Gemini Nano, which you can put straight back into the composer or copy;
- the receipt: **0 B of this draft left your computer**, with on-device calls, cloud calls and network requests from the panel;
- **Where drafts are checked**: the built-in sites, the sites you turned on (each with a Remove button), and **Check drafts on this site** for the open tab.

Everything is read on this computer by Gemini Nano, through Firebase AI Logic with `InferenceMode.ONLY_ON_DEVICE`. The extension reuses the web app's core (`src/lib`: router, extraction, checker, dossier, estimator, ledger) as-is.

## Your history

The panel's "Compared against" card sets what the draft is measured against. The active source is always shown.

- **Use the demo history (SYNTHETIC)**: the synthetic persona u/quietnight_rn from the web app. Its facts are from a recorded Gemini Nano run, re-checked by today's checker (`recheck()` from `src/lib/replay.ts`). No real person.
- **Paste my posts**: paste old posts (separated by blank lines) or pick your Reddit data export (.zip, only `posts.csv` and `comments.csv` are opened), JSON or CSV. Gemini Nano reads up to 50 posts on this computer, the most revealing first. The post text is not stored; only the details found (category, short value, short quote, date) go into `chrome.storage.local`.
- **No history**: the draft alone, against all US adults.

## Privacy model

**The draft never leaves your computer.** It goes from the page's content script to the extension's service worker to the side panel over Chrome's internal extension messaging, is read by Gemini Nano in the panel, and is kept only in memory. The pill shows a one-line result in a closed shadow root, so the page's scripts can't read it. Its two fonts are tiny subsets of Archivo and JetBrains Mono inlined in `content.js` and registered from bytes, so the page never loads a font file from the extension.

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

**Permissions:**

| Permission | Why |
|---|---|
| `sidePanel` | The panel is where Gemini Nano runs. |
| `storage` | Keeps the history dossier (facts only, never post text) in `chrome.storage.local`. |
| `scripting` | Registers the content script on sites you turn on, and injects it into the open tab once. |
| `activeTab` | Lets Chrome show the panel the open tab's address when it grants it, so "Check drafts on this site" can name the site. No install warning, no standing access. |
| Host access: `www/old/sh.reddit.com`, `oneof-app.vercel.app/practice/*`, `apexxx01.github.io/oneof/practice/*`, `localhost:5173` | Built-in sites: Reddit, the practice page, and the dev server's practice page. |
| Optional: `https://*/*` | Never granted as a whole. Each site you turn on asks Chrome for that one origin (`https://x.com/*`), with Chrome's own prompt. |

No `tabs`, history, cookies, web requests, network rules, `externally_connectable` or web-accessible resources (`test/bundle.test.ts` checks the manifest for each of these).

## Any site you allow

Reddit and the practice page work with no setup. For anything else:

1. Open the site (say `news.ycombinator.com`) and the OneOf side panel.
2. Under **Where drafts are checked**, click **Check drafts on this site**. If Chrome hasn't told the panel which site the tab is on, type it (or tap one of the suggestions) first.
3. Chrome asks: *Allow OneOf to read and change your data on news.ycombinator.com?* Allow.
4. OneOf registers its content script for that origin with `chrome.scripting.registerContentScripts` (persisted across restarts) and injects it into the open tab, so the pill works without a reload.

**Remove** next to a site unregisters the script and gives the permission back (`chrome.permissions.remove`). If you revoke site access in Chrome's own menus instead, the service worker notices (`permissions.onRemoved`) and unregisters the script; on startup it reconciles registrations with permissions.

What counts as a composer: `<textarea>`s and `contenteditable` editors (Reddit's Lexical, X's Draft.js, LinkedIn's Quill, Discord's Slate, Gmail's compose body, GitHub and Hacker News textareas), and tall free-text inputs. Ignored: password, search, URL, email and other non-text inputs, search boxes and comboboxes, account fields, read-only or disabled boxes, and single-line fields under 40 px tall. The check runs 1.2 s after you stop typing.

## Practice page

[oneof-app.vercel.app/practice/](https://oneof-app.vercel.app/practice/) (mirrored at apexxx01.github.io/oneof/practice/) is a made-up forum thread with a reply box, a rich-text box, a short display-name field and a search box (the last two are ignored, on purpose). It is clearly labelled "Practice composer — nothing here is posted anywhere": it has no network or model code, and "Post reply" only says it didn't post. It's built in, so the extension works there with no setup, and **Use a sample draft** fills the reply box with the demo draft. Locally, `npm run dev` serves it at `http://localhost:5173/practice/`, which is built in too.

## Install

```bash
npm install
npm run ext:build        # type-checks, then writes extension/dist
```

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose `extension/dist`.
4. Pin OneOf from the puzzle-piece menu if you like. Clicking its icon opens the side panel.

Development: `npm run ext:build -- --dev --watch` rebuilds on every change and the loaded extension reloads itself within about 3 seconds. Refresh any open tab with a composer after a reload (the old content script says "OneOf was updated · reload the page").

Tests: `npm run ext:test` (run `npm run ext:build` first so the bundle checks have something to read; they're skipped otherwise).

## Try it

1. Open the OneOf side panel (toolbar icon). The header should say **Gemini Nano · on device**. If it offers **Download Gemini Nano**, click it and wait.
2. In the panel, click **Use the demo history (SYNTHETIC)**. "Your crowd before any draft" shows about one of ~50.
3. Open the [practice composer](https://oneof-app.vercel.app/practice/) (or a Reddit thread), click into the reply box, and type, for example: `I work nights as an ICU nurse in Columbus. My twins start school in May.` Or click **Use a sample draft**.
4. Pause. After about 1.2 s the pill above the box shows "reading on-device…", then something like **ONE OF ~1 · WAS ~50 · IF YOU POST THIS**, in signal orange because the draft shrinks your crowd.
5. Click the pill: the panel shows the chips, the crowd field with the dots this draft would darken outlined, before and after, and "0 B of this draft left your computer".
6. Click **Blur it on this device**, then **Put it in the composer**. The pill re-checks the new text.
7. Close the panel and type more: the pill says "Open OneOf to check". Clicking it reopens the panel and the check resumes.
8. The × on the pill hides it for that box.

## Requirements

The same as the web app's on-device mode: desktop Chrome 138 or later with Gemini Nano (Windows, macOS, Linux or ChromeOS on Chromebook Plus), with enough disk space and a supported GPU or CPU. See [Chrome built-in AI: get started](https://developer.chrome.com/docs/ai/get-started). Without Gemini Nano the pill says "not checked · no on-device model". Drafts are never sent anywhere else.

## Limits

- Built in: Reddit (www, old and sh.reddit.com) and the practice page. Other sites are opt-in, one https origin at a time. English only.
- Composers inside iframes (some embedded comment widgets) aren't checked: the script runs in the top frame only.
- The side panel must be open for drafts to be checked: that's where Chrome documents the Prompt API for extensions (see ARCHITECTURE.md).
- With several tabs, the panel checks the most recent draft. Another tab's pill can stay at "reading on-device…" until you type in it again.
- History scans read at most 50 posts.
- Base rates come from the bundled, cited tables only. The extension makes no cloud base-rate lookups, so details without a bundled rate are shown but not counted.
- Ranges are estimates. OneOf never outputs a name or an identity guess.
