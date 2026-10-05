## ADDED Requirements

### Requirement: History-baseline conditions
A rule whose `condition` carries a `baseline` key SHALL be evaluated against the Output's snapshot history instead
of against the bare threshold. `baseline = "previous"` uses the single newest history point; `baseline =
"rolling_avg"` uses the arithmetic mean of the `n` newest history points. The breach test SHALL be
`comparator(delta, threshold)`, where `delta = current - baseline` when `mode = "abs"` and
`delta = (current - baseline) / |baseline| * 100` when `mode = "pct"`. A rule without a `baseline` key SHALL be
evaluated exactly as before (threshold against the extracted metric).

#### Scenario: Previous-run breach and resolve
- **WHEN** a rule has `metric = "amount"`, `condition = { baseline: "previous", mode: "abs", comparator: "gt",
  threshold: 10 }`, the newest prior history point's `amount` total is `100`, and the current run's total is `120`
- **THEN** the rule breaches and a firing event is created; a later run whose total is `125` against its own
  previous point `120` (delta 5) resolves that event

#### Scenario: Rolling-average breach and resolve
- **WHEN** a rule has `condition = { baseline: "rolling_avg", n: 3, mode: "pct", comparator: "lt", threshold: -20 }`,
  the three newest prior points' totals are `100`, `110` and `90`, and the current total is `70`
- **THEN** the rule breaches (−30%)
- **WHEN** the next run's total is `95` and its prior history is now the breaching run's `70` plus `100` and `110`
  (mean ≈ 93.3)
- **THEN** the delta is ≈ +1.8%, the rule does not breach, and the active event resolves

### Requirement: Baseline excludes the triggering run
The baseline SHALL be computed only from history points whose run id differs from the triggering run's id, so a
history point written for the current run (which may or may not be committed when evaluation starts) never
contributes to its own baseline. When no triggering run id is supplied, baseline rules SHALL be skipped.

#### Scenario: Current run's own history point is ignored
- **WHEN** the history already contains a point for the triggering run alongside older points
- **THEN** `previous` resolves to the newest OLDER point and `rolling_avg` averages the `n` newest older points

### Requirement: Comparable current and baseline values
For a baseline rule, the current value and every baseline point's value SHALL be computed by the same history
summary semantics: `metric = "*"` is the row count; any other metric is the summary's column sum for that column,
which coerces numeric strings and is defined only for columns whose every non-blank cell is numeric (within the
summary's column cap). Plain threshold rules SHALL keep their existing extraction semantics unchanged.

#### Scenario: Numeric strings compare consistently
- **WHEN** a baseline rule's column holds numeric strings (e.g. an un-cast CSV column) in both the current rows and
  the history
- **THEN** both values are the coerced column sums and the rule is evaluated

### Requirement: Insufficient baseline never breaches
A baseline rule SHALL be skipped (no breach and no auto-resolve) when there is no eligible prior point, when
`rolling_avg` has fewer than `n` eligible points, when any selected point or the current run has no value for the
metric, or when `mode = "pct"` and the baseline is `0`.

#### Scenario: Empty history
- **WHEN** a baseline rule's Output has no history other than (possibly) the triggering run's own point
- **THEN** no event is created, updated or resolved for that rule

### Requirement: Baseline breach event value
A firing event for a baseline rule SHALL record `value` as an object `{ value, baseline, delta, mode }` holding the
current value, the baseline, the compared delta and the mode.

#### Scenario: Event value carries the comparison
- **WHEN** a `previous`/`abs` rule breaches with current `120` and baseline `100`
- **THEN** the event's `value` is `{ "value": 120, "baseline": 100, "delta": 20, "mode": "abs" }`

## MODIFIED Requirements

### Requirement: Single evaluation entry point
The system SHALL expose `AlertEvaluationService.evaluateForOutput(outputId: OutputId,
rows: Seq[PipelineRowJson.Row], triggeringRunId: Option[String]): Future[Unit]` as the sole
entry point for evaluating alert rules against freshly-produced rows for an `OutputId`, callable
identically from a pipeline-run-completion hook (invoked for every Output of every materialized
node) and a future scheduled-run trigger.

#### Scenario: Entry point requires no pipeline-run context
- **WHEN** `evaluateForOutput` is called with `triggeringRunId = None`
- **THEN** evaluation of rules without a `baseline` condition proceeds normally, and any `AlertEvent`
  created or updated has `pipelineRunId = None`; rules with a `baseline` condition are skipped (see
  "Baseline excludes the triggering run")

### Requirement: Metric extraction — scalar, aggregate, and count sentinel
For a rule whose `condition` carries no `baseline` key (baseline rules use "Comparable current and baseline
values" instead), given the rule's `metric` and the row set passed to `evaluateForOutput`, the system SHALL resolve
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
For a rule whose `condition` carries no `baseline` key, the system SHALL evaluate its condition as a threshold
comparison between the extracted metric value and the `condition.threshold` value using the `condition.comparator`
(`gt|gte|lt|lte|eq|neq`), where a rule breaches when the comparison is true.

#### Scenario: Comparator matrix
- **WHEN** a rule's extracted value is `10` and `condition = { comparator: <c>, threshold: 10 }`
- **THEN** the rule breaches for `c = gte`, `c = eq`, and `c = lte` (all true at equality), and
  does not breach for `c = gt`, `c = lt`, or `c = neq`

#### Scenario: Baseline rules compare the delta
- **WHEN** a rule's `condition` carries a `baseline` key
- **THEN** the same comparator matrix is applied to the delta defined in "History-baseline conditions", not to
  the raw value

### Requirement: Breach drives a firing event
When a rule breaches, the system SHALL call `AlertEventRepository.upsertFiringInternal` with the
rule's `id`, `ownerId`, `targetOutputId`, the extracted value (as a `JsNumber` for a rule without a `baseline`
condition; as the object defined in "Baseline breach event value" for a baseline rule), the
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
`AlertEventRepository.resolveInternal` whenever the rule produced a comparison and that comparison does not breach: for a rule without a `baseline`
condition, its metric was successfully extracted (not skipped per the zero-rows scenario above); for a baseline
rule, both the current value and the baseline were resolved (not skipped per "Insufficient baseline never
breaches").

#### Scenario: Clear transitions firing to resolved
- **WHEN** a rule has an active `firing` `AlertEvent` and the current evaluation does not breach
- **THEN** that event transitions to `resolved`

#### Scenario: No active event, no breach — no-op
- **WHEN** a rule does not breach and has no active `AlertEvent`
- **THEN** no `AlertEvent` is created, updated, or resolved

#### Scenario: Insufficient baseline leaves an active baseline event firing
- **WHEN** a baseline rule has an active `firing` `AlertEvent` and the current evaluation is skipped because the
  baseline cannot be resolved
- **THEN** that event stays `firing` — it is neither refreshed nor resolved
