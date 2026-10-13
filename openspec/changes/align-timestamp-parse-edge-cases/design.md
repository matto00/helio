## Context

- `TimestampParsing.parseNonEpochInstant` (backend/src/main/scala/com/helio/domain/engine/TimestampParsing.scala:74)
  tries, in order: `Instant.parse`, `OffsetDateTime.parse`, the written-offset regex, `ISO_LOCAL_DATE_TIME`, the
  `SpaceSeparatedFormatter` (`yyyy-MM-dd HH:mm[:ss]` + 0-9 digit fraction, default SMART resolver), `LocalDate.parse`,
  and STRICT `MM/dd/uuuu`. `Instant.parse`'s ISO_INSTANT folds `:60` and `24:00`, the ISO fraction printer-parser
  accepts a bare `.`, ISO years take `+YYYYY`, and SMART `yyyy` clamps `02-29` and rolls `24:00`.
- `parseChartInstant` (frontend/src/utils/chartTimeAxis.ts) is regex-first: 4-digit years only, `utcMillis` rejects
  `h>23`, `s>59` and impossible dates, but accepts year 0 and, on the LOCAL regex only, a fraction after minutes
  (the ZONED path already rejects it: "the backend's fraction needs seconds").
- The shared fixture `shared-test-fixtures/chart-timestamp-parsing.json` (99 cases, `{input, epochMillis, note}`) is
  iterated by `ChartTimestampParsingParitySpec` (asserts `>= 99`) and `chartTimeAxis.test.ts` (asserts `>= 98`).
- Every claim above about which side accepts which class comes from the HEL-1502 skeptic's fuzz and the ticket; the
  executor confirms each one red-first before changing code (C3).

## Goals / Non-Goals

**Goals:** for every class in the ticket, backend and chart give the same answer, pinned by a fixture case; no reader
fabricates an instant the text does not denote.

**Non-Goals:** changing `looksLikeTimestamp` / schema inference / `DatasetRowValidator` (HEL-1502 commitment); any
new accepted shape; any file in parked PRs #996 or #986; migrations.

## Decisions

### D1. The stricter side wins in every class: all seven read as not-a-timestamp

| Class | Example | Changes | Basis |
|---|---|---|---|
| clamped impossible date | `2026-02-29 12:00` | backend | owner's strict-`MM/dd/yyyy` ruling (reject clamped dates) extended to every shape — ASSUMED CALL A1 |
| hour 24 | `2026-07-01 24:00`, `…T24:00:00Z` | backend | fabricates the next day — ASSUMED CALL A2 |
| leap second | `2026-07-01T23:59:60Z` | backend | `Instant.parse` folds it to `:59`, a value not written — ASSUMED CALL A3 |
| empty fraction | `2026-07-01T12:00:00.Z`, tz-less `2026-07-01T12:00:00.` and `2026-07-01 12:00:00.` | backend | malformed; both regex grammars already require 1-9 digits — ASSUMED CALL A4 |
| extended year | `+12026-07-01T12:00:00Z` | backend | `bound-epoch-range` ruling's 0001-9999 bound applied to written years — ASSUMED CALL A5 |
| year 0000 | `0000-07-01T12:00:00Z`, `0000-07-01T12:00`, `0000-07-01`, `0000-07-01 12:00`, `07/01/0000` | both (backend accepts the ISO/T-local/bare/US forms today; chart accepts all) | same bound — ASSUMED CALL A5 |
| fraction w/o seconds | `2026-07-01 12:00.5` | whichever side accepts | mirrors the existing zoned-path rule — ASSUMED CALL A6 |

Alternative rejected: accept on the chart side (looser wins). It would make the chart plot `:60`/`24:00`/`02-29` at a
fabricated instant and widen an already-wide grammar; HEL-1502's rulings consistently chose rejection over invention.
The year bound applies to the WRITTEN date's year (the text's own digits), not the UTC instant after the offset:
`0001-01-01T00:30:00+01:00` stays a timestamp. A1-A6 are assumed product calls under the overnight rules; the PR
carries them in an OWNER REVIEW section and is parked.

### D2. Backend mechanism: a syntactic gate before the existing readers, plus STRICT space-separated resolution

`parseNonEpochInstant` first applies a syntactic gate, BEFORE every existing reader (so the STRICT `uuuu` switch below
can never newly admit year `0000`). The gate is shape-aware and reads only the field it checks:
- **Written year.** For a value starting with a date (`[+-]?\d+-`): the year field must be exactly 4 digits, no sign,
  and not `0000`. For a `MM/dd/yyyy` value (`^\d{2}/\d{2}/\d{4}$`): the trailing year must not be `0000`. The gate
  never applies the leading-year rule to a `MM/dd/yyyy` value (so `10/01/2026`, `12/31/2025` stay accepted).
- **Time field.** The time field is the text between the date-time separator (`T`/`t`/space) and the first offset
  character (`Z`/`z`/`+`/`-`) or `[`, or end of string. Only that field is checked: a `.` must be followed by a digit;
  a fraction must follow `HH:mm:ss` (not `HH:mm`); seconds `60` and hour `24` are rejected. Offsets (`+18:00`) and
  bracketed ids (`[+05:00]`, `[UTC+01:00]`) are never inspected by these checks.
`SpaceSeparatedFormatter` switches to `uuuu` + `ResolverStyle.STRICT` (as `UsDateFormatter` already does), rejecting
`02-29` in a non-leap year and hour 24. The `:60`/`24:00` folding inside `Instant.parse`/`OffsetDateTime.parse` is
closed either by the gate (reject seconds `60` and hour `24` syntactically) or by routing those inputs through the
already-STRICT `LocalTime.parse(ISO_LOCAL_TIME)` path — executor's choice, proven by the fixture. Every existing
fixture case and every existing `TimestampParsingSpec`/`DateBucketCharacterisationSpec` row MUST keep its result.

### D3. Chart mechanism: two guards in `parseChartInstant`

`utcMillis` rejects `y < 1` (4-digit regex already excludes > 9999 and extended years; this covers every shape that
reaches `utcMillis`, including `MM/dd/yyyy`, matching D2's US-year rule), and the LOCAL branch rejects a
fraction with no seconds exactly as the ZONED branch already does. Nothing else in the chart parser changes.

### D4. Fixture and proof

Add at least one fixture case per class and per backend path that accepts it today (every example in the D1 table,
including `07/01/0000`, `0000-07-01`, `0000-07-01T12:00`, the two tz-less empty fractions, `2026-07-01T12:00.5`,
`2026-07-01T24:00`, `2026-07-01T12:00:60.5Z`) plus `0001-01-01T00:30:00+01:00`, `9999-12-31T23:00:00-05:00` and boundary
positives that must stay accepted: `0001-01-01`, `9999-12-31 23:59:59.999`, `2024-02-29 12:00` (leap year),
`2026-07-01T23:59:59Z`, `2026-07-01 00:00`. Both sides assert the same minimum count: the new exact total. Each
class's case is shown RED on the side that changes before the fix. Additionally run a bounded, one-off differential
check (both parsers over the same generated inputs, generator mutating the seven classes; record the input count and
zero disagreements in the PR); it need not be committed.

### D5. Tidy-ups

- `DateBucketCharacterisationSpec`: move the `MM/dd/yyyy` row out of `unchanged` into a group named for HEL-1502's
  widen-parser change (was `null`), and add rows for the new reject classes in a group named for this change.
- Step-level tests: `date_trunc("hour", …)` through the compute step over `"2026-07-01T17:00:00+05:00[Europe/Paris]"`
  and `"2026-07-01T14:00:00+02:00[Bogus/Zone]"` → `"2026-07-01T12:00:00Z"`; the datebucket step over the epoch-bound
  positives `"253402300799999"` → `"9999-12-31"` and `"-62135596800000"` → `"0001-01-01"`. Place them in existing
  step spec files NOT touched by #996/#986.

## Risks / Trade-offs

- Inference still types a column timestamp when its cells are `….Z`, `+12026-…` or `0000-…`; those cells now read
  null in cast/datebucket/compute. Same precedent as HEL-1502 (exotic inference-accepted suffix forms already null);
  real data with these shapes is not expected. Recorded in OWNER REVIEW.
- A previously-bucketed `2026-02-29 12:00`/`24:00` row now buckets to null: correct per D1, but a behaviour change.
- Gate regex could over-reject a legitimate shape: mitigated by D2's "every existing case keeps its result".

## Planner Notes

- Self-approved: D2/D3 mechanisms, fixture layout, test placement, written-year (not instant-year) bound detail.
- Assumed product calls A1-A6 (overnight rules): PR parks with OWNER REVIEW; auditor does not merge.
- Executor-found extension of A5 (assumed call A7): a differential run (60,000 generated inputs) found the existing
  STRICT `MM/dd/uuuu` reader admits a signed extended year (`07/01/+12026`) that the chart rejects; the D2 gate now
  requires the `MM/dd/yyyy` year to be exactly four ASCII digits (and not `0000`), pinned by a fixture case.
- Differential evidence (D4/3.7): 60,000 generated inputs mutating all seven classes (random years/months/days/hours/
  minutes/seconds/fractions/offsets/ids/separators and `MM/dd/yyyy`), 16,770 of them accepted by both: 0 disagreements
  after the A7 fix (6,482 before it, all `MM/dd/+YYYYY`).
- Fixture total is 125 (99 + 26 new); both sides assert `>= 125`.

