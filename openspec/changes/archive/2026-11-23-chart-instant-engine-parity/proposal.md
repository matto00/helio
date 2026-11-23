## Why

The chart time axis reads x values with `parseChartInstant`, a second TypeScript copy of the engine's timestamp reader (`TimestampParsing.parseInstant`). HEL-1581's client evaluator showed it disagrees with the engine: a whole-number epoch written with non-ASCII Unicode decimal digits (`١٧٠٠٠٠٠٠٠٠`, `１７００…`) is an instant to the engine and the evaluator but not to the chart, and a string padded with non-ASCII whitespace (U+00A0 etc.) is an instant to the chart but not to the engine (Java `trim` strips only code units <= U+0020). The existing requirement says the chart reads an x value "exactly as the backend's shared timestamp parser reads it, with no frontend-only extension", so both are defects.

## What Changes

- One TypeScript timestamp reader with the engine's semantics, used by both the chart (`parseChartInstant`) and the client evaluator (`parseInstantString`), instead of the evaluator layering Unicode-digit epochs and Java trimming on top of the chart parser.
- Charts now place a Unicode-digit whole-number epoch string on the time axis (same instant as its ASCII spelling).
- Charts stop placing an x value whose only difference from a timestamp is surrounding non-ASCII whitespace; it counts toward the "no readable date" footnote, as it is already not a timestamp to the engine.
- Charts now place a value padded with control characters U+0001-U+001F (which Java `trim` strips and JS `trim` mostly does not) at the instant the engine reads.
- The shared chart/backend fixture (`chart-timestamp-parsing.json`) gains every timestamp string the HEL-1581 corpus feeds to a timestamp reader, each pinned to the Scala parser by the existing backend parity spec, plus a Jest guard that the fixture keeps covering the corpus.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `chart-field-data-rendering`: the "A timestamp x field renders on a time axis" requirement states the digit and whitespace rules explicitly.

## Impact

- Frontend: `frontend/src/utils/chartTimeAxis.ts`, a new shared reader module under `frontend/src/utils/`, `frontend/src/features/pipelines/evaluator/instants.ts`, tests.
- Shared fixture: `shared-test-fixtures/chart-timestamp-parsing.json`; `shared-test-fixtures/pipeline-step-parity/manifest.json` note.
- Backend: no code change; `ChartTimestampParsingParitySpec` (existing GUARD) validates the new fixture cases against Scala.
- No API, schema or migration change.
