## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 4f729eed7dd52150f056b6f5a20eac856cb794a7 (planning artifacts are untracked in the change dir).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/client-regex-backtracking-guard/HEL-1683`.
- **Artifacts read:** ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-client-evaluator/spec.md,
  premise-validation.md, and the escalation raised/answered events in the main checkout's
  `.concertino/runs/HEL-1683/events.jsonl`. The answer was `proceed-with-restated-scope` and `answer_source: human`.
- **Current allowlist** (`frontend/src/features/pipelines/evaluator/javaRegex.ts:116-197`): a quantifier is
  allowed only when `last === "atom"` (line 173), so groups are never quantified. That is what D2's shape claim relies on.
- **Match semantics:** `steps/stringOps.ts:76` uses `compiled.regex.exec(...)`, which is an unanchored find. The
  engine therefore retries every start position, so total cost per cell is (start positions) x (per-start cost).
- **Point 1, is Rule W sound per start?** I could not break it. Measured with node 22 on V8 using the translated
  sources, single cell (`scratchpad/sk/p3.mjs`):
  `a*ba*ba*ba*ba*b.*c` on `"ab"xN`, `\d*\.`x4`\d*z`, `.*\n`x4`.*z`, `[^b]*b[^c]*c.*z`. Every one scales
  about quadratically in N across all starts (4x N gave about 15x time), which is linear per start. That is
  what the fence argument predicts. I also considered these cases, and each is declined or harmless under D2 as
  written: lazy fenced quantifiers (the fence still pins a single extent), empty groups (transparent, so the next
  real item is the fence candidate), anchors or `$` between wides (not a character atom, so declined), nullable
  items between wides (`min >= 1` is required, so declined), and alternation with two or more wides (declined
  outright).
- **Point 1, Rule N combined with one wide quantifier: BROKEN in practice.** Rule N lets 64 narrow paths multiply
  the single unfenced wide quantifier, and `exec` multiplies that again by every start position. Measured
  (`scratchpad/sk/p1.mjs`, `p2.mjs`). I ran each twice and the figures reproduced within 2%.
  Times are per 1,000-row draft sample, each cell `"a"x(n-1)+"!"`:

  | pattern (accepted by D2: one wide, no `\|`, paths = 64) | 29 ch | 100 ch | 200 ch | 500 ch |
  | --- | --- | --- | --- | --- |
  | `a*a?a?a?a?a?a?b` | 51 ms | 698 ms | 2,570 ms | 16,854 ms |
  | `a?a?a?a?a?a?a*b` | 31 ms | 378 ms | 1,490 ms | 9,116 ms |
  | `a*b` (baseline, single wide, no narrow) | 0.5 ms | 5.6 ms | 20.7 ms | 131 ms |

  `a{0,15}a{0,3}a*b` and `(a|a)(a|a)(a|a)(a|a)(a|a)(a|a)a*b` time the same as `a?`x6 (single 3,000-char cell:
  268 ms each). These are stacked-choice-point patterns of exactly the class the proposal says it closes. D2
  accepts them, and they block the main thread for seconds on ordinary 100-200-character cells. That violates
  the spec's own scenario "Main thread stays responsive" and AC1. D2's claim "linear per start" is true but is
  the wrong bound, because `exec` runs every start and the 64x constant is the problem. D4 already says every
  corpus client-evaluated pattern has path count <= 4, so the cap of 64 is not needed for the corpus when a
  wide quantifier is present.
- **Point 2, over-decline of the corpus:** No over-decline. I enumerated every `pattern` in
  `shared-test-fixtures/pipeline-step-parity/stringops.json`. Of the patterns accepted today, only
  `([a-z]+)-([a-z]+)` and `(\d+\.\d+)` carry two wides, and both are fenced (`-`, `.`, each disjoint from the
  wide set). Every other accepted pattern has at most one wide quantifier and a path count of at most 4
  (`(cat|dog)s?` = 4, `x(a{2,3})` = 2). `extractRegex` vectors exist only in stringops.json.
  `pipelineStepParity.test.ts:116` asserts `clientEvaluable` is `{ok: true}` for every vector without
  `clientDeclines`, so declining a corpus pattern really would turn the corpus red.
- **Point 3, deviation from the owner's shorthand:** Justified. The literal "more than one unbounded/large
  quantifier" would decline `([a-z]+)-([a-z]+)` and `(\d+\.\d+)`, and the parity test at line 116 would then
  fail unless existing expectations were edited. That edit is the forbidden "fixture change". The criterion was
  the orchestrator's recommendation wording, which the owner accepted as a direction. The owner did not specify
  a formula. The deviation is disclosed in D2 "Rejected" and in Planner Notes, and is carried to the PR body.
  The justification text should be corrected, though (see CR 3): D2 says the AC requires the patterns to "behave
  identically". The Risks section itself says a server-evaluated decline gives identical results. The real
  binding reason is that the corpus asserts client evaluability.
- **Point 4, is the e2e probe red-first-able and non-vacuous?** Not as specified (see CR 2). With the red
  pattern `^(a*a*a*a*a*a*a*a*a*a*)$`, a single 29-char cell takes 10.4 s in V8 (premise-validation.md), and
  D5a uses up to 1,000 such rows. On the unmodified tree the main thread would block for hours. A long task is
  only reported to `PerformanceObserver` after it ends. Task 1.1's "record the longest task (ms)" therefore
  cannot be satisfied, and the red would be a Playwright timeout. A timeout is non-specific: a missing selector
  or a broken fixture fails the same way. The design also asserts that the server returns the time-budget error
  for this pattern. That depends on Java's matcher actually exceeding 2 s on the chosen input, which has not
  been measured. If Java finishes quickly, the green assertion is wrong.

### Verdict: REFUTE

### Change Requests

1. **Bound total work, not per-start paths, when a wide quantifier is present (design D2/D4, spec, tasks 2.2/3.1).**
   Rule N's cap of 64 combined with one wide quantifier accepts `a*a?a?a?a?a?a?b` and `a?a?a?a?a?a?a*b`, which
   block for 0.7-2.6 s per 1,000-row sample of 100-200-char cells (table above). Revise Rule N so the narrow path
   cap is much lower whenever the pattern has any wide quantifier. Size it from measurement against a stated
   cell-length and row budget. The corpus needs at most 4, so a cap such as 4 leaves the corpus untouched. One
   option is a separate constant from the pure-narrow cap, with its own 4/5 boundary test and mutation. Add
   `a*a?a?a?a?a?a?b` and `a?a?a?a?a?a?a*b` (or the revised boundary's equivalents) to the spec's declined
   scenarios and to the Jest cases.
2. **Make the red e2e probe finite and specific (D5a, task 1.1).** Choose the red input so that the unmodified
   tree produces a measured long task that ends, for example between 300 ms and 5 s. Use either few rows of the
   10-char `a*` pattern at reduced length, or `^(.*.*.*.*.*.*.*.*x)` (354 ms per 29-char cell) over a small row
   count. The red must then be an assertion failure that reports the duration, not a timeout. Separately,
   measure on the server, or via the Scala engine or a `PipelineStepParitySpec`-style probe, that the green
   pattern and input actually exceed HEL-1676's 2 s budget before asserting the time-budget step error. If they
   do not, the green assertion should be "the step shows the server result for that step", with the budget
   error proven by a pattern that does exceed it. Keep the control edit, and also assert the benign control's
   step rendered client rows. That proves the edit window actually exercised the client evaluator, so a green
   cannot come from an evaluator that never ran.
3. **Correct the deviation rationale (D2 "Rejected").** Replace "normal patterns the AC requires to behave
   identically" with the actual binding constraint. `pipelineStepParity.test.ts:116` asserts every vector
   without `clientDeclines` is client-evaluable, so declining them would require editing existing corpus
   expectations. Keep the disclosure for the PR body.
4. **State the residual single-wide quadratic cost with numbers (proposal Non-goals, design Non-Goals).**
   Even the baseline `a*b` takes 131 ms per 1,000 rows of 500-char cells, which is already over the 100 ms AC
   for an ordinary pattern. Record the measured figure and file or reference the follow-up ticket, so the PR does
   not imply that AC1 holds for every accepted pattern at every cell length.

### Non-blocking notes

- Make D2 say explicitly that laziness does not change classification. A lazy `*?` is wide and is subject to the
  same fence rule. Also say that an unquantified atom counts as `{1,1}` (a valid fence) and an exact `{n}` is
  not a choice.
- D3 conservatism ("unknown set → not disjoint") is good. Make sure the implementation computes the sets of
  class members `\s`, `\W`, `\D` and `\S`-in-class from the same constants the translator emits (`SPACE_CLASS_BODY`
  includes `\x0B`).
- Evidence for this report: `/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/sk/p1.mjs`,
  `p2.mjs`, `p3.mjs`. These are scratch probes. The numbers are pasted above and reproduced across two runs.
