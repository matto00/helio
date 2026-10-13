## Why

HEL-1314 gave the pipeline engine one shared timestamp parser, but four gaps remain (HEL-1502). First, Postgres `timestamptz` text (`2026-07-01 12:00:00+00`) reads as null in datebucket, compute and window day frames. Second, cast keeps `MM/dd/yyyy` and region-zoned ISO strings that those same readers then null. Third, a JSON-number epoch cast to a timestamp comes out in scientific notation. Fourth, `Long.MinValue` now reads as the year -292275055. The owner ruled on all four on 2026-10-12. This change also cleans up two small UI items left over from HEL-1314.

## What Changes

- **Shared parser accepts Postgres offsets** (owner ruling `accept-postgres-offsets`). A date-time with a `T` or space separator now reads as that instant when it carries a numeric offset written `+HH`, `+HHMM`, `+HH:MM` or `+HH:MM:SS`.
- **Shared parser accepts every shape schema inference calls a timestamp** (owner ruling `widen-parser`):
  - `MM/dd/yyyy` is read as midnight UTC, with strict calendar validation.
  - An ISO offset date-time followed by a `[Region/Id]` suffix is read at its written offset.
  - Schema inference and `DatasetRowValidator` are **not** changed.
- **Cast keeps exactly what the shared parser reads.** A `timestamp`/`date` cast keeps a string iff the shared parser accepts it. Every value cast keeps is therefore readable by datebucket, compute and window day frames. The only values this newly drops are impossible `MM/dd/yyyy` calendar dates such as `02/30/2026`, which inference's lenient resolver had clamped.
- **A numeric epoch casts to an ISO instant** (owner ruling `iso-instant-both`). A non-string number accepted as an epoch is emitted as the UTC ISO instant (`2026-02-17T00:00:00Z`, with milliseconds only when non-zero) for both `timestamp` and `date` targets. Numeric strings keep their original text.
- **Epochs are bounded to years 0001–9999** (owner ruling `bound-epoch-range`). An epoch outside that range is not a timestamp. `Long.MinValue` is null.
- **The chart time axis tracks the widened parser.** The frontend `parseChartInstant` must match the backend case by case, through the shared fixture. It gains the Postgres offsets, the bracketed region suffix and the epoch year bound. `MM/dd/yyyy` stops being a frontend-only extension.
- **One shared disclosure-summary CSS recipe.** It has a visible chevron marker and a 44px touch floor, and is used by both the compute Functions reference summary and the admin usage card's "View as table" summary.
- **Functions list spacing.** Entries in the compute Functions list are separated by `--space-2`, which is wider than the `--space-1` inside an entry.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `timestamp-value-parsing`: the accepted-shapes requirement gains Postgres offsets, `MM/dd/yyyy`, the region-zoned ISO suffix and the 0001–9999 epoch bound. Cast keeps exactly the parser's set and emits ISO for numeric epochs.
- `pipeline-cast-op`: the timestamp/date cast clause changes from "either reader" to "the shared parser", and a numeric epoch is emitted as an ISO instant.
- `chart-field-data-rendering`: the time axis's accepted x shapes follow the widened backend parser, with no frontend-only extension.

## Impact

- Backend:
  - `backend/src/main/scala/com/helio/domain/engine/TimestampParsing.scala` (`parseInstant`/`parseNonEpochInstant`/epoch bound).
  - `backend/src/main/scala/com/helio/domain/steps/CastStep.scala` (keep predicate, ISO emission).
  - Indirectly affects every reader of the parser: `DateBucketStep` (and the window day frames through it), `ExpressionDateTimeFunctions`, and the first-run column classifier through `DateBucketStep.parseNonEpochDate`. That classifier will now classify `MM/dd/yyyy` and Postgres-offset columns as date-like.
- Frontend:
  - `frontend/src/utils/chartTimeAxis.ts` (`parseChartInstant`).
  - `frontend/src/features/pipelines/ui/stepConfigs/ComputeFunctionReference.tsx` and `PipelineDetailPage.css`.
  - `frontend/src/features/adminUsage/ui/UsageCard.{tsx,css}`.
  - A new shared summary recipe under `frontend/src/shared/ui/`.
- Shared fixture: `shared-test-fixtures/chart-timestamp-parsing.json`.
- No migration, API shape or schema change.
