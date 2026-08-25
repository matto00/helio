## Why

`datebucket`'s parser accepts only epoch/`Instant.parse` (`Z`-suffixed)/`OffsetDateTime.parse`
(explicit offset)/bare `LocalDate` — it silently returns `null` for every row on the timezone-less
`LocalDateTime` shapes CSV/spreadsheet exports actually produce (`2026-03-14T22:08:39`,
`2026-07-01 12:00:00`). Nothing errors; the step reports success. A following `aggregate` collapses
every row into one `null` bucket, so a chart that should show N points shows one. This already
corrupted a real prod dashboard (HEL-639 evidence).

## What Changes

- **BREAKING** (data-correctness, not API): `parseToUtcDate` gains a `LocalDateTime` fallback,
  accepting both `T`- and space-separated tz-less forms, with/without fractional seconds,
  interpreted as UTC. Bucketed output values will change (correctly) for any pipeline whose
  `datebucket` input is currently tz-less and silently all-null.
- `DateBucketStep.evaluate` fails step execution (`Future.failed(new IllegalArgumentException(...))`,
  the same mechanism already used for an unsupported `granularity`) when zero rows parse out of a
  non-empty input (new terminal-boundary guard; does not touch the existing per-row
  null-on-partial-failure contract, and is not a `validationError` — that mechanism is
  analyze-time/schema-only and has no row-level access, so it cannot implement this guard).

## Capabilities

### Modified Capabilities
- `pipeline-date-bucket-op`: the "Unparseable value yields null" requirement's accepted-input-shape
  enumeration is extended (tz-less `LocalDateTime`, both separators, fractional seconds optional);
  a new requirement is added for the zero-parse-rate execution-failure guard (fails the step via
  the existing `IllegalArgumentException` mechanism, not a `validationError`).

## Impact

- `backend/src/main/scala/com/helio/domain/steps/DateBucketStep.scala` (`parseToUtcDate`, `apply`,
  `evaluate`).
- No API/wire-shape change — `DateBucketConfig` is untouched; only bucketed *values* change for
  previously-all-null tz-less inputs, and a step that previously "succeeded" with all-null output
  can now fail execution instead (via the existing bad-`granularity` failure mechanism, not a
  `validationError`).
- Non-goals: no workspace/pipeline timezone-configuration concept (out of scope, no existing hook);
  no change to `SchemaInferenceEngine`'s tz-less date detection or any other date/time parsing site
  (reported as a sibling-consistency finding, not fixed here — see design.md).
