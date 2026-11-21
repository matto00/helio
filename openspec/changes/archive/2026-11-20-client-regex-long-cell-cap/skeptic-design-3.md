## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD bd10d1767eb04e9467428155ed99c92554a01f11 plus the uncommitted design.md / spec.md / tasks.md revision
(D1 "Cycle-2 refinement"). Probes: `/home/matt/Development/helio/.concertino/scratch/HEL-1697/skeptic3/` (the current
`javaRegex*.ts` compiled with the worktree's tsc into `js/`; `runprobe.cjs` is my own implementation of the run-based
cost from the design text: `U` = union of every atom set of the real `translate()` tree, runs over code points counted in
UTF-16 units, `cost = len + sum(R*min(R,F) + m*R^2)`, with F/m taken from the shipped `regexWorkModel`. For each case
it sizes 1,000 rows so the step cost is just under the 6e6 budget, then times V8 best of 3). Node v22.23.2.

### What I verified (with evidence)

- **Run decomposition: no counterexample found.** The allowlist has no lookaround, backreferences, `\b` or flags, so the
  only zero-width items are `^` and the DOLLAR translation (a lookahead that looks at most 2 characters ahead, plus a
  1-character lookbehind: constant work). Every consuming item is an atom whose exact set is in the tree, so an attempt
  cannot consume across a non-`U` character. Measured at the budget (ns/unit; the calibrated max is 2.957):
  - alternation with up to 32 alternatives on 1-7 character runs (`(ab|ac|...)`, `([ab]{7}c|...)` x8, `([ab][ab][ab]A|...)` x16): 0.12-0.42
  - `(a|aa)(a|aa)(a|aa)x`, `([ab]|[ab][ab])x3 x` on runs of 1-6: 0.21-0.36
  - non-`U` positions doing zero-width work (`(a?)(b?)(c?)$` on `!`, `(a{0}x500)$`, `(a)$x200`): 0.27-2.63. Rule N
    bounds this: with k optional atoms, paths 2^k times weight k+2 must stay <= 64, so k <= 3.
  - `(a*)$` on `a!`: 1.82; `(\S{16})x` on valid pairs: 1.12-2.73; `(.{500})x` on `a`: 1.00.
  The per-run cost is never above the per-cell cost, and the `len` scan term covers the work done at non-`U` positions.
- **Lone surrogates break the calibration. This is in the cycle-1 model too, and the refinement does not fix it.** In
  cells made of unpaired high surrogates (`\uD800...`), V8's `u`-mode engine runs at about twice the calibrated max
  ns/unit. Those code points are in `DOT_SET` and in every complement set, so the whole cell is one run and the run-based
  cost equals the cycle-1 cost. Five-run timings from `skeptic3/lone.cjs` (distinct flat strings, 1,000 rows, cost
  5,994,000, which is under the budget, so the step is accepted):
  - `(\S{16})x` on lone high surrogates: 31.5-33.5 ms (5.26 ns/unit)
  - `(.{16})x` on lone high surrogates: 34.0-34.4 ms (5.68 ns/unit)
  - `(\S{16})x` on lone low surrogates: 21-22.6 ms (3.50 ns/unit)
  - `(\S{16})x` on ASCII: 9.4 ms (1.56 ns/unit), the control
  - from `runprobe.cjs` / `cases5.json`: `(.{12})x` 35.5 ms (5.92), `(.{8})x` 4.54, `(.{30})x` 5.44, `(\D{16})x` /
    `(\W{16})x` / `[^a]{16}x` 5.3-5.7

  These are stable across three separate runs. The spec delta says the budget "SHALL be calibrated so that a step at
  the budget runs in at most 20 milliseconds". On this machine, accepted steps run in 34-35 ms. On a 2-3x slower CI
  runner that is 70-105 ms, against the 100 ms bound. D1's calibration list covers valid astral pairs only, so the
  planned re-calibration would carry the gap forward.
- **The anchor refinement is sound as specified.** V8 makes a single attempt for every `^`-led shape I tried, including
  `^`-led patterns inside a capture group and inside alternation: `^(a*)b`, `(^a*)b`, `((^a*))b`, `^(a*)b|^(a)c`,
  `(^a*b|^c)`. Evidence from `skeptic3/anchor.cjs`:
  - On 1,000 x 100,000-character cells: 92-112 ms when the first run is the whole cell; 0.01-0.03 ms when `cell[0]` is
    not in `U`; about half when the first run is half the cell.
  - `^(.*)$`: linear (0.77 ms at 2k, 37 ms at 100k).

  So `R0 x (1+m) + F` holds without a `len` term (the time is O(1) when `R0 = 0`). The design makes the refinement
  conditional on measuring this, which is the right gate.
- Scope and wiring are unchanged from round 2 (`clientEvaluable` stays config-only and the corpus is untouched). Tasks
  3.1-3.4 cover evaluation-1's CR1, CR2, the refinement and the duplicate import.

### Verdict: REFUTE

### Change Requests

1. **design.md D1 (Budget calibration list) and tasks.md 3.3: cover unpaired surrogates.** Do one of these:
   - (a) Add lone-high-surrogate cells (e.g. 1,000 rows of `\uD800` repeated, with distinct last characters) for
     `(.{12})x`, `(.{16})x` and `(\S{16})x` to the calibration list, and re-derive `REGEX_WORK_BUDGET` from the new max
     ratio (about 5.9 ns/unit here, which gives about 3.3e6).
   - (b) Keep the budget, and in the cost pass charge each unpaired surrogate code unit as extra units (for example x2,
     enough that the measured ratio falls to or below the calibrated max). Calibrate that charge, and add a Jest test
     that an over-budget lone-surrogate frame is declined, red under the mutation that removes the charge.

   Either way, record the lone-surrogate rows in `regex-work-calibration.md` and name the chosen remedy in D1. (b)
   keeps ordinary text client-side, which is what the cycle-2 refinement is for. Reproduce with
   `/home/matt/Development/helio/.concertino/scratch/HEL-1697/skeptic3/lone.cjs`.

### Non-blocking notes

- Anchor refinement: compute eligibility on the flattened tree, and add Jest cases for `(^a*)b` and `^a*b|^c`
  (eligible) and `^a*b|c*d` (not eligible). V8 anchors through groups, so the flattened reading matches the engine.
- The run scan must decode with `codePointAt` and step 2 only for a real pair, so a lone surrogate counts as its own
  code point (1 unit). That matches `u`-mode semantics and `DOT_SET`.
- Housekeeping: I killed my own over-long probe process (exact PID 2132638, `node anchor.cjs 100000`). It was a scratch
  run, not a server.
