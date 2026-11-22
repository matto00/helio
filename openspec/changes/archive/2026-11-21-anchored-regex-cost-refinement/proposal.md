## Why

HEL-1697's `regexInputCost` model charges every accepted pattern as if a match attempt could start at every position
of a cell. V8 tries a pattern whose every alternative is led by `^` (no multiline) at position 0 only, so `^(.*)$`
costs one attempt per cell, yet it is declined to the server draft preview from about 45 characters per cell at
1,000 rows, the same point as `(.*)x`. Drafts that use anchored patterns pay a server round trip for nothing.

## What Changes

- Measure, on the reference machine with HEL-1697's method, the cost of `^`-anchored patterns: every HEL-1697
  calibration shape in anchored form, `^(.*)$`, grouped anchors (`(^a*)b`), all-anchored alternations, partly
  anchored alternations (`^a*b|c`), and multiline mode (JS `m` flag). Commit the calibration tables and the script.
- Where the measurements support it, charge a fully start-anchored pattern for one attempt per cell (the run that
  starts at position 0) instead of one attempt per position. Partly anchored patterns keep today's charge.
- `REGEX_WORK_BUDGET` (4.00e6) is unchanged; every HEL-1697 adversarial shape keeps today's charge and decision.
- A Jest test, red first: `^(.*)$` over 1,000 rows of 500-character cells is evaluated client-side.
- An e2e case in `e2e/hel1683-regex-main-thread.spec.ts`: an anchored pattern over long cells is client-evaluated
  (no draft-preview request) with no main-thread task over 100 ms.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-client-evaluator`: the "declined on input too long for the main thread" requirement gains a
  start-anchor charge for fully `^`-anchored patterns.

## Impact

Frontend only: `frontend/src/features/pipelines/evaluator/` (`javaRegexCost.ts`, `regexInputCost.ts` and their
tests) and `e2e/hel1683-regex-main-thread.spec.ts`. No backend, schema, migration or parity-corpus change.

## Non-goals

- Multiline mode client-side (inline flags stay declined as `unsafeRegex`), `$`-anchor (end) refinement, raising or
  re-deriving `REGEX_WORK_BUDGET`, Worker evaluation, server changes.
