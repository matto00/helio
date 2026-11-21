## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 16a6042d6854de39fe6e1b5d8ac9ee239821b40e (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/client-regex-long-cell-cap/HEL-1697`.
- Read ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-client-evaluator/spec.md, skeptic-design-1.md, and
  the live `javaRegex.ts` (300 lines), `javaRegexCost.ts`, `evaluateStep.ts`, `steps/stringOps.ts` (extractRegex is one
  `regex.exec(anyToString(v))` per cell, so the per-cell model is the right unit), `steps/types.ts`,
  `e2e/hel1683-regex-main-thread.spec.ts`.
- Probe: I implemented design D1 independently over the REAL `translate()` tree (round-1's tsc build of the current
  sources): `F = altsPaths x max(1, W)`, W = altsWeight with a wide atom weighing `max(1, min)`; `m = max over wides
  with an item after them (presence, after enclosing groups) of paths x max(1, tail)`; per cell
  `len x min(len, F) + m x len^2`. Timed `compiled.regex.exec` over 1,000 distinct row strings, best of 3,
  `nice -n 19`. Scripts: `.concertino/scratch/HEL-1697/skeptic2/probe2.cjs`, `cases1.cjs`..`cases3.cjs`.

Round-1 change requests:

1. CR1 (non-wide work uncharged) — ADDRESSED. Counted atoms enter F (weightOf already weighs a non-wide atom at its
   `max`). Measured ns/unit: `(a{1000})b` 1.64, `(.{1000})x` 1.53, `(\w{100})x` 1.83 (vs `a*b` 0.47). The "linear
   patterns are never charged" wording is gone from proposal/design/spec (grep: only "no zero multiplier" remains);
   the spec requirement now says every accepted pattern is charged.
2. CR2 (wide with large min, empty tail) — ADDRESSED. `(a{1000,})` on 999-`a` runs: F=1000, 1.06 ns/unit. Context
   paragraph rewritten to the true condition.
3. CR3 (finite calibration list + Jest decisions) — ADDRESSED. The list is concrete and includes every round-1
   counterexample shape; task 1.1 adds decline tests for `(a*)b`, `(a{1000})b`, `(a{1000,})`, and task 2.1 mutation
   checks "F forced to 1" and "m forced to 0" each make the corresponding test red. The two "Rule N edge patterns the
   executor finds" are a bounded addition, not an open-ended criterion.
4. CR4 ("non-empty tail") — ADDRESSED: "by item presence, anchors included, after enclosing groups".

Counterexample search (all accepted by `compileJavaRegex` today; ns per model unit at 1,000 rows):

| pattern (cell) | F / m | measured | ns/unit |
| --- | --- | --- | --- |
| `a*b` (a x2000) | 2 / 1 | 1,885 ms | 0.47 |
| `(a*)$` (a x2000 + !) | 3 / 2 | 4,859 ms | 0.61 |
| `(a{0,7})b` (a x2000) — listed | 8 / 0 | 33 ms | 2.04 |
| `(a{16})b`, `(a{1,16})b` | 17 / 0 | 65-69 ms | 1.9-2.0 |
| `(\d{1,16})\.` (1 x2000) | 17 / 0 | 88 ms | 2.57 |
| `([^x]{1,16})x` (astral x1000) | 17 / 0 | 97 ms | 2.85 |
| `(\S{16})x` (astral x1000) | 17 / 0 | 102 ms | 3.00 (max found) |
| `(.{500})x` (astral x1000) | 501 / 0 | 2,404 ms | 2.40 |
| `([^b]*)b`, `(\S*)x`, `(\W*)x`, `(\s*)x`, `([ab]*)c` | 2 / 1 | 1.8-2.6 s | 0.45-0.66 |
| alternation within Rule N, 60-char literal, 16 `$` | | <= 12 ms | <= 0.1 |
| `(a{1000,}?)b` lazy, `(a*?)b` | | | 0.55 / 0.19 |

  Worst found is ~1.5x the expected listed maximum (~2.0), from narrow/counted negated classes on astral (surrogate
  pair) input. With the 20 ms target that is ~30 ms, still under the 50 ms long-task threshold and the e2e 100 ms bound:
  not a "greatly exceeds" counterexample. Structurally: groups are never quantified, two wides require the first fenced
  (one extent, so per-start work stays O(len)), and unfenced tails are capped by MAX_TAIL_COST, so I found no shape
  whose growth exceeds `len x F + m x len^2`.
- Corpus stays unchanged: computed the model cost of all 25 accepted extractRegex vectors in
  `shared-test-fixtures/pipeline-step-parity/*.json` (`skeptic2/corpus.cjs`): max 495 units, orders of magnitude below
  any budget near 1e7. `clientEvaluable` remains config-only and has no production consumer outside the evaluator
  module (grep); routing is by node status (`draftEvaluation.ts:118`), so a data-dependent `needsServer` is routed.
- Spec scenarios are consistent with a ~1e7 budget: `(a*)b` 1,000 x 500 = 2.5e8 (declines); `(a+)`/`(\d+)` 1,000 x
  2,000 = 2e6 (client-side); `(a{1000,})` 2e9 (declines).
- Wiring targets exist: `evaluateStep.ts:62-68` (declines -> problems -> apply, `input` in scope), `StepHandler` in
  `steps/types.ts:36`.

### Verdict: CONFIRM

### Non-blocking notes

- Calibration: add an astral (surrogate-pair) cell variant of a counted negated class (e.g. `(\S{16})x`, or `(.{500})x`
  on astral cells) to the list. It measured 3.0 ns/unit against about 2.0 for the listed shapes. Budgeting from it
  removes the remaining ~1.5x under-estimate.
- D1 does not say which weight a wide atom inside the tail gets in m (1, as in HEL-1683 `collectWides`, or
  `max(1, min)`). It also does not say whether "item presence" is judged before or after `flatten` (`flatten` drops an
  empty `()`). Both readings are conservative because F already charges min. Pin one in the code comment.
- The e2e probe's cell sizing: 1,000 rows x 1,000 chars of `a*b` is about 480 ms locally, just under the stated 5x
  (500 ms). Size it with margin.
