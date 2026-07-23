## ADDED Requirements

### Requirement: Single evaluation entry point
The system SHALL expose `AlertEvaluationService.evaluateForDataType(dataTypeId: DataTypeId,
rows: Seq[PipelineRowJson.Row], triggeringRunId: Option[String]): Future[Unit]` as the sole
entry point for evaluating alert rules against freshly-produced rows for a `DataTypeId`, callable
identically from a pipeline-run-completion hook and a future scheduled-run trigger.

#### Scenario: Entry point requires no pipeline-run context
- **WHEN** `evaluateForDataType` is called with `triggeringRunId = None`
- **THEN** evaluation proceeds normally, and any `AlertEvent` created or updated has
  `pipelineRunId = None`

### Requirement: Load enabled rules for the target DataType
`evaluateForDataType` SHALL load every enabled `AlertRule` targeting `dataTypeId` via
`AlertRuleRepository.listEnabledByDataTypeInternal`, evaluating none if no enabled rule targets
that `DataTypeId`.

#### Scenario: No enabled rules
- **WHEN** `evaluateForDataType` is called for a `DataTypeId` with no enabled `AlertRule`
- **THEN** no `AlertEvent` is created, updated, or resolved, and the returned `Future` succeeds

#### Scenario: Disabled rule is skipped
- **WHEN** an `AlertRule` targeting `dataTypeId` exists with `enabled = false`
- **THEN** that rule is not evaluated, regardless of whether its condition would breach

### Requirement: Metric extraction — scalar, aggregate, and count sentinel
Given a rule's `metric` and the row set passed to `evaluateForDataType`, the system SHALL resolve
a numeric evaluation value as follows: `metric == "*"` yields the row count regardless of row
count (including zero); a single row (`rows.size == 1`) yields the scalar numeric value of that
row's `metric` field, coerced via a numeric-coercion policy consistent with `inferFieldType`
(`PipelineRunService`) — only genuinely numeric-typed values (`Int`/`Long`/`Float`/`Double`/
`BigDecimal`) coerce; `String` values are never coerced, even when numeric-looking (e.g. `"42"`),
matching `inferFieldType`'s classification of every `String` as `"string"`, never `"integer"`/
`"double"`. More than one row yields the sum of that same coercion applied across the column,
skipping rows where the field is absent, non-numeric-typed, or otherwise uncoercible. Zero rows
with a `metric` other than `"*"` yields no value — see the "Zero rows, non-count metric" scenario
below.

#### Scenario: Count sentinel with zero rows
- **WHEN** a rule has `metric = "*"` and `rows` is empty
- **THEN** the extracted value is `0`

#### Scenario: Count sentinel with multiple rows
- **WHEN** a rule has `metric = "*"` and `rows` has 7 entries
- **THEN** the extracted value is `7`

#### Scenario: Single-row scalar extraction
- **WHEN** a rule has `metric = "errorCount"` and `rows` has exactly one row with
  `errorCount = 12` (an `Int`)
- **THEN** the extracted value is `12`

#### Scenario: Single-row scalar extraction skips a numeric-looking string, not coerced
- **WHEN** a rule has `metric = "errorCount"` and `rows` has exactly one row with
  `errorCount = "12"` (a `String`, e.g. an un-cast CSV column)
- **THEN** no value is extracted and the rule is skipped for this evaluation (no breach, no
  auto-resolve) — `"12"` is never parsed to `12`, consistent with `inferFieldType` classifying
  every `String` as `"string"`, never numeric

#### Scenario: Column-aggregate extraction sums numeric-typed values, skipping non-numeric-typed
- **WHEN** a rule has `metric = "amount"` and `rows` has multiple rows with `amount` values
  `10` (`Int`), `"n/a"` (`String`), and `5` (`Int`)
- **THEN** the extracted value is `15` (the non-numeric-typed row is skipped, not treated as `0`)

#### Scenario: Column-aggregate extraction skips a numeric-looking string in one row
- **WHEN** a rule has `metric = "amount"` and `rows` has multiple rows with `amount` values
  `10` (`Int`), `"20"` (`String`, numeric-looking), and `5` (`Int`)
- **THEN** the extracted value is `15` — the `"20"` string row is skipped entirely (not coerced
  to `20` and not treated as `0`), consistent with the single-row scalar case above

#### Scenario: Zero rows, non-count metric
- **WHEN** a rule has `metric = "errorCount"` (not `"*"`) and `rows` is empty
- **THEN** the rule is skipped for this evaluation — no breach and no auto-resolve occur for it

### Requirement: Threshold comparator evaluation
The system SHALL evaluate a rule's condition as a threshold comparison between the extracted
metric value and the `condition.threshold` value using the `condition.comparator`
(`gt|gte|lt|lte|eq|neq`), where a rule breaches when the comparison is true.

#### Scenario: Comparator matrix
- **WHEN** a rule's extracted value is `10` and `condition = { comparator: <c>, threshold: 10 }`
- **THEN** the rule breaches for `c = gte`, `c = eq`, and `c = lte` (all true at equality), and
  does not breach for `c = gt`, `c = lt`, or `c = neq`

### Requirement: Breach drives a firing event
When a rule breaches, the system SHALL call `AlertEventRepository.upsertFiringInternal` with the
rule's `id`, `ownerId`, `targetDataTypeId`, the extracted value (as a `JsNumber`), the
`triggeringRunId`, and the rule's `severity`.

#### Scenario: First breach creates a firing event
- **WHEN** a rule breaches and has no existing active `AlertEvent`
- **THEN** exactly one new `AlertEvent` is created in state `firing`

#### Scenario: Repeated breach refreshes the existing event, no duplicate
- **WHEN** a rule breaches on two consecutive evaluations without an intervening resolve
- **THEN** exactly one active `AlertEvent` exists for that rule after both evaluations (the
  HEL-455 dedup contract), with `lastEvaluatedAt` refreshed

### Requirement: Clearing the condition auto-resolves the active event
The system SHALL resolve a rule's active (non-resolved) `AlertEvent` via
`AlertEventRepository.resolveInternal` whenever the rule's metric was successfully extracted (not
skipped per the zero-rows scenario above) and the current evaluation does not breach.

#### Scenario: Clear transitions firing to resolved
- **WHEN** a rule has an active `firing` `AlertEvent` and the current evaluation does not breach
- **THEN** that event transitions to `resolved`

#### Scenario: No active event, no breach — no-op
- **WHEN** a rule does not breach and has no active `AlertEvent`
- **THEN** no `AlertEvent` is created, updated, or resolved

### Requirement: Evaluation never fails the triggering pipeline run
A run that fails before reaching the row-write step SHALL produce no evaluation and no
`AlertEvent` changes. Once invoked, an exception raised while evaluating one rule, or while
evaluating rules for a `DataTypeId` overall, SHALL be logged and SHALL NOT propagate to the
caller in a way that fails or rolls back the triggering pipeline run.

#### Scenario: A failed pipeline run creates no events
- **WHEN** a pipeline run fails before `onRunSuccess` is reached
- **THEN** `evaluateForDataType` is never invoked and no `AlertEvent` is created

#### Scenario: One rule's evaluation error does not block sibling rules
- **WHEN** evaluating two enabled rules for the same `DataTypeId`, and the first rule's
  `condition` is malformed (missing `comparator`/`threshold`) causing an exception
- **THEN** the first rule's failure is logged and the second rule is still evaluated normally

#### Scenario: Evaluation failure does not fail the pipeline run
- **WHEN** `evaluateForDataType` raises an exception (e.g. an unexpected repository failure)
- **THEN** `PipelineRunService.onRunSuccess`'s returned `Future` still succeeds and the pipeline
  run is recorded as `succeeded`

### Requirement: Fired/resolved events are logged for future delivery consumption
For every event created, refreshed, or resolved by this engine, the system SHALL emit a
structured log line identifying the rule, event, resulting state, severity, target DataType, and
triggering run (if any).

#### Scenario: Firing emits a log line
- **WHEN** a rule breaches and an `AlertEvent` is created or refreshed
- **THEN** a log line identifying that rule/event/state is emitted

#### Scenario: Resolving emits a log line
- **WHEN** an active `AlertEvent` is auto-resolved
- **THEN** a log line identifying that rule/event/resolved-state is emitted
