- `backend/src/main/scala/com/helio/domain/steps/DateBucketStep.scala` — added the two new tz-less
  `LocalDateTime` parsing branches (T-separated `ISO_LOCAL_DATE_TIME` and a
  `DateTimeFormatterBuilder`-built space-separated formatter with a variable-length 0–9 digit
  fractional-seconds component) to `parseToUtcDate`; added the zero-parse-rate execution-failure
  guard to `evaluate` (fails via `Future.failed(new IllegalArgumentException(...))` when input rows
  have a non-blank field value but zero rows bucket to a non-null output); updated the Scaladoc.
- `backend/src/test/scala/com/helio/domain/steps/DateBucketStepSpec.scala` — new spec: direct unit
  tests for every accepted timezone-less shape (T-separated, space-separated, 0/1/3/6-digit
  fractional seconds, the ticket's own two-month repro) asserting actual bucketed date values, plus
  the zero-parse-rate guard's fail/no-fail cases (all-unparseable single-row and multi-row,
  empty input, all-field-absent/null/blank input, partially-parseable input).
- `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineSpec.scala` — updated the
  existing `"datebucket: unparseable value yields null"` test (line ~489) to assert the new,
  intentional guard behavior: a single-row all-unparseable input now fails execution with an
  `IllegalArgumentException` instead of silently succeeding with a null bucket.
