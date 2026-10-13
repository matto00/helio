## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `f63ab8365d2b0e6cac36154a83437b6d26b3a209` (the change directory is untracked; I read it as it is in the worktree).

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/align-timestamp-parse-edge-cases/HEL-1532`.
- **Read:** ticket.md, proposal.md, design.md, tasks.md, the spec delta, the base `openspec/specs/timestamp-value-parsing/spec.md`, `TimestampParsing.scala` (the whole file), `chartTimeAxis.ts` (parser section), and all 99 inputs in `shared-test-fixtures/chart-timestamp-parsing.json`.
- **Backend probe.** I wrote a standalone Java replica of `parseNonEpochInstant`, using the same reader order, the same `SpaceSeparatedFormatter`, the same `OffsetDateTimeRegex` and the same STRICT `MM/dd/uuuu`, and ran it on JDK 21. I also ran a candidate STRICT `uuuu` space formatter (D2) next to it. Results:
  - Empty fraction:
    - `2026-07-01T12:00:00.Z`: accepted (Instant.parse).
    - `2026-07-01 12:00:00.`: accepted (Space reader). It is still accepted under the STRICT `uuuu` formatter.
    - `2026-07-01T12:00:00.`: accepted (ISO_LOCAL_DATE_TIME).
    - The chart rejects all three.
  - Leap second:
    - `T23:59:60Z` and `T23:59:60+02:00` are both accepted, folded to `:59`.
    - `T12:30:60Z` is rejected.
  - Extended years: `+12026-…Z`, `+12026-…T12:00:00` (local) and `-0001-…Z` are all accepted.
  - Year 0000:
    - `0000-…T12:00:00Z`, `0000-07-01T12:00`, `0000-07-01` and `07/01/0000` are all accepted.
    - `0000-07-01 12:00` is rejected today (SMART `yyyy`) but is accepted by the planned STRICT `uuuu` formatter.
  - Impossible dates and hour 24:
    - `2026-02-29 12:00` is clamped to 02-28.
    - `2026-07-01 24:00` rolls to 07-02.
    - `T24:00:00Z` is accepted (Instant.parse).
    - `T24:00`, `T24:00+00:00` and `24:00+00` are rejected.
  - Fraction without seconds: `12:00.5` is rejected by the backend with both separators.
- **Chart probe.** I ran the real `parseChartInstant` from the worktree file under `node --experimental-strip-types`:
  - The chart accepts `0000-…Z`, `0000-07-01 12:00`, `0000-07-01`, `07/01/0000`, `2026-07-01 12:00.5` and `2026-07-01T12:00.5`.
  - It rejects every other probe above.
  - `0001-01-01T00:30:00+01:00` gives year 0000 on both sides.
  - `9999-12-31T23:00:00-05:00` gives year 10000 on both sides.
- **Context claims:** confirmed except where the next three points correct them.
  - Missing from Context: the empty-fraction class also affects tz-less local strings on both separators (`…T12:00:00.` and `…12:00:00.`). It is not limited to `….Z`.
  - Year `0000` is accepted by the backend today in the bare-date, T-local, Instant and `MM/dd/yyyy` shapes. It is not a "chart-only" class, except for `0000-07-01 12:00`.
  - `MM/dd/yyyy` with year 0000 (`07/01/0000`) is accepted by BOTH sides today.
- **Can D2 over-reject?** Two problems:
  - The gate's wording reads "a string whose leading date year is not exactly 4 digits". Taken literally, it rejects every `MM/dd/yyyy` input, because the leading token is `MM`. That would break the fixture cases `10/01/2026` and `12/31/2025`, and the spec's `07/01/2026` scenario.
  - The fixture also contains `[+05:00]` and `[UTC+01:00]` id suffixes and `+18:00`-style offsets. Any `:60` or hour-`24` scan must anchor on the time field, not search the whole string.
  - C4 (every existing case keeps its result) would catch these during execution. The ambiguity in the wording is still a design defect, because the same sentence also decides the gap below.
- **Is the spec delta consistent?** It replaces the base spec's "0–9-digit" fraction with "1-9" and adds a no-clamp/no-fold paragraph and a reject scenario. Both are consistent with D1, and no binding ruling is contradicted. The one inconsistency is the next finding.
- **D5 ground truth:**
  - The `MM/dd/yyyy` row does sit in `unchanged` (DateBucketCharacterisationSpec.scala:35).
  - The fixture counts are 99 (backend) and 98 (chartTimeAxis.test.ts:33).
  - `Bogus/Zone` and `253402300799999` appear only in `TimestampParsingSpec`, not in any step spec. This confirms that D5's step-level tests are new.

### Verdict: REFUTE

### Change Requests

1. **D2/D3 and the spec delta disagree on `MM/dd/yyyy` year 0000. As written, the plan creates a new chart/backend disagreement.**
   - The spec delta says "A year outside 0001..9999 … in any non-epoch shape is not a timestamp."
   - D3's `utcMillis` `y < 1` guard makes the chart reject `07/01/0000` (the US_DATE branch also goes through `utcMillis`).
   - D2's gate checks only the "leading date year". The backend's STRICT `MM/dd/uuuu` reader accepts year 0 (probe: `07/01/0000` → `US=0000-07-01`). After this change the backend would still bucket `07/01/0000` while the chart drops it, which breaks the change's own goal.
   - Neither D4's fixture list nor the spec delta's scenario pins `07/01/0000`, so nothing in the plan would catch it.
   - Revise D2 to state exactly how the year bound applies to the `MM/dd/yyyy` shape, for example by filtering the US-date result to year ≥ 1. Add `07/01/0000` to D1's year-0000 row, to D4's fixture cases and to the spec delta's reject scenario.
2. **Make the D2 gate unambiguous so it cannot over-reject.** State that the year/fraction/time checks apply only to strings that start with a date of the form `[+-]?\d+-` (an ISO-like date). Strings that do not start that way, such as `MM/dd/yyyy`, must pass through untouched apart from the year check in item 1. State that the `:60` and hour-`24` checks read the time field after the date separator, never text inside an offset or a `[id]`. The fixture has `[+05:00]` and `[UTC+01:00]` ids and `+18:00`-style offsets.
3. **Correct the class inventory in D1 and the Context section to match the probe.**
   - Empty fraction also covers the tz-less locals `2026-07-01T12:00:00.` and `2026-07-01 12:00:00.`. Both are backend-accepted and chart-rejected today. STRICT `uuuu` does NOT reject the space form, so the gate must. Add both to D4's fixture.
   - Year 0000 is accepted by the backend today in the T-local, bare-date, Instant and `MM/dd/yyyy` shapes. Only `0000-07-01 12:00` is chart-only, and the planned STRICT `uuuu` switch would make the backend start accepting it. The gate must therefore run before that reader, and D2 should say so.
   - Add fixture cases for `0000-07-01` and `0000-07-01T12:00`. Without them C3's red-first proof does not cover the actual backend-accept paths.

### Non-blocking notes

- Pin `0001-01-01T00:30:00+01:00` (D1's written-year example, which both sides accept today as year-0000 UTC) as a fixture positive, so the written-year decision is enforced rather than only described.
- Both parsers handle hour 24 under an offset (`T24:00+00:00`) and `:60` outside `23:59` the same way today (rejected). One negative fixture case for each would be cheap insurance against the gate's ordering.
- A1-A6 as assumed product calls are consistent with the binding rulings (all reject; none conflicts with accept-postgres-offsets, widen-parser, iso-instant-both or bound-epoch-range). I am not refuting them.
