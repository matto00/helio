## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `f63ab8365d2b0e6cac36154a83437b6d26b3a209`. The change directory is untracked, so I read it as it is in the worktree.

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/align-timestamp-parse-edge-cases/HEL-1532`.
- **Files read:**
  - ticket.md, proposal.md, design.md, tasks.md and the spec delta.
  - The base `openspec/specs/timestamp-value-parsing/spec.md` and skeptic-design-1.md.
  - `TimestampParsing.scala` (whole file).
  - `chartTimeAxis.ts` (parser section).
  - All 99 fixture inputs.
- **Backend replica, with D2 implemented literally (`P.java`, scratchpad, JDK).** The replica copies the backend's exact reader order, `OffsetDateTimeRegex`, STRICT `MM/dd/uuuu`, and the old and new (STRICT `uuuu`) space formatters. I implemented D2's gate word for word:
  - the written-year rule only for values matching `^[+-]?\d+-`, plus a separate `^\d{2}/\d{2}/\d{4}$` year≠0000 rule;
  - a time field running from the first `T`/`t`/space to the first `Z`/`z`/`+`/`-`/`[`;
  - inside that field: `.` must be followed by a digit, a fraction needs `HH:mm:ss`, and hour `24` and seconds `60` are rejected.
- **No over-rejection.** I ran the replica old vs new on all 99 fixture inputs: **0 changed results**.
  - That includes `07/01/2026`-style US dates, `[+05:00]`/`[UTC+01:00]` ids, `+18:00`/`-1800` offsets, lowercase `t…z`, and padded whitespace.
  - The boundary positives D4 adds stay accepted: `0001-01-01`, `9999-12-31 23:59:59.999`, `2024-02-29 12:00`, `2026-07-01T23:59:59Z`, `2026-07-01 00:00`.
  - The written-year examples also stay accepted: `0001-01-01T00:30:00+01:00` and `9999-12-31T23:00:00-05:00`.
  - `+2026-…` (sign with a 4-digit year) is rejected by the backend today as well, so the gate's "no sign" rule changes nothing there.
- **Every intended reject class flips to null on the backend:**
  - empty fraction: `….Z`, T-local `…00.`, space `…00.`;
  - leap second: `:60Z` and `:60+02:00`;
  - extended years: `+12026` (Z and local) and `-0001`;
  - year 0000: `0000-…Z`, `0000-07-01T12:00`, `0000-07-01`, `07/01/0000`;
  - impossible date: `2026-02-29 12:00`, rejected by STRICT `uuuu`;
  - hour 24: `2026-07-01 24:00` and `…T24:00:00Z`.
  - `0000-07-01 12:00` is accepted by the new STRICT `uuuu` reader on its own, but the gate stops it first. This confirms D2's "gate before every reader" ordering is needed.
- **Chart, with D3 applied to a scratch copy of `chartTimeAxis.ts`** (`y < 1` in `utcMillis`, plus a LOCAL-branch check that rejects a fraction without seconds), run under `node --experimental-strip-types`:
  - All 99 fixture inputs: **0 changed results**.
  - Changed: `0000-…` (all four ISO shapes), `07/01/0000`, `2026-07-01 12:00.5` and `2026-07-01T12:00.5`, all now null.
  - Unchanged: everything else. Positives keep the same epoch millis as the backend replica: `-62135598600000` for the year-0001+01:00 case and `253402315200000` for the year-9999−05:00 case.
- **No new backend/chart split:** after both planned changes, every probe gives the same result on both sides (same instant, or both null).
- **The round-1 change requests are resolved:**
  1. **Resolved.** D2 has an explicit `MM/dd/yyyy` year≠0000 rule. D3's `y < 1` covers US_DATE. `07/01/0000` appears in the D1 table, in D4 and in the spec-delta reject scenario.
  2. **Resolved.**
     - The gate is anchored to `[+-]?\d+-`, and the leading-year rule is explicitly never applied to `MM/dd/yyyy`.
     - The time-field checks never read offsets or `[id]`s.
     - The replica run above confirms this.
  3. **Resolved.**
     - The D1 table now lists the tz-less empty fractions.
     - The year-0000 row now says which side accepts which form.
     - D2 says the gate runs before every reader, which is needed for STRICT `uuuu`.
     - D4 adds `0000-07-01`, `0000-07-01T12:00` and both tz-less empty fractions.
- **Rulings:** A1-A6 all reject. None of them conflicts with accept-postgres-offsets, widen-parser, iso-instant-both or bound-epoch-range: every accepted postgres-offset and widened shape in the fixture is unchanged.
- **D5 ground truth:**
  - `chartTimeAxis.test.ts:33` asserts `>= 98`.
  - `ComputeStepSpec.scala` and `DateBucketStepSpec.scala` exist under `backend/src/test/scala/com/helio/domain/steps/`.
  - Neither of those files is in `gh pr diff 996/986 --name-only`, and neither is `TimestampParsing.scala` or `chartTimeAxis.ts`. C1 can be met.

### Verdict: CONFIRM

### Non-blocking notes

- The spec delta says "A year outside 0001..9999 … in any non-epoch shape". It does not say this is the WRITTEN year, so it could be read as the instant year. That reading would wrongly reject `0001-01-01T00:30:00+01:00` and `9999-12-31T23:00:00-05:00`, which D1 keeps. Suggested fixes:
  - Add "written" to that sentence.
  - Pin both strings as fixture positives (round 1 also suggested this). They are not in D4's list.
- A6: D1's example covers only the space form. Also pin `2026-07-01T12:00.5`. The chart accepts it today and D3 changes it.
- Two cheap negatives would guard the gate's ordering: `2026-07-01T24:00` (no offset) and `2026-07-01T12:00:60.5Z`.
