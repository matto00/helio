## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed HEAD bd10d1767eb04e9467428155ed99c92554a01f11 plus the uncommitted design.md / spec.md / tasks.md revision
(D1 "Unpaired surrogates", remedy (b), `LONE_SURROGATE_UNITS = 2`). Node v22.23.2, `nice -n 19`, one process at a time.
Probes are in `/home/matt/Development/helio/.concertino/scratch/HEL-1697/skeptic4/`:
- `surr.cjs` is my own implementation of the run-based cost with the lone-surrogate charge, built from the D1 text.
  It decodes with `codePointAt` and steps 2 only for a real pair. A lone unit adds `LONE` (default 2) to `len` and to
  the run length. The script sizes 1,000 rows to just under the 6e6 budget, then takes the best of 5 timings.
- `twobyte.cjs` and `twobyte2.cjs` time two-byte cells that contain no surrogates.
These probes use the compiled `javaRegex*.js` in `skeptic3/js`.

### What I verified (with evidence)

- **The surrogate charge, measured on its own terms (`surr.cjs c1.json`, `c2.json` x3):**
  - Lone high, under charge 2: `(.{12})x` 2.92-3.04 ns/unit, `(.{16})x` 2.75-2.81, `(\S{16})x` 2.54, `(\D{16})x`
    2.55, `[^a]{16}x` 2.67, `(\W{16})x` 2.77.
  - Lone low, under charge 2: 1.74-2.00. This shape is overcharged, which is safe.
  - Mixed lone and ASCII (`\uD800a`, `a\uD800`): `(.{16})x` 3.11-3.36, `(.{12})x` 3.38-3.41. Mixed lone and paired
    (`\uDC00\uD800`, `\uD800😀`): 2.88-3.05.
  - Quadratic shapes (`(.*)x`, `(.+)x`, `(\S+)x`, `(.*?)x`) on lone units: 0.39-0.96. The 4x quadratic charge is
    ample.

  So a charge of 2 does **not** bring every lone-surrogate shape under 2.957. Mixed lone/ASCII cells stay at
  3.1-3.4, and `(.{12})x` on lone high sits at the line. D1 does say "else raise the charge until it is". That
  procedure would catch this, so it is not a defect by itself. But the next finding shows that the variable being
  charged is the wrong one.
- **The underlying cause is V8's two-byte string representation, not lone surrogates. No surrogate is needed.** Two
  runs of `twobyte2.cjs` gave stable results. The cost is the same as the shipped/run-based cost, because `U` covers
  the whole cell for `.` and `\S`.

  | shape (1,000 rows, 333 chars, at budget) | `(.{16})x` | `(\S{16})x` | `(.{8})x` |
  |---|---|---|---|
  | one-byte `a...` (control) | 1.89-1.94 | 1.70-1.79 | 1.83-1.84 |
  | Cyrillic text | 4.58-4.72 | 4.23-4.37 | 4.78-5.10 |
  | CJK text | 4.62-4.68 | 4.19-4.25 | 4.79-4.84 |
  | `a` x331 + one em dash | 4.54-4.63 | 4.27-4.29 | 4.68-5.19 |
  | ASCII content in a two-byte string (`("—"+a...).slice(1)`) | 4.47-4.77 | 4.17-4.17 | 4.68-6.41 |

  `twobyte.cjs` gives the same picture for `(.{12})x` (4.41-4.45) and `(.{100})x` (4.21-4.37). It also shows
  `(.*)x` at 2.16-2.20, against 0.53 for the one-byte control.

  Accepted steps at the budget therefore run in 25-28 ms (17 ms for `(.{8})x`) on any cell that holds one
  character above U+00FF. That covers Cyrillic, CJK, Greek, and English text with a single em dash or curly quote.
  The spec requires at most 20 ms. On a 2-3x slower runner this is 55-85 ms, which erodes the long-task headroom the
  design relies on.

  The calibration table (`calibrate.mjs`) never measures this case. Every shape is one-byte except `astral`. Astral
  pairs happen to run faster per unit (2.5-3.1) than two-byte BMP text, so the table's max of 2.957 understates the
  real max by about 1.6x.

  The lone-surrogate charge does not help here: it charges only surrogate code units, and none of these cells has
  one. The last row also shows that representation cannot always be seen from content. An ASCII-only cell sliced out
  of a two-byte parent runs at the two-byte rate, and the content check `cp > 0xFF` returns false for it.
- **Nothing else in D1 regressed.**
  - The run decomposition and the conditional anchor refinement are unchanged from round 3, which already verified
    them.
  - The quadratic shapes stay far under the calibrated max, even on two-byte and lone cells (at most 2.2).
  - `clientEvaluable` stays config-only.
  - The corpus is not touched: `git status` shows only the change dir modified.

### Verdict: REFUTE

### Change Requests

1. **design.md D1 calibration list and tasks.md 3.3/3.5: calibrate against two-byte BMP cells, not only lone
   surrogates.**
   - Add these rows to the calibration list and to `regex-work-calibration.md`, for `(.{8})x`, `(.{12})x`,
     `(.{16})x`, `(\S{16})x`, `(.{100})x` and `(.*)x`:
     - Cyrillic text
     - CJK text
     - ASCII plus one em dash
     - an ASCII-content cell held in a two-byte string (a slice of a two-byte parent)

     Repro: `/home/matt/Development/helio/.concertino/scratch/HEL-1697/skeptic4/twobyte2.cjs`.
   - Then choose one remedy and name it in D1:
     - (a) Derive `REGEX_WORK_BUDGET` from the max ratio including these rows. That is about 4.7-5.2 ns/unit here,
       which gives a budget of about 3.9-4.3e6. I recommend (a), because representation is not always observable
       from content.
     - (b) Charge a calibrated per-cell multiplier for two-byte cells. If you choose this, D1 must show either that
       the multiplier's trigger catches every two-byte cell the evaluator can feed to the regex, or that the
       uncaught cases are bounded and measured. Cells produced by earlier client steps (substring, split, extract)
       from two-byte inputs are exactly the sliced case above. Also add a Jest decline test, red under the mutation
       that removes the charge.
2. **Re-check the lone-surrogate charge against whichever max results.**
   - Under (a), lone-high uncharged runs at 5.3-5.9 and charged-2 at 2.5-3.4. Keep the charge only if the uncharged
     lone rows exceed the new max, and record which way it went.
   - Under either remedy, include the mixed lone/ASCII shape (`\uD800a`, which measured 3.1-3.4 under charge 2) and
     `(.{12})x` on lone high among the calibration rows. Those are the shapes that sit at or above the current line.

### Non-blocking notes

- spec.md now says "one unit per character". If the surrogate charge (or a two-byte charge) ships, the spec sentence
  should say that some characters are charged more, or say nothing about the per-character unit. Otherwise the spec
  and the code disagree.
- tasks.md lists 3.5 before 3.4. This is cosmetic.
- Ordinary Latin text still stays cheap even when it is two-byte (curly-quote text: 0.06-0.84), because real text
  rarely contains long runs of the trailing literal. So remedy (a) moves fewer real drafts to the server than its
  smaller budget suggests. The PR-body threshold note should be re-measured after the change.
