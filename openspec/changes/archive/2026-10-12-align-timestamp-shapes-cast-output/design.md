## Context

See proposal.md (Why). Ground truth against origin/main 000c1dfa5:

- `TimestampParsing.parseNonEpochInstant` tries, in order, `Instant.parse`, `OffsetDateTime.parse`, `ISO_LOCAL_DATE_TIME`, a space-separated tz-less formatter, and `LocalDate.parse`.
  - `OffsetDateTime.parse` already accepts a `T`-separated `+00` (`2026-07-01T12:00:00+00` resolves to 12:00Z). The failing Postgres shapes are therefore the **space-separated** offset forms and the **4-digit `+HHMM`** form on either separator.
  - The frontend `parseChartInstant` (`frontend/src/utils/chartTimeAxis.ts`, `ISO_ZONED`) accepts only `Z|±HH:MM(:SS)`. The `T…+00` form is therefore already a silent backend/chart divergence. The shared fixture `shared-test-fixtures/chart-timestamp-parsing.json` has no case for it.
- `TimestampParsing.looksLikeTimestamp` is the schema-inference and `DatasetRowValidator` reader.
  - It accepts `ISO_DATE_TIME`. That accepts an offset date-time with an optional `[Region/Id]` suffix, but **not** a bare `[Region/Id]` with no offset (probed: `2026-10-01T12:00:00[Europe/Paris]` fails to parse, while `…+02:00[Europe/Paris]` parses to `10:00Z` and `…+05:00[Europe/Paris]` parses to `07:00Z`, i.e. at the written offset).
  - It also accepts `ISO_LOCAL_DATE_TIME`, `ISO_LOCAL_DATE`, and `MM/dd/yyyy` under the default SMART resolver. That resolver clamps `02/30/2026` to `2026-02-28` (probed).
- `CastStep.castValue`'s `date`/`timestamp` branch keeps `v.toString` when either reader accepts the value. Rows carry every JSON number as a Double (`PipelineRowJson.scala:61`), so a JSON epoch `1771286400` is kept as `"1.7712864E9"`.
- `fromEpoch` is `Try`-wrapped. `Instant.ofEpochMilli(Long.MIN_VALUE)` succeeds as `-292275055-05-16T16:47:04.192Z` (probed).
- `ChartTimestampParsingParitySpec` (backend) and `chartTimeAxis.test.ts` (frontend) pin both parsers to the shared fixture case by case. Cases flagged `backendParseInstant: false` are the frontend-only extension (today: `MM/dd/yyyy`).

### Owner rulings (2026-10-12, recorded as `escalation.answered` HEL-1502-1791866823310-75f270, chat channel)

| # | Item | Ruling |
|---|------|--------|
| 1 | Postgres timestamptz text | `accept-postgres-offsets` |
| 2 | cast vs datebucket/compute divergence (ticket item 3) | `widen-parser` |
| 3 | canonical output of a numeric epoch cast (ticket item 2) | `iso-instant-both` |
| 4 | `Long.MinValue` (ticket item 5) | `bound-epoch-range` |

The escalation context (events.jsonl line 4) carried two orchestrator commitments, and the owner answered within them. They are commitments, not owner directives: items 4 and 6 ship as written, and schema inference (`looksLikeTimestamp`) is not widened under any option. This change keeps both.

## Goals / Non-Goals

**Goals:**
- Every value a `timestamp`/`date` cast keeps is readable by datebucket, compute and window day frames.
- The chart time axis reads exactly the instants the backend reads. The shared fixture is the single list.
- Numeric epochs cast to readable ISO instants.
- Every accepted epoch is a 4-digit-year instant.

**Non-Goals:**
- Changing `looksLikeTimestamp` (schema inference, `DatasetRowValidator`). This is an orchestrator commitment carried in the escalation the owner answered within.
- Accepting a bare `[Region/Id]` with no offset. Inference does not accept it either.
- Accepting space-separated `Z`. Postgres never emits it, and the fixture already pins it as rejected.
- Bounding non-epoch ISO strings by year.
- Rewriting non-epoch strings in cast output. They keep their original text, per HEL-1436.
- Any migration.
- The three pre-existing **un-suffixed** backend-only quirks of `Instant.parse`/`OffsetDateTime.parse`: a trailing-dot fraction, a leap second, and extended years. They predate this change, no ruling covers them, and the fixture has never pinned them. A Follow-up (relatedTo HEL-1502) is filed at Delivery. The Goals line about the chart reading "exactly the instants the backend reads" applies to every fixture case and every shape this change adds.

## Decisions

### D1. Postgres offsets: one offset grammar, both separators, both sides

**Offset grammar** (`OFFSET`), identical in Scala and TypeScript:
- `Z`/`z` is allowed only after a `T` separator, as today. A space-separated `Z` stays rejected (pinned).
- Otherwise the offset is a sign `+` or `-`, then one of `HH`, `HHMM`, `HH:MM` or `HH:MM:SS`, each part exactly two digits.
- `HH` must be 00–18 and `MM`/`SS` must be 00–59.
- The **total** offset must be ≤ 18:00:00.

Probed against JDK 21 `OffsetDateTime.parse` on the `T` form: `+05`, `+05:30`, `+05:30:15`, `+18:00` and `-00` are accepted. `+0530`, `+053015`, `+0530:15`, `+18:30`, `+18:00:01`, `+5`, `+05:3` and `+19` are rejected.

The grammar is therefore exactly today's backend `T`-form set plus `±HHMM`, now also on a space separator.

**Backend.** Add one regex-driven reader after `OffsetDateTime.parse`:
- Pattern: `^(\d{4}-\d{2}-\d{2})([Tt ])(\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?)(OFFSET|[Zz])$`. A `Z`/`z` is accepted only when the separator is `T`/`t`.
- Parse the local part with STRICT `uuuu-MM-dd` and the existing variable-fraction time.
- Build the offset with `ZoneOffset.ofHoursMinutesSeconds`. It enforces the component ranges and the ±18:00 total, and throws (so returns `None` under `Try`) outside them.
- Apply the sign to **every** component: `-0330` is (-3, -30, 0). `ofHoursMinutesSeconds` rejects mixed signs.

**Frontend.** The existing `offsetSeconds` (chartTimeAxis.ts) accepts `+18:30` and `+18:00:01` today, which the backend rejects. That is a pre-existing `T`-form divergence, and the port fixes it: enforce `HH ≤ 18`, `MM`/`SS ≤ 59` and a total ≤ 64800 seconds, and accept the `HHMM` form.

**Fixture negatives** (all null on both sides): `+18:30`, `+18:00:01`, `+053015`, `+0530:15`, `+5`, `+05:3`, `+19`, each on both separators.

**Fixture positives:** `+00`, `-00`, `+0530`, `-0330`, `+05:30`, `+05:30:15`, `+18:00`, `-1800`, each on both separators.

**Alternative rejected:** normalizing the string (replacing the space with `T` and inserting a colon) and re-feeding it to `OffsetDateTime.parse`. One explicit grammar is easier to port exactly.

### D2. Widen to inference's shapes: `MM/dd/yyyy` strict, region suffix at the written offset

- **`MM/dd/yyyy`.** Append a reader: `MM/dd/uuuu` with `ResolverStyle.STRICT`, giving midnight UTC.
  - STRICT, not SMART: SMART silently turns `02/30/2026` into 28 Feb. That is fabricated data, and the frontend chart parser (`utcMillis`) already rejects it.
  - Two-digit month and day only. This matches inference's `MM/dd/yyyy` and the chart's `US_DATE` (`1/5/2026` stays rejected).
- **Region suffix: one syntactic grammar on both sides.** A value is `<offset date-time>[<id>]`, where:
  - `<offset date-time>` must match the D1 **regex** exactly: `T` or space separator, then `Z` (T only) or the D1 `OFFSET` grammar.
  - The suffix form is **never** fed to `Instant.parse`/`OffsetDateTime.parse`. Those accept three shapes the chart rejects (a trailing-dot fraction `12:00:00.Z`, a leap second `23:59:60Z`, extended years `+12026-…`), and they must not gain a backend-only `[id]` form.
  - `<id>` matches `[A-Za-z0-9_+\-/:]+`: one or more characters, with no whitespace and no brackets.

  The instant is the prefix's instant at its **written offset**. The id is **not** validated against a time-zone database on either side, because the written offset alone decides the instant. A JS engine has no tzdb to validate against case-sensitively, and Java's `ZoneId` resolution is case-sensitive. A database check on one side only would be a divergence.

  The backend strips the suffix syntactically (regex). It does **not** use `ZonedDateTime.parse`.

  This is a superset of what inference's `ISO_DATE_TIME` accepts with a suffix, with two exceptions noted in D3: a fraction dot with no digits, and a five-digit year. Every tzdb region id and every offset-style id (`+05:00`, `UTC+01:00`) uses only that character class, and inference only allows `Z|±HH:MM(:SS)` before `[`, which the D1 grammar covers.

  Pinned fixture cases:
  - accepted:
    - `2026-07-01T14:00:00+02:00[Europe/Paris]` → 12:00Z
    - `2026-07-01T17:00:00+05:00[Europe/Paris]` → 12:00Z (the written offset wins)
    - `2026-07-01T12:00:00Z[UTC]`
    - `2026-07-01T12:00:00+00[UTC]`
    - `2026-07-01 17:30:00+0530[Asia/Kolkata]`
    - `…+02:00[europe/paris]` and `…+02:00[Bogus/Zone]` (not validated, by design)
    - `…+05:00[+05:00]` and `…+01:00[UTC+01:00]`
  - null:
    - `2026-07-01T12:00:00[Europe/Paris]` (no offset)
    - `…+02:00[]`
    - `…+02:00[Europe Paris]`
    - `…+02:00[Europe/Paris` (unclosed)
    - `2026-07-01 12:00:00Z[UTC]` (space + Z)
    - `2026-07-01[UTC]` (bare date)

### D3. Cast keeps exactly the shared parser's set (alignment)

`isTimestampLike` becomes `TimestampParsing.parseInstant(raw).isDefined`, and the `looksLikeTimestamp` disjunct is dropped. After D1 and D2, the shared parser accepts every string inference does, except impossible calendar dates under inference's SMART `MM/dd/yyyy`. So the observable narrowing is that a cast now nulls `02/30/2026`-style values. It also nulls two exotic inference-accepted suffix forms the D2 regex rejects: a dot with no fraction digits (`…00.+02:00[Europe/Paris]`) and a five-digit year (`+12026-…+02:00[…]`). Every downstream reader already nulls all of these today, so nothing that worked breaks.

This is the alignment the owner chose with `widen-parser`. Keeping the old disjunction would leave exactly the divergence class this ticket exists to close: a kept value that downstream reads as null. A guard test enumerates the D1/D2 shapes through cast → datebucket and cast → `date_trunc` and asserts each is non-null on both sides.

**Alternative rejected:** making the parser's `MM/dd/yyyy` SMART to match inference exactly. That silently relocates impossible dates, and it diverges from the chart.

### D4. A numeric epoch casts to an ISO instant (both targets)

In the `date`/`timestamp` branch:
- When the raw value is **not a String** and the shared parser reads it as an epoch, emit `instant.toString`. Java's `Instant.toString` already gives `2026-02-17T00:00:00Z`, `…:00.123Z` when the milliseconds are non-zero, and longer fractions only if present.
- A numeric **string** and every other accepted string keep their original text (HEL-1436 keep-original), so string inputs see no change.
- The emitted ISO string is itself accepted by the shared parser, so the cast output round-trips through datebucket and compute.
- `date` emits the same instant string. It is not truncated to `yyyy-MM-dd`, per the owner ruling `iso-instant-both`.

To implement this, expose a small `TimestampParsing.epochInstant(value: Any): Option[Instant]`: the epoch half of `parseInstant`, including the D5 bound. Cast then never re-derives the epoch rule.

### D5. Epochs are bounded to 0001-01-01T00:00:00Z .. 9999-12-31T23:59:59.999999999Z

`fromEpoch` returns `None` when the resulting instant falls outside that closed range. The existing seconds/millis threshold still decides the unit first.
- `Long.MinValue` and `Long.MaxValue` (millis) become null.
- Ordinary epochs are unaffected; for example, 9999999999 seconds is the year 2286.

The frontend `parseChartInstant` applies the identical bound in place of today's `MAX_JS_DATE_MS` check. That check is a superset, so the new bound is strictly tighter and still within the JS Date range.

Boundary fixture cases:
- `-62135596800000` (millis) is 0001-01-01T00:00:00Z: accepted. Year 0001 is reachable only in milliseconds, because every |x| > 9999999999 is millis, so no seconds epoch is earlier than 1653.
- `-62135596800001` is one millisecond before it: null.
- `-62135596800` is read as **millis** (1968-01-12T20:06:43.200Z): accepted. This is pinned so the unchanged seconds/millis threshold is guarded.
- `253402300799999` (millis) is 9999-12-31T23:59:59.999Z: accepted.
- `253402300800000` is year 10000: null.
- `-9223372036854775808`: null.

### D6. The chart parser and the shared fixture move together

Update `parseChartInstant` for D1, D2 (region suffix; `MM/dd/yyyy` already present) and D5.

In the fixture:
- Flip the `MM/dd/yyyy` cases to `backendParseInstant: true`.
- Add cases:
  - space and `T` with `+00`, `+0530`, `-0330`, `+05:30`, `+05:30:15`
  - region suffix with an offset, and with `Z[UTC]`
  - a mismatched written offset with a region (`+05:00[Europe/Paris]` reads at +05:00)
  - `02/30/2026` → null
  - the D5 boundaries
- Keep the rejected cases (space+`Z`, bare region id).

`ChartTimestampParsingParitySpec`'s second test ("frontend-only extension cases") would then have an empty set and fail its `should not be empty`. Remove that test, and **drop the `backendParseInstant` field from every fixture case**. Both sides assert a minimum case count (at least the new total), so an accidentally truncated fixture still fails. The fixture becomes pure parity, and both the backend spec and `chartTimeAxis.test.ts` iterate every case. Update the spec's doc comment to say there is no frontend-only extension any more. This is an honest consequence of D2, not a weakened guard: the parity test still covers every case.

### D7. One disclosure-summary recipe in `shared/ui`

Add `frontend/src/shared/ui/disclosureSummary.css`, with a class `.disclosure-summary` (plus `[open]` handling via `details[open] > .disclosure-summary`):
- inline-flex
- `min-height: var(--control-sm)`
- `font-weight: var(--weight-medium)`
- muted color, with the full color on hover
- `cursor: pointer`
- radius
- a focus-visible ring
- an explicit chevron `::before` that rotates on `[open]`
- `list-style: none` plus `::-webkit-details-marker { display: none }`, so no native marker doubles up on any engine

The 44px floor comes from composing the existing `tap-expand-44` utility in the markup, not from re-implementing it. The chevron uses `::before` because `tap-expand-44` owns `::after`.

Both `ComputeFunctionReference.tsx` and `UsageCard.tsx` use `className="disclosure-summary tap-expand-44"`, plus their own block class only for layout-specific rules such as font size. The duplicated declarations are deleted from `PipelineDetailPage.css` and `UsageCard.css`.

`.tap-expand-44` sets `position: relative` on the element itself (tapTarget.css), so no parent change is needed. Do check that no ancestor's `overflow: hidden` clips the 44px expander on the usage card, and that the expander does not overlap a neighbouring control. The existing coarse-pointer `margin-top: var(--space-4)` rule for the compute reference stays; it is about the Expression input's overhang and is unrelated to the recipe.

Wire it globally the way `tapTarget.css` is: `import "./shared/ui/disclosureSummary.css";` in `frontend/src/main.tsx`, next to the existing `./shared/ui/tapTarget.css` import. It is a cross-feature utility class, not a component.

### D8. Functions list spacing

Set `.pipeline-detail-page__compute-functions-list { gap: var(--space-2) }`. The item's internal gap stays at `--space-1`.

## Risks / Trade-offs

- [First-run classifier now treats `MM/dd/yyyy` and Postgres-offset columns as date-like.] This builds a time-series where it previously built a table. → Intended, since those are dates. This makes `FirstRunPlannerSpec.scala`'s existing test "NOT treat an MM/dd/yyyy column as date-like, since datebucket cannot parse it" (line 29) wrong; invert it, since its stated reason no longer holds. Also make the `ColumnClassifier.scala` scaladoc (lines 32-33) false-free. The PR calls out the change. Note that CSV schema inference never types a column `timestamp` (HEL-893); do not claim this change fixes "CSV columns inferred as timestamp".
- [Cast nulls impossible `MM/dd/yyyy` dates it used to keep.] → A deliberate consequence of D3, called out in the spec delta and the PR. Such values were already null in every downstream reader.
- [Chart parity drift.] → The fixture is the single list, and both sides iterate it. A new shape cannot land on one side without the other's test going red.
- [Existing stored pipelines whose cast output was `"1.7712864E9"`.] → Outputs are recomputed on the next run. History points captured earlier keep the old text. Both forms parse, so no reader breaks.

## Migration Plan

None. This is a pure runtime behavior change, and rollback is a revert.
