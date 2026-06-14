## Why

The Aggregate step's config form lacks inline function hints and per-field validation messages, making
it harder for users to understand what each aggregation function does or why a configuration is
invalid. The backend engine also needs a verified correctness audit with regression tests covering
all function × null/empty/multi-group cases to confirm (or fix) apply/infer parity.

## What Changes

- **UI: Inline function hints** — add a concise hint line below each aggregation row's function
  dropdown (e.g. "Ignores nulls" for sum/avg/min/max; "Counts non-null values" for count).
- **UI: Per-field validation** — add an alias-empty warning per aggregation row (separate from
  the existing field-missing warning); clarify the group-by / aggregation relationship with a
  subtitle below the section heading.
- **UI: Section relationship label** — add a static description explaining that "Group by" fields
  define partition keys while "Aggregations" define computed output columns.
- **Backend: Correctness regression tests** — add `AggregateStepSpec` covering all 5 functions
  × empty input / single-row / multi-group / null values / mixed types.
- **Backend: apply/infer parity fix** — verify `AggregateStep.apply` and
  `PipelineAnalyzeService.inferAggregate` produce consistent output schema for all functions.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `pipeline-aggregate-op`: add UI hint/validation requirements and backend regression-test requirements

## Impact

- `frontend/src/features/pipelines/ui/AggregateConfig.tsx` — add fn hints and alias validation
- `frontend/src/features/pipelines/ui/AggregateConfig.test.tsx` — extend tests
- `backend/src/test/scala/com/helio/domain/AggregateStepSpec.scala` — new spec file

## Non-goals

- Re-architecting the aggregation engine or changing supported function set
- Adding new aggregate functions (stddev, median, etc.)
- Changing the wire config shape
