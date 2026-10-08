## Why

No test exercises the `ApiRoutes` composition that hands the output-history repository to `AlertEvaluationService` (and the alert service + history repo to `PipelineRunService`). Every existing alert/history spec builds its own collaborators by hand, so a future reorder or refactor of `ApiRoutes` that drops the history repo would turn every baseline (`previous` / `rolling_avg`) alert into a silent no-op (one warn log per rule) while every gate stays green. HEL-1278's reviewers flagged this; HEL-1295 and HEL-1356 show the same class of wiring defect recurring.

## What Changes

- Add one backend test spec, `backend/src/test/scala/com/helio/api/ApiRoutesAlertHistoryWiringSpec.scala`, that constructs `ApiRoutes` the way `Main` does for the alert/history collaborators and drives real pipeline runs over the real HTTP route tree.
- It asserts: (a) a `previous` baseline rule produces exactly one alert event across two runs over DIFFERENT data, with the event's `baseline` equal to run 1's value. Because the history write and alert evaluation run concurrently, the spec passes a test-only read-after-write `OutputHistoryRepository` subclass (via the same constructor param Main uses) so run 2's own point is always visible to evaluation; only then does that assertion distinguish exclusion from self-inclusion, and its strength is reported as a measured mutation (M4) red rate; (b) a threshold rule fires; (c) a history row exists for the Output after a run.
- Proven red under three recorded wiring mutations of `ApiRoutes.scala` (each reverted): history repo not passed to `AlertEvaluationService`; alert service not passed to `PipelineRunService`; history repo not passed to `PipelineRunService`. Plus M4, a measured (not assumed) red rate for a broken current-run exclusion in `HistoryBaseline`.
- No production code changes.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — test-only; `skip_specs: true`.)

## Impact

- Test code only: one new spec file under `backend/src/test/scala/com/helio/api/`. Possibly reuse of existing test-support helpers (`OutputHistoryFixtures`, `DatasetRowsTestSupport`); no new shared helper unless needed.
- No API, schema, migration, or frontend impact. Does not touch `OutputService` (contended with HEL-1313).
