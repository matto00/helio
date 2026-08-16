## Why

419-A (HEL-454) landed the `assert` step as an identity pass-through with a rule model but no
evaluation — rules are decorative. This ticket (419-B) makes them mean something: evaluate every
`assert` step's rules against the rows flowing through it on each run, and persist the pass/fail
outcome per run, so a run's trustworthiness is inspectable after the fact.

## What Changes

- `AssertionResult(stepId, kind, field, severity, passed, observed, message)` — one result per rule,
  aggregated across the row set at the assert step's position (not per-row).
- Rule evaluation for all six v1 kinds (`notNull`, `unique`, `range`, `rowCountMin`, `rowCountMax`,
  `regex`), implemented inside `AssertStep` itself (kept in the per-step-file module, matching the
  established ADT pattern) and recorded via a new caller-supplied `AssertionSink` threaded through
  `PipelineExecutionContext` — `AssertStep.evaluate`'s row-in/row-out contract is untouched; nothing is
  smuggled into row data.
- `InProcessPipelineEngine.executeWithStepCounts` gains an optional `AssertionSink` parameter (default:
  a fresh, discarded sink) so existing callers (`previewStep`, `execute`) are unaffected.
- New Flyway migration: `pipeline_run_assertions` (FK `run_id → pipeline_runs(id) ON DELETE CASCADE`),
  with RLS mirroring `pipeline_runs`' own indirect-owner policy one level deeper.
- `PipelineRunRepository.insertAssertions` / `listAssertionsByRun` (+ an `Internal` system-context
  variant for grantee reads, matching `listByPipeline`/`listByPipelineInternal`'s existing split).
- `PipelineRunService.executeRun` persists assertion results as part of run completion — for both a
  successful run and a failed run (whatever was evaluated before the failure), and for dry runs too
  (they already get a `pipeline_runs` row via the existing dry-run path).
- No blocking behavior, no API route, no UI surfacing — fail policy (419-C), Run History UI (419-D),
  and MCP surface (419-F) are separate tickets.

## Capabilities

### New Capabilities

- `pipeline-assert-evaluation`: rule evaluation for the six v1 assertion kinds and per-run persistence
  of the results.

### Modified Capabilities

(none — `pipeline-assert-op` (HEL-454) explicitly deferred rule evaluation to this ticket; this adds a
new capability rather than modifying that one's requirements)

## Impact

- Backend only: `domain/AssertionResult.scala` (new — `AssertionResult` + `AssertionSink`),
  `domain/PipelineStep.scala` (`PipelineExecutionContext` gains `assertionSink`),
  `domain/steps/AssertStep.scala` (rule evaluation logic + `ctx.assertionSink.record(...)` call),
  `domain/InProcessPipelineEngine.scala` (`executeWithStepCounts`'s new optional parameter),
  `infrastructure/PipelineRunRepository.scala` (new table + methods),
  `services/PipelineRunService.scala` (`executeRun` wiring), one new Flyway migration.
- No frontend changes, no new API route, no protocol/wire-format changes (acceptance criterion 3 asks
  for a repository method, not an HTTP endpoint).

## Non-goals

- Blocking a run or skipping the DataType update on a failed assertion (419-C).
- Surfacing results in the Run History UI or on panels (419-D).
- `add_pipeline_step`/assertion-results MCP tool wiring (419-F).
- `referential` cross-DataType assertions (future, not in the v1 rule set — HEL-454's own non-goal,
  unchanged here).
