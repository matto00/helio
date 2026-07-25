## 1. Backend — TimeSeriesShape

- [x] 1.1 Add `TimeSeriesShape.scala` in `backend/src/main/scala/com/helio/domain/shapes/` with
      `id = "time-series"`, `label`, `description`, `paramsSchema` (`timeField`, `granularity`,
      `measures`).
- [x] 1.2 Implement `expand`: validate `timeField` (non-empty string), `granularity` (one of
      day/week/month/quarter/year, case-insensitive, normalized to lowercase for the config), and
      `measures` (non-empty array of `{fn, field, alias}`, `fn` validated case-insensitively against
      sum/avg/min/max/count with original casing preserved, non-empty `field`/`alias`, no duplicate
      aliases, no alias equal to `timeField`).
- [x] 1.3 On success, build the three-step expansion: `datebucket` (field=timeField,
      granularity=lowercased, outputColumn=None), `aggregate` (groupBy=[timeField], the measures),
      `sort` (ascending on timeField).
- [x] 1.4 Declare `outputContract = OutputContract(RowCountContract.Unbounded, Vector.empty,
      <description>)`.
- [x] 1.5 Register `TimeSeriesShape` in `PipelineShape.Registry`.

## 2. Backend — registry/catalog extension

- [x] 2.1 Extend `PipelineShapeSpec`'s independently-authored id set and registry-equality assertions
      to include `"time-series"` (size 4).
- [x] 2.2 Extend `PipelineShapeRoutesSpec`'s named-shape catalog assertion to also check for a
      `"time-series"` entry with a non-empty `paramsSchema`.

## 3. Tests

- [x] 3.1 Add `TimeSeriesShapeSpec` (domain unit tests) covering: valid expansion (three steps, exact
      configs), granularity case-insensitivity + lowercase normalization, measure fn
      case-insensitivity with casing preserved, missing/empty `timeField`, unknown `granularity`,
      empty/missing `measures`, unsupported `fn`, duplicate aliases, alias-collides-with-timeField.
- [x] 3.2 Add `TimeSeriesShapeEngineSpec` (end-to-end) proving the expansion decodes via
      `PipelineStepConfigCodec.decode` and, run through the real pipeline engine against a shuffled,
      multi-month dated fixture, produces one row per month with correct aggregated values in
      chronological order.
- [x] 3.3 Run `sbt test` for the full backend suite; confirm no pre-existing test regresses and no new
      Flyway migration was added.

## 4. Docs/handoff

- [x] 4.1 Write `files-modified.md` summarizing changed/added files for archive handoff.

(Gap-filling spinoff already filed by the orchestrator during planning — HEL-622.)
