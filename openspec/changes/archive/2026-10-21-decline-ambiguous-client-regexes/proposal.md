## Why

The client draft evaluator runs user `extractRegex` patterns synchronously on the browser main thread on every
draft edit. Its allowlist already refuses quantified groups (the ticket's `^(.*a){12}$`), but it still accepts
patterns built from several stacked choice points on plain atoms, e.g. `^(a*a*a*a*a*a*a*a*a*a*)$`, which V8
backtracks for 10-29 s on one 29-character cell. Draft mode (HEL-1631) is live in prod, so one typed pattern can
freeze the tab. The owner ruled (escalation `HEL-1683-1792567280436-a23bee`) to fix it at the allowlist.

## What Changes

- The client regex allowlist additionally declines, as `unsafeRegex`, any pattern whose structure permits
  super-linear backtracking per start position: two or more wide (unbounded or large-range) quantifiers unless all
  but the last are fenced by a disjoint mandatory atom, any wide quantifier pair combined with alternation, and a
  product of narrow choice points (alternation branches, `?`, small ranges) above a fixed cap.
- A declined step is evaluated by the server draft preview, which already applies HEL-1676's 2 s per-step budget,
  so an overrun surfaces as the same step error a real run produces.
- Every pattern the parity corpus currently evaluates client-side stays client-evaluated with identical results.
- New red-first e2e long-task probe: a catastrophic pattern in a draft blocks the main thread for no more than 100 ms.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-client-evaluator`: adds the requirement that backtracking-prone regex patterns are declined to the
  server so client evaluation never blocks the main thread on them.

## Impact

- `frontend/src/features/pipelines/evaluator/javaRegex.ts` (+ its Jest test), the shared parity corpus
  `shared-test-fixtures/pipeline-step-parity/stringops.json` (new decline vectors only), one new e2e spec.
- No backend code, API, schema, or migration change. No Web Worker.

## Non-goals

- A single wide quantifier on a very long cell (quadratic scanning) is not addressed: `a*b` measures 131 ms per
  1,000 rows of 500-char cells in V8. It is a follow-up candidate, not claimed fixed.
- No change to the server time box (HEL-1676) or its per-walk ceiling (HEL-1690).
- No Web Worker or asynchronous client evaluation; `usePipelineDraftFrames.ts` (touched by parked HEL-1632) is
  not modified.
