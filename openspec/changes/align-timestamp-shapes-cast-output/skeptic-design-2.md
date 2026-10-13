## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 000c1dfa5769d2e2418c2494922fdb35b8c1f2d5. The change dir is untracked; the artifacts were read from disk. JDK probes ran in jshell on openjdk 21.0.12.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/timestamp-cast-shape-followups/HEL-1502`.

**Round-1 revisions**

1. **CR1 (region suffix): addressed.**
   - D2 now defines one syntactic `[id]` grammar (`[A-Za-z0-9_+\-/:]+`), with no tzdb check and no `ZonedDateTime.parse`.
   - The spec delta states the same grammar.
   - All seven pinned classes from round 1 are listed as fixture cases.
   - Probed: every id in `ZoneId.getAvailableZoneIds()` matches the character class (the set of ids outside it is empty).
   - Inference's `ISO_DATE_TIME` accepts `Z[UTC]`, `+02:00[Europe/Paris]`, `+05:30:15[UTC]`, `[UT+01:00]` and the lowercase `t…z[UTC]`. Every one of these is inside the D2 grammar.
   - So the superset premise D3 depends on holds.
2. **CR2 (offset grammar): substantially addressed. One required negative case was dropped (CR3 below).**
   - Every D1 JDK claim reproduces. On the T form, `OffsetDateTime.parse` accepts `+05`, `+05:30`, `+05:30:15`, `+18:00`, `-00`, `+00`, `+00:00:00` and `-00:00`.
   - It rejects `+0530`, `+053015`, `+18:30`, `+18:00:01`, `+5`, `+05:3`, `+19`, `+1800`, `+05:3015`, `+0530:15` and `+05:30:1`.
   - `Instant.parse` accepts a strict subset of those.
   - So "today's T-form set plus ±HHMM" is accurate.
   - The frontend `offsetSeconds` total ≤ 64800 tightening is specified.
3. **CR3 (first-run artifacts): addressed.**
   - Task 3.1 names `FirstRunPlannerSpec.scala` (the test is at line 29, confirmed) and the `ColumnClassifier.scala` scaladoc (lines 32-33, confirmed).
   - The classifier reads through `DateBucketStep.parseNonEpochDate`, which calls `TimestampParsing.parseNonEpochInstant` (DateBucketStep.scala:137-138), so the widening reaches it.
4. **CR4 (D7 positioning and wiring): addressed.**
   - The stray-parent `position` sentence is corrected.
   - The global import sits next to `main.tsx:14` `import "./shared/ui/tapTarget.css"` (confirmed).
5. **CR5 (C2 attribution): addressed** in design.md and tasks.md C2.

**Other claims checked fresh**

- **`MM/dd/uuuu` STRICT.** Accepts `07/01/2026` and `02/29/2024`. Rejects `02/30/2026`, `00/01/2026`, `01/05/12026` and `1/5/2026`.
- **Cast scenario.** `1771286400` is 2026-02-17T00:00Z, and `Instant.toString` of `…400123` ms renders `.123Z`.
- **Agreement scenario.** `1782907200` is 2026-07-01T12:00Z.
- **Probes that falsified two spec-delta scenarios.** They are below.

### Verdict: REFUTE

### Change Requests

1. **The D5 lower-boundary cases are wrong. The seconds/millis threshold turns them into millisecond epochs in 1968.**
   - **Where:** design.md D5 ("`-62135596800` (seconds) is 0001-01-01T00:00:00Z: accepted" and "`-62135596801` … null"); `specs/timestamp-value-parsing/spec.md`, scenario "epochs outside years 0001-9999 are not timestamps" ("the fourth [buckets] to `"0001-01-01"`"); tasks.md 1.1; and the fixture cases planned in 4.1.
   - **Why:** `fromEpoch` (TimestampParsing.scala:67-68) and `parseChartInstant` both read any epoch with `|x| > 9999999999` as **milliseconds**, and `-62135596800 < -9999999999`.
   - **Probed:** `Instant.ofEpochMilli(-62135596800L)` is `1968-01-12T20:06:43.200Z`, so both values are accepted, as 1968. The most negative seconds epoch is `-9999999999` = `1653-02-10T06:13:21Z`, so year 0001 is only reachable as milliseconds: `Instant.parse("0001-01-01T00:00:00Z").toEpochMilli()` is `-62135596800000`.
   - **Effect as written:** a RED test that can never go green without changing the unit threshold. An executor may "fix" that by altering the threshold, which is an unruled behavior change.
   - **Required:**
     - Replace the lower-boundary pair with `-62135596800000` (accepted, 0001-01-01T00:00:00Z) and `-62135596800001` (null) everywhere listed above, including the spec scenario's expected bucket.
     - Optionally keep `-62135596800` as an accepted case pinned to `1968-01-12T20:06:43.200Z`, so the threshold itself is guarded.
     - State in D5 that the lower bound only ever binds for millisecond epochs.

2. **The `seconds_between` Postgres-offset scenario has the wrong sign.**
   - **Where:** `specs/timestamp-value-parsing/spec.md`, scenario "Postgres timestamptz text is read at its offset", and tasks.md 1.3 ("(5400)").
   - **Why:** the base spec defines `seconds_between(end, start)` = `end - start` (`openspec/specs/compute-expression-language/spec.md:445`), and the code is `Duration.between(start, end)` (ExpressionDateTimeFunctions.scala:42-47).
   - **Arithmetic:** end `2026-07-01 12:00:00+00` = 12:00Z; start `2026-07-01 12:00:00-0130` = 13:30Z. So the result is **−5400**, not 5400.
   - **Required:** either change the expected value to `-5400`, or swap the arguments so 5400 is correct. Update task 1.3 to match.

3. **One CR2 negative from round 1 was not carried into D1.**
   - Round 1 required space + `+0530:15` (the HHMM-then-`:SS` hybrid).
   - D1's negative list (`+18:30`, `+18:00:01`, `+053015`, `+5`, `+05:3`, `+19`) omits it.
   - It is exactly the case where a hand-rolled frontend `split(":")` or a lenient `HHMM(:SS)?` regex could diverge.
   - **Required:** add `+0530:15` (both separators) to the D1 fixture negatives and to tasks 1.1 / 4.1 / 4.2.

### Non-blocking notes

- **Pre-existing backend/chart divergences that D2's backend prefix inherits.**
  - D2 defines the backend suffix prefix as "any string the D1 reader or the existing `Instant`/`OffsetDateTime` readers accept". The frontend prefix is only the D1 grammar.
  - Probed, the existing backend readers accept three shapes the chart rejects:
    - a trailing-dot fraction: `2026-07-01T12:00:00.Z` and `…00.+05:00`;
    - a leap second via `Instant.parse`: `2026-06-30T23:59:60Z` reads as 23:59:59Z;
    - extended years: `+12026-07-01T12:00:00Z`.
  - With D2, these also become accepted on the backend only in their `[id]` form.
  - They predate this change and are outside the ticket. They do contradict the Goals line "The chart time axis reads exactly the instants the backend reads" and the spirit of C3.
  - Either narrow the backend suffix prefix to the same grammar the frontend uses, or file a Follow-up (relatedTo HEL-1502) to pin these in the fixture and soften the Goals wording.
- **`-00`/negative offsets.** `ZoneOffset.ofHoursMinutesSeconds` requires every component to have the same sign. For `-0330`, the executor must negate hours, minutes and seconds alike. The `-0330`/`-1800` fixture positives will catch a slip.
- **Carried from round 1.** In the PR body, call out that cast now nulls `02/30/2026`, and that first-run builds a time-series for `MM/dd/yyyy` and Postgres-offset columns. Do not claim that CSV inference types columns `timestamp`.
