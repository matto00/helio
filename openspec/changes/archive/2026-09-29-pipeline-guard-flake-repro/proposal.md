## Why

`PipelineRunGuardIntegrationSpec` failed once (4882/4883) in HEL-1188's local full-suite gate,
one day after HEL-1184's settlement-latch fix for this exact spec. The failing test name and
assertion were never recorded and can't be recovered. Three hypotheses are live with very
different consequences (guard defect vs. test-reliability defect vs. a different, unexamined
test) and none is established. Systematic-debugging requires probe-confirming which, under the
same full-suite-load conditions the original failure occurred in, before any fix.

## What Changes

- Reproduce the failure under full-suite load (not isolation), capturing test name + assertion
  message + surefire XML for every failure, at least once — bounded, stated investigation budget.
- Identify which of hypothesis 1 (guard under-serialization, `4 != 3`), 2 (latch timeout under
  load), or 3 (a different test in the spec) actually occurred.
- Ship a probe-confirmed, red-before/green-after fix for whichever is confirmed (test-only if H1
  is refuted and H2/H3 confirmed; escalate before any production-guard change if H1 is confirmed).
- Add a guardrail (e.g. `withClue` context) so a future failure in this spec is self-describing.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — see Non-goals; `skip_specs: true` set in `.openspec.yaml`)

## Impact

- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunGuardIntegrationSpec.scala`
  (test-only, expected).
- Possibly `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepository.scala`
  (`insertRunIfUnderConcurrencyCap`) — ONLY if hypothesis 1 is probe-confirmed, and only after an
  explicit escalation per the ticket's standing constraint.
- No migration (V112 remains free/unused).

## Non-goals

- Re-opening HEL-505's rate-limit, dry-run-exclusion, or trigger-source design decisions.
- Adding retries, sleeps, or a loosened assertion anywhere.
- Fixing HEL-924's forked-JVM-group contention mitigation itself (out of scope; may be relevant
  context for why a full-suite repro is/isn't contention-heavy, not a target for change).
- A cross-owner concurrency change (guard lock is intentionally per-owner, HEL-505 design.md
  Decision 3) — out of scope unless the probe implicates it directly.
