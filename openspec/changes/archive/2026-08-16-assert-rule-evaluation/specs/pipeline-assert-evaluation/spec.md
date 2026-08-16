## ADDED Requirements

### Requirement: Assert step rules are evaluated against the rows at its position in the pipeline
For each rule in an `assert` step's config, the engine SHALL evaluate the rule against the rows present
at that step's position and produce one `AssertionResult` per rule (`stepId`, `kind`, `field`,
`severity`, `passed`, `observed`, `message`) — not one result per row. `AssertStep.evaluate` SHALL
continue to return the input rows unchanged; evaluation results SHALL be threaded out via the execution
context, never smuggled into row data.

#### Scenario: notNull rule fails when any row has a null in the target field
- **WHEN** a `notNull` rule targeting field `email` is evaluated against rows `[{"email": "a@x.com"},
  {"email": null}]`
- **THEN** the resulting `AssertionResult` has `passed = false`

#### Scenario: notNull rule passes when no row has a null in the target field
- **WHEN** a `notNull` rule targeting field `email` is evaluated against rows `[{"email": "a@x.com"},
  {"email": "b@x.com"}]`
- **THEN** the resulting `AssertionResult` has `passed = true`

#### Scenario: unique rule fails on a duplicate non-null value
- **WHEN** a `unique` rule targeting field `id` is evaluated against rows `[{"id": "1"}, {"id": "1"}]`
- **THEN** the resulting `AssertionResult` has `passed = false`

#### Scenario: unique rule does not fail on multiple nulls
- **WHEN** a `unique` rule targeting field `id` is evaluated against rows `[{"id": null}, {"id": null}]`
- **THEN** the resulting `AssertionResult` has `passed = true`

#### Scenario: range rule fails when a value falls outside the bound
- **WHEN** a `range` rule targeting field `age` with `params: {"min": 0, "max": 120}` is evaluated
  against rows `[{"age": 45}, {"age": 200}]`
- **THEN** the resulting `AssertionResult` has `passed = false`

#### Scenario: rowCountMin rule fails when the row count is below the threshold
- **WHEN** a `rowCountMin` rule with `params: {"count": 5}` is evaluated against 3 rows
- **THEN** the resulting `AssertionResult` has `passed = false`

#### Scenario: rowCountMax rule fails when the row count exceeds the threshold
- **WHEN** a `rowCountMax` rule with `params: {"count": 5}` is evaluated against 10 rows
- **THEN** the resulting `AssertionResult` has `passed = false`

#### Scenario: regex rule fails when a value doesn't match the pattern
- **WHEN** a `regex` rule targeting field `code` with `params: {"pattern": "^[A-Z]{3}$"}` is evaluated
  against rows `[{"code": "ABC"}, {"code": "ab"}]`
- **THEN** the resulting `AssertionResult` has `passed = false`

#### Scenario: regex rule fails gracefully on a null or absent field, without throwing
- **WHEN** a `regex` rule targeting field `code` with `params: {"pattern": "^[A-Z]{3}$"}` is evaluated
  against rows `[{"code": null}, {}]` (one row with a null `code`, one row missing `code` entirely)
- **THEN** evaluation completes without throwing and the resulting `AssertionResult` has
  `passed = false`

### Requirement: Assertion results are persisted per run, linked to the run they were evaluated in
The system SHALL persist every `AssertionResult` evaluated during a run in `pipeline_run_assertions`,
linked via `run_id` to the corresponding `pipeline_runs` row, whenever a pipeline containing one or more
`assert` steps completes a run that has a `pipeline_runs` row to link to — a successful real run, a
failed real run, or a successful dry run. Results evaluated before a mid-pipeline failure SHALL still be
persisted, not discarded, when a real run ultimately fails. A FAILED dry run SHALL NOT attempt to
persist assertion results, since a dry run's `pipeline_runs` row is created only on success and no
parent row exists yet for a failed one to link to.

#### Scenario: Assertion results persist after a successful run
- **WHEN** a pipeline containing an `assert` step with one `notNull` rule completes a successful run
- **THEN** a `pipeline_run_assertions` row exists for that rule, linked to the run's `pipeline_runs.id`

#### Scenario: Partial assertion results persist after a failed real run
- **WHEN** a pipeline runs an `assert` step (which evaluates and would record results) followed by a
  step that then fails execution, and the run is not a dry run
- **THEN** the assert step's `AssertionResult`s are still persisted, linked to the (failed) run

#### Scenario: Assertion results persist after a successful dry run
- **WHEN** a dry-run pipeline containing an `assert` step with one rule completes successfully
- **THEN** a `pipeline_run_assertions` row exists for that rule, linked to the dry run's
  `pipeline_runs.id`

#### Scenario: A failed dry run does not attempt to persist assertion results
- **WHEN** a dry-run pipeline runs an `assert` step (which evaluates and would record results) followed
  by a step that then fails execution
- **THEN** no `insertAssertions` call is attempted and no error is raised — the run fails with the same
  `ServiceError` it would have produced before this ticket

### Requirement: Persisting assertion results never turns a silent no-op run into an unhandled failure
The `insertAssertions` call SHALL NOT raise or propagate a failure when
`PipelineRunRepository.insertRun`/`insertDryRun` has already silently no-op'd (the existing, tested
behavior for a caller who does not own the parent pipeline — e.g. an editor grantee triggering a run via
`POST /api/pipelines/:id/run`, per `PipelineRunRepositorySpec.scala`'s CS2 tests), even though no
`pipeline_runs` row exists for it to reference — the run SHALL resolve with the same response shape it
would have produced before this ticket, real or dry.

#### Scenario: Editor-grantee-triggered real run resolves normally despite no persisted run row
- **WHEN** an editor grantee (not the pipeline owner) triggers a real run on a pipeline containing an
  `assert` step, via the ordinary run-submission path
- **THEN** the run resolves normally (the same response the caller would have received before this
  ticket) and no unhandled failure is raised by the new assertion-persistence path

#### Scenario: Editor-grantee-triggered dry run resolves normally despite no persisted run row
- **WHEN** an editor grantee (not the pipeline owner) triggers a dry run on a pipeline containing an
  `assert` step, via the ordinary run-submission path
- **THEN** the dry run resolves normally (the same response the caller would have received before this
  ticket) and no unhandled failure is raised by the new assertion-persistence path

### Requirement: Assertion results are readable per run via a repository method, RLS-safe for owner and grantees
`PipelineRunRepository` SHALL expose a method to list `pipeline_run_assertions` rows for a given run,
gated by the same ownership rule as `pipeline_runs` itself (indirect via the parent pipeline's
`owner_id`), plus a system-context variant usable by a caller that has already confirmed sharing access
(owner or grantee) at the service layer — mirroring `listByPipeline`/`listByPipelineInternal`'s existing
split for `pipeline_runs`.

#### Scenario: Owner can list assertion results for their own run
- **WHEN** the owning user calls the owner-scoped list method for a run containing assertion results
- **THEN** the persisted `AssertionResult` rows are returned

#### Scenario: Non-owner cannot list assertion results via the owner-scoped method
- **WHEN** a different user calls the owner-scoped list method for a run they do not own
- **THEN** no rows are returned

### Requirement: PipelineStep.evaluate's row-in/row-out contract is unbroken by assertion evaluation
`AssertStep.evaluate` SHALL return exactly the rows it received, unmodified, regardless of how many
rules it evaluates or how many fail. Evaluation results SHALL be surfaced solely through the execution
context (`PipelineExecutionContext`), never by adding, removing, or renaming fields on the returned rows.

#### Scenario: Assert step output rows are identical to its input rows
- **WHEN** an assert step with a failing `notNull` rule evaluates a set of input rows
- **THEN** the returned rows are structurally identical to the input rows (same fields, same values, no
  added assertion metadata)
