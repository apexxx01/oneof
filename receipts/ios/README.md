# iOS receipts

Runs of the iOS app (SwiftUI, Firebase AI Logic 12.19.3) on the iOS 27.2 simulator on an
Apple-silicon Mac with Apple Intelligence on. Synthetic persona only: the app writes a receipt
for demo runs and never for the user's own posts.

## ios-run-200-2026-11-25T16-51-06Z.json (current, prompt a3, typed generation)

Full persona run with extraction through guided generation (`respond(to:generating: GFactBatch.self)`).

| | |
|---|---|
| Posts read | 200 / 200 |
| On-device / in cloud | **200 / 0** |
| Unreadable replies | **0** (free-text JSON in a1/a2 had some) |
| Facts kept / rejected by the checker | 14 / 45 |
| Region | Franklin County, Ohio (Columbus) |
| Attributes counted | registered nurse, single mother, night shift, divorced |
| Crowd | **one of ~50** (P50 50.13432259896638) |

**The same answer on two platforms.** The web build's recorded Gemini Nano run of this persona gives the same four attributes and region and a P50 of **50.13432259896637** under Node and **50.13432259896638** in Chrome (floating-point rounding differs between engine versions in the last digit). Two different on-device models (Apple Foundation Models on iOS, Gemini Nano in Chrome) produce the same dossier, and the Swift and TypeScript cores agree to the last digit. `npx tsx scripts/recheck-ios-receipt.ts receipts/ios/ios-run-200-2026-11-25T16-51-06Z.json` reproduces it from the receipt with today's checker (0 facts dropped).

This file is also bundled in the app as `recorded-run.json`: on a device without Apple Intelligence, OneOf offers a labelled replay of it.

## ios-run-200-2026-11-25T13-44-36Z.json (prompt a2, free-text JSON)

Full persona run (`@quietnight_rn`, 200 synthetic posts), prompt `a2`, on-device model
`FirebaseAI.SystemLanguageModel` (Apple Foundation Models).

| | |
|---|---|
| Posts read | 200 / 200 |
| On-device / in cloud | **200 / 0** |
| Median / p90 per post | 524 ms / 1,240 ms |
| Facts kept / rejected by the checker | 31 / 16 |
| Region | Franklin County, Ohio (Columbus) |
| Attributes counted | ICU nurse, single mother, night shift, divorced |
| Crowd | **one of ~9** (P10 1, P90 91): a handful |

Same facts as the web Nano run, except Apple's model filed the job as "ICU nurse", which is more specific than "registered nurse", hence ~9 rather than ~50.
`ios-run-200-2026-11-25T16-40-40Z.json` is the same prompt re-run after the checker fixes, with an identical result.

**Recheck with today's checker:** `npx tsx scripts/recheck-ios-receipt.ts receipts/ios/<file>`
re-runs the web build's TypeScript `verify()` and estimator over the recorded facts. It drops 7
facts the run kept ("the bus driver waited for me" filed as the author's job; the rule
"a job named with *the* is someone else's" was added after this run, in both clients) and
recomputes the crowd as P50 8.98355850425896: identical to the number the iPhone computed, because
the Swift core is a golden-tested port of the TypeScript one.

## scan-60-on-device.jpg

First working quick scan (60 posts, 60 on-device, 0 cloud), before the figurative-age rule. Its
"~50" leaned on "I feel 80 years old", a designed trap in the persona; that is why the rule exists.
