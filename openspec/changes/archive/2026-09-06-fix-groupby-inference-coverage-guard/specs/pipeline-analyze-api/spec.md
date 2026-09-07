## ADDED Requirements

### Requirement: Analyze projects a real output schema for a groupby step

`GET /api/pipelines/:id/analyze` MUST NOT report a `validationError` for a `groupby`
step whose config is valid, and MUST project that step's real output schema rather than
an identity passthrough of its input.

The projected schema is the step's `groupBy` key fields, in config order, followed by a
single aggregate column named `<aggFunction>_<aggColumn>` — matching what
`GroupByStep.apply` emits at run time. `GroupByConfig` carries no alias field, so no
caller-supplied alias participates.

The aggregate column's type is determined by the aggregation FUNCTION, not by the input
column's type: `count` yields `integer` and `sum` yields `float`, even when the input
column is of some other type. Group-key field types are resolved from the step's input
schema by field name.

#### Scenario: valid groupby reports no validationError

- **WHEN** a pipeline containing a `groupby` step with a valid config is analyzed
- **THEN** that step's `validationError` is absent

#### Scenario: groupby projects group keys plus the aggregate column

- **WHEN** a `groupby` step groups by `order_id` and applies `sum` to a `float` column `amount`
- **THEN** its `outputSchema` is `order_id` (typed from the input schema) followed by `sum_amount` typed `float`

#### Scenario: the aggregate column's type follows the function, not the input column

- **WHEN** a `groupby` step applies `count` to a `float` column `amount`
- **THEN** the projected `count_amount` column is typed `integer`, not `float`

#### Scenario: a group-key field absent from the input schema degrades best-effort

- **WHEN** a `groupby` step names a `groupBy` column that is not present in its input schema
- **THEN** that step's `validationError` is absent and the key field is projected using the documented best-effort fallback type

### Requirement: Analyze never reports Unknown op for a registered step kind

`PipelineAnalyzeService.inferOutputSchema` MUST have a dispatch branch for every kind
registered in `PipelineStep.Registry`. No kind present in the registry may fall through
to the `Unknown op` fallback arm, which is reserved for genuinely unregistered ops.

This invariant MUST be enforced by an automated guard whose expected set is derived from
`PipelineStep.Registry` itself and whose actual coverage is established by invoking
`inferOutputSchema` DIRECTLY for each kind — not by comparing against a second
hand-maintained list, which would only assert that two lists agree with each other, and
not by routing the probe through the `analyze` entry points, which short-circuit on
`validateStepConfig` and never reach inference when a config is rejected. A probe that
validation intercepts establishes nothing and MUST NOT count as coverage. When the guard
fails it MUST name the specific uncovered kind. Any kind legitimately exempt MUST be
exempted by explicit name with a stated reason, never by a pattern match that could
silently absorb a future kind.

#### Scenario: every registered kind has an inference branch

- **WHEN** the coverage guard invokes `inferOutputSchema` directly for every kind in `PipelineStep.Registry`, with a fully valid config per kind
- **THEN** no invocation reports any validationError at all, so no kind can be certified as covered by a probe that validation intercepted before inference ran

#### Scenario: a newly registered kind without an inference branch is caught by name

- **WHEN** a kind is added to `PipelineStep.Registry` with no corresponding `inferOutputSchema` branch
- **THEN** the coverage guard fails and its message names that specific kind
