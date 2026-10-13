## Why

HEL-1502 pinned the chart's time-axis parser and the backend's shared timestamp parser to one fixture, but a fuzz of
209,731 inputs found seven input classes where they still disagree: the chart would plot a point the pipeline engine
reads as null, or the engine buckets/casts a value the chart drops. Two of the backend-only classes also fabricate an
instant the text does not denote (`2026-02-29 12:00` clamped to 28 Feb; `24:00` rolled to the next midnight).

## What Changes

- The shared parser rejects (reads as not-a-timestamp) on BOTH sides: a fraction separator with no digits, a leap
  second (`:60`), any year outside 0001-9999 (extended `+YYYYY` years and year `0000`), an impossible calendar date
  in any accepted shape (no SMART clamping), hour `24`, and a fraction written without seconds.
- Backend `TimestampParsing.parseInstant` tightens to that grammar; `parseChartInstant` tightens for year `0000` and
  for fraction-without-seconds on local times. Both stay mirrored.
- The shared fixture gains a case for every class; both sides assert the same minimum case count.
- Test tidy-ups: the `MM/dd/yyyy` characterisation row moves to a "changed" group; step-level tests for bracketed-id
  `date_trunc("hour")` and the epoch-bound datebucket positives.

Each reject decision not already decided by the HEL-1502 owner rulings is an assumed product call (see design.md).

## Capabilities

### New Capabilities

### Modified Capabilities
- `timestamp-value-parsing`: the accepted-shape requirement gains explicit rejections (empty fraction, leap second,
  years outside 0001-9999, impossible dates/hour 24 in every shape, fraction without seconds).

## Impact

- `backend/src/main/scala/com/helio/domain/engine/TimestampParsing.scala` (`parseInstant`/`parseNonEpochInstant`;
  `looksLikeTimestamp` unchanged).
- `frontend/src/utils/chartTimeAxis.ts` (`parseChartInstant`).
- `shared-test-fixtures/chart-timestamp-parsing.json`, `ChartTimestampParsingParitySpec`, `chartTimeAxis.test.ts`,
  `TimestampParsingSpec`, `DateBucketCharacterisationSpec`, compute/datebucket step specs.
- Consumers of `parseInstant` (cast timestamp/date targets, datebucket, compute date functions, window day frames,
  first-run `ColumnClassifier`) read these rare shapes as null. No API, schema or migration change.

## Non-goals

- Changing schema inference (`looksLikeTimestamp`) or `DatasetRowValidator`.
- Any file touched by parked PRs #996 (incl. `TimestampNumberParitySpec.scala`) or #986 (compute/analyze inference).
- New accepted shapes.
