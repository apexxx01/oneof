# iOS receipts

Runs of the iOS app (SwiftUI, Firebase AI Logic 12.19.3) on the iOS 27.2 simulator on an
Apple-silicon Mac with Apple Intelligence on. Synthetic persona only: the app writes a receipt
for demo runs and never for the user's own posts.

## ios-run-200-2026-11-25T13-44-36Z.json

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

Same dossier the web build finds with Gemini Nano (nurse, single mother, night shift, divorced,
Columbus).

**Recheck with today's checker:** `npx tsx scripts/recheck-ios-receipt.ts receipts/ios/<file>`
re-runs the web build's TypeScript `verify()` and estimator over the recorded facts. It drops 7
facts the run kept ("the bus driver waited for me" filed as the author's job; the rule
"a job named with *the* is someone else's" was added after this run, in both clients) and
recomputes the crowd as P50 8.98355850425896: identical to the number the iPhone computed, because
the Swift core is a golden-tested port of the TypeScript one.

## scan-60-on-device.jpg

First working quick scan (60 posts, 60 on-device, 0 cloud), before the figurative-age rule. Its
"~50" leaned on "I feel 80 years old", a designed trap in the persona; that is why the rule exists.
