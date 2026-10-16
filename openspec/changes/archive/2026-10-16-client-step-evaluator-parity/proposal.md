## Why

The live draft preview (HEL-1570, designed by the HEL-1580 spike in `docs/live-draft-preview.md`) recomputes a pipeline in the browser as a step is edited, with zero network requests, within a < 50 ms budget. Owner ruling B (`ts-evaluator-plus-corpus`) chose a hand-written TypeScript evaluator held to the Scala engine by a shared vector corpus. No TypeScript step evaluator exists today, and almost all of it duplicates Scala behaviour that is easy to get subtly wrong (`Math.round(-2.5)` is `-2`, the grammar says `-3`). This change builds that evaluator and the mechanism that keeps it honest. HEL-1628 to HEL-1632 (sample, save, server fallback, draft UI, Output column) build on it.

## What Changes

- A new client-side pipeline evaluator module under `frontend/src/features/pipelines/evaluator/`:
  - per-kind evaluators for the 23 non-server step kinds;
  - a TypeScript port of the strict compute expression grammar;
  - a `clientEvaluable` decision that declines anything outside the ported set rather than approximating it;
  - an incremental pipeline walk that recomputes from an edited step downward with a per-step cache.
- A shared parity corpus, `shared-test-fixtures/pipeline-step-parity/`, made of per-kind vector files, pipeline-level walk vectors, and a 27-kind manifest. It is executed by:
  - a new Scala spec, through the real `PipelineStep.Registry` decode/`evaluate` and the engine's `executeTree` (the oracle);
  - a new Jest spec, through the TypeScript evaluator.
- Manifest agreement checks on both sides (Scala vs `Registry.keySet`; Jest vs the evaluator's kind set and minimum vector counts).
- A recorded latency measurement of the evaluator on the 1,000-row board pipeline.
- **No UI changes**: nothing renders or calls the evaluator yet (HEL-1631/HEL-1632 do). There are no backend runtime changes, endpoints, migrations or persisted behaviour changes: the only backend addition is a test spec.

## Capabilities

### New Capabilities

- `pipeline-client-evaluator`: browser-side evaluation of pipeline steps over in-memory rows, with Scala-engine parity enforced by a shared corpus, explicit decline of unsupported configs, and incremental recompute.

### Modified Capabilities

None.

## Impact

- New code: `frontend/src/features/pipelines/evaluator/**`, `shared-test-fixtures/pipeline-step-parity/**`, and one new backend test spec under `backend/src/test/scala/com/helio/domain/engine/`.
- Reused: `parseChartInstant` (`frontend/src/utils/chartTimeAxis.ts`), and possibly `computeAggregate`/`groupAndAggregate` (`frontend/src/utils/aggregate.ts`) only where the corpus proves them identical.
- No API, schema, migration, environment variable or rate-limit change. HEL-505 guards are untouched.
