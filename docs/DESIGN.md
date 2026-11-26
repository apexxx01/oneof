# OneOf design language (web, Chrome extension, iOS)

Sibling of Jury's identity (github.com/apexxx01/jury): brutalist editorial, a newspaper front page about
you. Black and white, one hot signal colour, hard rules, huge condensed numerals, mono labels. Every
screen should read like the front page that says how findable you are.

## Tokens
| Token | Dark (default) | Light |
|---|---|---|
| bg | #000000 | #ffffff |
| fg | #f5f5f2 | #0a0a0a |
| mut | #9b9b9b | #5e5e5e |
| faint | #5c5c5c | #a3a3a3 |
| line | #232323 | #d9d9d9 |
| line2 | #3a3a3a | #bdbdbd |
| well | #0e0e0e | #f1f1ef |
| signal (the crowd shrinking, danger, primary action) | #ff4a1c | #e8380d |
| device (on-device, safe paths, 0 bytes) | #1fe07f | #007a3f |
| cloud (cloud calls, public statistics) | #6ea8ff | #1f5fd1 |
| amber (replay, partial, rough grade C) | #f5b544 | #a86500 |
| shadow | 6px 6px 0 fg (hard, no blur) | same |

Bands: crowd = device green, neighbourhood = amber, room = signal, handful = signal on a solid block.

## Type
- Display: **Big Shoulders** variable (weight and optical-size axes), weight 900. Every heading is set
  in **uppercase** (civic signage, a public notice about you), line-height .9. The crowd number is the
  hero of every screen: 96–180px on desktop, 72–110pt on phone. "one of" sits small and mono next to it.
- Body: **Schibsted Grotesk** variable, a grotesk drawn for a newsroom, 15px/1.45.
- Labels and data: **Martian Mono** variable at `font-stretch: 87.5%`, 11px, 700, uppercase,
  letter-spacing .09em. Tabular figures on numerals and data only (Schibsted's tabular punctuation looks
  broken in running text).
- iOS: system font `.width(.compressed)` + `.weight(.black)` for numerals (SF Pro Compressed),
  `.monospaced` design for labels, Dynamic Type via TextStyle-relative sizes.
- Fonts are self-hosted (the extension CSP forbids remote fonts): @fontsource-variable/big-shoulders,
  schibsted-grotesk and martian-mono. The in-page pill inlines static subsets made by
  `extension/scripts/pill-fonts.py`; the practice page ships its own copies in `public/practice/fonts/`.

## The one bold thing: the crowd field

The memorable element on every platform. A halftone field of small square dots, each one a slice of
the crowd you hide in. It starts fully lit (all US adults). Each counted detail darkens a share of it on
a log scale, in posting order, until at "a handful" only a few dots stay lit, in signal. It sits behind
or beside the crowd numeral and is the hero of the result, the scan and the draft check (where the draft's
extra darkening is previewed in signal before you post). It must be deterministic (seeded by the
dossier), cheap (canvas on web and extension, Canvas/TimelineView on iOS), and respect reduced motion
(no animated thinning; jump to the end state).

Everything else stays quiet so this lands: no gradients, no glows, no decorative illustrations.

## Restraint notes (Jury DNA, applied with judgement)
- Uppercase mono labels only for status cells and source badges (data). Section headings are Big Shoulders
  in uppercase, large ("What a stranger learns", "Rejoin the crowd").
- No middle-dot meta strings in body copy; use separate cells or short sentences.
- No arrows appended to buttons. Buttons say exactly what happens ("Scan all 200 posts").

## Components
- **Top bar:** sticky, 56px, 2px bottom rule in fg; brand cell (mark "1/" on a solid fg square + "OneOf"
  wordmark at font-stretch 118%) separated by a 2px rule; status cells (Gemini Nano / Apple Intelligence
  state, App Check, bytes sent) as bordered mono cells.
- **Ticker:** full-width fg strip with bg text, mono uppercase, slow marquee (pauses on hover, off with
  reduced motion): live facts like "200 POSTS READ ON-DEVICE · 0 BYTES OF YOUR POSTS SENT · ONE OF ~50".
- **Demo/replay banner:** diagonal stripes (bg/well), 2px fg bottom rule, a solid fg tag ("REPLAY",
  "SYNTHETIC").
- **Cards:** 2px fg border, no radius (max 2px), hard 6px offset shadow on the primary card only.
- **Buttons:** primary = solid signal, fg text black, 2px fg border, hard 4px shadow that collapses on
  press (translate 4px). Secondary = transparent with 2px fg border. Squared corners.
- **Chips (facts):** mono category label + Schibsted value; counted = 2px signal border; not counted =
  1px line, muted. Count suffix "×3".
- **Meter:** a 10px hard bar from 1 to 100M (log), band-coloured segment for P10–P90, a square marker for
  P50, mono ticks 1 · 100 · 10k · 1M · 100M.
- **Crumb trail:** step chart, fg line 2px, signal markers, a dashed "a room (100)" rule, a signal
  "you left the crowd" rule with a mono label.
- **Source badges:** "ON DEVICE" green solid-outline, "IN CLOUD" blue, "REPLAY" amber, "BLOCKED" signal.
- **Ledger:** looks like a receipt: mono, dotted leaders, totals in big condensed numerals ("0 B").

## Motion
Numbers tick (numeric content transitions), the meter marker slides, the ticker scrolls. Nothing else
moves. All motion off under reduced-motion.

## Copy voice
Front-page headline voice, plain words, never "safe". The crowd number always comes with its range and
"upper bound" honesty line.
