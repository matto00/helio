## Why

HEL-1683 declines super-linear client regexes, but a pattern with one unbounded quantifier and a tail (`a*b`) is
still quadratic per cell: 130 ms for 1,000 rows of 500-character cells, 2.1 s at 2,000 characters (measured on the
reference machine, `.concertino/scratch/HEL-1697/measure.mjs`). A draft over long text cells can still freeze the tab.

## What Changes

- The client evaluator declines a stringops `extractRegex` step to the server draft preview when the step's
  predicted quadratic regex work over its actual input frame exceeds a fixed budget (a data-dependent decline with a
  new reason `regexInputCost`). Every accepted pattern is charged for its per-start work (counted atoms, a wide atom's
  `min`) plus a quadratic term for a wide quantifier with a tail; cheap patterns like `(a+)` stay client-side.
- No narrower Rule W (item 2): recorded with measurements in design.md; the parity corpus pins `(\d+)\s*items` as
  declined and must stay unchanged.
- `javaRegex.ts` is split: the class parser moves to its own module (behaviour-preserving).
- `e2e/hel1683-regex-main-thread.spec.ts` tidy: stale timing comment, overrun locator filtered on its pattern, live
  branch asserts the server's empty output cells; a new long-cell single-quantifier long-task probe.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-client-evaluator`: adds a requirement that accepted regex patterns are declined to the server when their
  predicted quadratic work over the input frame exceeds a budget, keeping the main thread responsive on long cells.

## Impact

- Frontend only: `frontend/src/features/pipelines/evaluator/` (`javaRegex.ts`, new class-parser module,
  `javaRegexCost.ts`, `steps/stringOps.ts`, `steps/types.ts`, `evaluateStep.ts`), their unit tests, and
  `e2e/hel1683-regex-main-thread.spec.ts`. No backend, schema, migration or corpus change.

## Non-goals

- A Worker-based time budget (rejected in design.md).
- Server regex time-box changes (HEL-1690).
- A per-walk (rather than per-step) budget.
- Any change to `shared-test-fixtures/pipeline-step-parity/`.
