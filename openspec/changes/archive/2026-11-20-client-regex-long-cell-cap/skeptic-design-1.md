## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 16a6042d6854de39fe6e1b5d8ac9ee239821b40e (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/client-regex-long-cell-cap/HEL-1697`.
- Read ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-client-evaluator/spec.md, and the live
  `javaRegex.ts` (300 lines), `javaRegexCost.ts`, `evaluateStep.ts`, `steps/stringOps.ts`, `steps/types.ts`,
  `pipelineStepParity.test.ts`, `state/draftStepView.ts`.
- Probe method: compiled the REAL `javaRegex.ts`/`javaRegexCost.ts`/`javaRegexSets.ts` with the worktree's `tsc`
  into `.concertino/scratch/HEL-1697/skeptic/js/` (scratch copy only exports `translate`/`flatten`/`altsPaths`/
  `collectWides` for inspection), computed the design's multiplier `m = paths x max(1, tail)` over wides with a
  non-empty tail (else 0), and timed `compiled.regex.exec` over 1,000 identical rows, best of 3, `nice -n 19`
  (`.concertino/scratch/HEL-1697/skeptic/probe.cjs`). Every pattern below is ACCEPTED by `compileJavaRegex` today.

| pattern | cell | design m | measured (1,000 rows) |
| --- | --- | --- | --- |
| `a*b` | a x 2000 | 1 | 1,921 ms |
| `a*b` | a x 1000 | 1 | 504 ms |
| `(a*)$` | a x 1000 + ! | 2 | 1,322 ms (0.66 ns/unit) |
| `([a-z]+)-([a-z]+)` | a x 1000 | 2 | 533 ms |
| **`(a{1000})b`** | a x 2000 | **0** | **3,812 ms; re-run 3,380 ms** |
| **`(a{1000,1015})b`** | a x 2000 | **0** | **3,890 ms** |
| **`(.{1000})x`** | a x 2000 | **0** | **3,061 ms** |
| **`(a{1000,})`** (wide, EMPTY tail) | (a x 999 + b) x 2 | **0** | **1,998 ms**; x4 blocks 4,024 ms |
| **`(\w{100})x`** | a x 2000 | **0** | **370 ms** |
| `(\d{20})x` | 1 x 2000 | 0 | 101 ms |
| `(a+)` | a x 2000 | 0 | 0.8 ms |

  Reproduced: `(a{1000})b` measured twice (3.8 s, 3.4 s) — a stable result, not tooling noise.

- Claim "a wide quantifier with an empty tail is linear in V8": FALSE in general. It holds for small `min`
  (`(a+)` 0.8 ms) but `(a{1000,})` — wide, tail weight 0, so m = 0 — costs ~2 s per 1,000 rows of 2,000-char cells:
  each start position scans up to `min` characters before failing.
- Claim "the model is conservative for every accepted pattern": FALSE. Large fixed or narrow counts (`{n}`,
  `{n,n+15}`, which are not "wide", and with `paths = 1` Rule N never bounds them) give per-cell work ~ len x n with
  m = 0, i.e. never charged. `(a{1000})b` is ~2x slower than `a*b` on the same input and would stay on the main
  thread under the design. The more realistic `(\w{100})x` costs 370 ms with m = 0 — over 3x the e2e 100 ms bound.
  This directly defeats the design's stated goal ("no accepted client regex step blocks the main thread past the
  long-task threshold on long cells") and the spec's "patterns whose work is linear per cell are never charged".
- Fenced wides with large tails (e.g. `([a-z]+)-b{1000}`) yield m ~ 1001: over-charged, safe, but it means "the
  highest-m pattern isBacktrackBounded accepts" (design D1 calibration list) is unbounded / ill-defined.
- declinesInput placement (after `decode`/`declines`/`problems`, before `apply`): corpus outcome order preserved —
  `unsafeRegex` vectors still decline in `declines`, `problems` errors still win. Longest string literal anywhere in
  `shared-test-fixtures/pipeline-step-parity/*.json` is 483 chars; with a budget of ~20 ms / ~0.66 ns ≈ 3e7 units no
  corpus vector can cross it. `clientEvaluable` stays config-only, so parity assertions on it are unaffected. Holds.
- Item 2: `stringops.json:1025-1036` pins `(\d+)\s*items` as `clientDeclines: "unsafeRegex"`; narrowing Rule W would
  change a corpus outcome, which the AC forbids. Reasoning holds.
- `ClientDeclineReason` consumers: only `evaluatePipeline`/`draftStepView` (switch on `status`, not `reason`); a new
  member is not user-visible. Holds.
- CI stability: the decision itself is deterministic (no wall clock). The e2e long-task bound is the same method the
  existing HEL-1683 spec already uses. Acceptable.
- e2e tidy targets exist: stale "~165 ms per cell" at `e2e/hel1683-regex-main-thread.spec.ts:9`, unfiltered overrun
  locator at lines 164/177.

### Verdict: REFUTE

### Change Requests

1. **The cost model misses non-wide work (design D1, spec "multiplier is zero" clause).** Accepted patterns with a
   large fixed or narrow count — `(a{1000})b` (3.8 s), `(.{1000})x` (3.1 s), `(\w{100})x` (370 ms), all with design
   m = 0 — are quadratic-ish (len x n) and would stay on the main thread. Revise the model so every accepted pattern
   is charged for its per-start-position work, e.g. step cost = `sum over cells of len x min(len, P)` where `P`
   bounds per-start work (pattern weight incl. counted atoms, plus `paths x max(1, tail) x len` for wides with a
   tail), or decline at compile time any atom/group with `min`/`max` above a small constant. Whatever the choice, the
   spec requirement text and the "linear patterns are never charged" sentence in proposal.md/design.md must be
   reworded to match.
2. **A wide quantifier with an empty tail is not always linear (design Context line and D1 `m = 0` rule).**
   `(a{1000,})` (tail weight 0, m = 0) costs ~2 s per 1,000 rows of 2,000-char cells built of 999-`a` runs. The model
   must charge a wide atom's `min` (it is mandatory per-start work) — revise the statement "A wide quantifier with
   nothing after it is linear" to its true condition (small `min`), and cover it in the model.
3. **Calibration list must include the counterexample shapes** (`(a{N})b`, `(a{N,})` on run-broken cells,
   `(\w{k})x`) and replace "the highest-m pattern isBacktrackBounded accepts" (unbounded for fenced wides) with a
   concrete, finite list. Add Jest decision tests (task 1.1) asserting `(a{1000})b` and `(a{1000,})` over long cells
   decline with `regexInputCost` — red on the current tree and on a model that sets m = 0 for them.
4. **Define "non-empty tail" unambiguously** (by item presence or by tail weight > 0): `^` and zero-weight items make
   these differ, and an implementer could read it either way.

### Non-blocking notes

- Purely linear cost with a large constant (e.g. `(a{0,7})b` 32 ms at 2,000 chars) is fine today, but a model of
  the form in CR1 handles it for free.
- The measurement scripts reuse one string object for all 1,000 rows; fine for V8 `exec`, but the calibration
  record should say so.
