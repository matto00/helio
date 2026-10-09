## Why

HEL-1310's follow-up review found four small defects in the aggregate step (HEL-1407): the editor matches function
names case-sensitively although analyze/apply lowercase them; the percentile `p` input's error is not programmatically
linked and the input loses its only label once filled; analyze types `min`/`max` as the source field's declared type
while apply always returns a floating-point number (or null); and the schema-diff chips emit duplicate React keys when
several aggregations share an empty alias. All four are confirmed on origin/main (e7470bc6).

## What Changes

- Aggregate editor normalizes the stored function name case-insensitively for the picker value, the hint and the `p`
  input (no config rewrite on load; the next edit of the row's function writes the lowercase name).
- The `p` input gets a persistent visible label and, when invalid, `aria-invalid="true"` plus `aria-describedby` linked
  to its error, following the `FormField` (`errorId`) / `FormFieldRow` precedent (DESIGN.md has no dedicated
  form-error section).
- Aggregate-op analyze types `min`/`max` results as `float`, matching the `Double`-or-null value apply already produces.
  Row values do not change. The `groupby` op is untouched (its Spark path preserves column type).
- Schema-diff chip keys are unique even when field names repeat (e.g. several empty aliases).

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-aggregate-op`: min/max inference becomes `float`; parity proven against non-float declared fields; editor
  matches function names case-insensitively; `p` input accessibility.
- `pipeline-step-schema-diff`: chips render without duplicate keys when diff entries share a name.

## Impact

- Backend: `PipelineAnalyzeService` (aggregate inference only), `PipelineAnalyzeServiceSpec` parity test.
- Frontend: `AggregateConfig.tsx` (+ test), `StepSchemaDiffChips.tsx` (+ test), possibly a small CSS addition.
- Downstream steps/Outputs now see `float` instead of the declared type for aggregate min/max columns. No API shape,
  schema, or migration change.

## Non-goals

- Changing apply to preserve the source type for min/max (would change stored row values and needs new semantics for
  string/date fields — a product call, not this ticket).
- Changing the `groupby` op, pivot, or shape aggregations.
- Rewriting stored configs to lowercase function names.
