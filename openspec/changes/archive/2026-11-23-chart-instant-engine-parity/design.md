## Context

See proposal.md (Why). Today there are two TypeScript layers over one grammar:

- `frontend/src/utils/chartTimeAxis.ts` `parseChartInstant(raw): number | null` — the chart's x parser (epoch-millis). Uses JS `String.prototype.trim` and ASCII `\d` in its `DECIMAL` epoch regex. Callers: `chartTimePlan.ts` (x values and aggregated group keys), `features/panels/ui/chartOverlayOption.ts` (history overlay x).
- `frontend/src/features/pipelines/evaluator/instants.ts` `parseInstantString(raw): InstantParts | undefined` — the evaluator's reader. Applies Java `trim` (rejects anything still padded after it), reads a numeric string with Unicode digits (`asciiDigits` + whole-`BigDecimal` port, `epochOfString`), and only then falls back to `parseChartInstant` for every other shape, adding the nanosecond fraction the chart truncates.

The engine (`backend/.../TimestampParsing.parseInstant`) is the oracle: `epochOf` String arm = `s.trim.toLong` else whole `BigDecimal(s.trim)` (both accept any Unicode Nd digit), and `parseNonEpochInstant(value.toString.trim)` whose formatters and regexes are ASCII-digit only (Java regex `\d` is ASCII by default; `DateTimeFormatter` uses `DecimalStyle.STANDARD`). So the only digit gap is the numeric-epoch arm; the other gap is trimming.

`chart-timestamp-parsing.json` (125+ cases) is pinned to Scala by `ChartTimestampParsingParitySpec` (backend, GUARD) and to `parseChartInstant` by `chartTimeAxis.test.ts`. It has no Unicode-digit or non-ASCII-whitespace case, which is why the gap was invisible.

## Goals / Non-Goals

**Goals:** exactly one TypeScript implementation of "which instant does this string denote", with the engine's semantics, used by the chart and the evaluator; every timestamp string the HEL-1581 corpus feeds to a timestamp reader is a Scala-pinned case of the chart fixture; red-first proof on the current parser.

**Non-Goals:** any backend code change; changing which strings the engine accepts; non-string x values (callers already pass strings); chart axis/footnote behavior beyond which values denote an instant; `looksLikeTimestamp` (schema inference) — untouched.

## Decisions

### D1. Single reader in `frontend/src/utils/timestampParsing.ts`

Move the grammar out of `chartTimeAxis.ts` into a new echarts-free module `frontend/src/utils/timestampParsing.ts` exporting `parseInstantParts(raw: string): InstantParts | undefined` (epoch seconds as `bigint` + 0..999,999,999 nanos) with the full engine semantics, in the engine's order:

1. Java trim (`javaTrim`); if the result still differs from JS `trim()` of it (non-ASCII whitespace remains at an edge) → `undefined`. (Same check `instants.ts` makes today.)
2. Numeric epoch arm: the port currently in `instants.ts` (`asciiDigits` + `wholeLongOfDecimal` + `epochOfString`, seconds/millis threshold, 0001-9999 bound). A string that is a whole number but out of range is `undefined` (no fall-through), exactly as `epochOfString` returns `undefined` vs `null` today. This is equivalent to the engine's `epochInstant(...).orElse(parseNonEpochInstant(...))` because no whole-number decimal string can match a non-epoch shape (all need `dddd-dd-dd` or `dd/dd/dddd`); say so in a code comment.
3. Non-epoch shapes: the existing `ISO_ZONED` / `ISO_LOCAL` / `ISO_DATE` / `US_DATE` logic moved verbatim from `chartTimeAxis.ts`, kept ASCII-only, extended to keep the full 1-9 digit fraction as nanos (today done by `FRACTION_AFTER_SECONDS` in `instants.ts`).

Then:
- `parseChartInstant(raw)` in `chartTimeAxis.ts` keeps its exported name and signature (`null`/`undefined`/empty → `null`) and becomes `parts ? Number(parts.seconds) * 1000 + Math.floor(parts.nanos / 1e6) : null` — the same millisecond truncation (floor) as today.
- `instants.ts` `parseInstantString` becomes a re-export/thin alias of `parseInstantParts`; `InstantParts` type moves with it (re-exported from `instants.ts` so its importers — `cast.ts`, `dateFunctions.ts`, `windowRolling.ts` — are untouched). `instants.ts` no longer imports `chartTimeAxis`.
- `javaTrim` / `digitValue` are imported from `features/pipelines/evaluator/javaNumbers.ts` (dependency-free, 170 lines, no imports — verified), not moved; moving them would churn every evaluator importer for no behavior gain. The utils→feature import is acceptable because the target is a leaf module; note it in a comment.

Alternatives: (a) make `parseChartInstant` call `parseInstantString` — rejected, `instants.ts` imports `chartTimeAxis.ts`, so it is a circular import; (b) patch `parseChartInstant`'s regexes for Unicode digits and trim — rejected, keeps three copies of the epoch rule (ticket explicitly prefers sharing).

### D2. Behavior change, scoped by the existing requirement

The `chart-field-data-rendering` requirement already says "exactly as the backend's shared timestamp parser reads it, with no frontend-only extension". Both changes (Unicode-digit epochs now plot; non-ASCII-whitespace-padded values no longer plot) move the chart toward that requirement; neither reverses a deliberate restriction (the ASCII-only behavior is recorded as a gap in HEL-1581's `tasks.md` and parity manifest, and no fixture case or comment justifies JS `trim`). The delta spec makes both explicit.

### D3. Scala-oracle-backed tests (the agreement must not be tautological)

After D1 the chart and evaluator call the same function, so "chart == evaluator" alone proves nothing about the engine. The parity evidence is therefore anchored on Scala:

1. **Fixture extension (red-first).** Append to `shared-test-fixtures/chart-timestamp-parsing.json` every distinct string cell the HEL-1581 corpus (`shared-test-fixtures/pipeline-step-parity/`) feeds to a timestamp reader: input-row string cells of (i) `cast.json` vectors whose config casts to `timestamp` or `date`, (ii) every `datebucket.json` vector, (iii) `compute.json` vectors whose expression calls a date/time function, (iv) `window.json` vectors with a day frame — plus explicit cases for non-ASCII whitespace padding (U+00A0, U+2003, U+3000 around a date and around an epoch) and Unicode-digit epochs (Arabic-Indic, fullwidth, mixed ASCII/Unicode, a non-whole Unicode decimal, an out-of-range Unicode epoch). Each carries `epochMillis` from the Scala parser (`TimestampParsing.parseInstant(...).map(_.toEpochMilli)`) and a `note` naming its corpus file, or `"HEL-1640"` for the hand-added ones. Expectations are generated by running the Scala parser (e.g. a throwaway scratch test or the existing spec's failure output), never hand-derived from the TS code. The existing backend `ChartTimestampParsingParitySpec` then proves every new case against Scala, and `chartTimeAxis.test.ts` proves `parseChartInstant` against the same file. Raise the min-count assertion in both halves to the new count.
2. **Coverage guard (Jest, labelled GUARD).** A test that re-derives the corpus string set with the same selector as (1) and asserts every string is an `input` of the fixture, so a future corpus vector cannot silently escape chart parity.
3. **Single-implementation guard (Jest, labelled GUARD).** For every fixture input, `parseChartInstant(s)` equals the millisecond floor of `parseInstantString(s)` (both `null`/`undefined` together), and for every fixture case with a sub-millisecond fraction the evaluator's nanos match the written fraction. Guards against a future re-fork.

Red-first: (1)'s new Unicode-digit and NBSP cases fail on the current `parseChartInstant`; the red run is committed (or recorded as evidence if the hook refuses) before implementation.

### D4. Notes updated

`pipeline-step-parity/manifest.json` note (line ~227) and the `instants.ts` header comment stop describing the chart gap as open.

## Risks / Trade-offs

- [A chart that relied on NBSP-trimmed dates loses points] → values in a `timestamp`-declared Output column come out of the engine (cast/datebucket emit canonical ISO), so padded text only reaches a chart from data the engine already treats as non-timestamps; the footnote counts it. Accepted per D2.
- [Bundle: `chartTimeAxis` is main-bundle; it now pulls `javaNumbers.ts`] → leaf module, no transitive imports; executor confirms no echarts or evaluator-wide import enters the main bundle.
- [Selector drift between fixture harvest and coverage guard] → the guard and the harvest use one selector function in a test helper.

## Migration Plan

None (frontend logic + fixtures). Rollback = revert the commit.
