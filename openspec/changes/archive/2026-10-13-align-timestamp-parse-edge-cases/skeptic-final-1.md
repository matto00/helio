## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `07b05585101566913ea6bcab40bc2387a5c10505`. The base was resolved live with `resolve-review-base.sh` (exit 0) to `f63ab8365d2b0e6cac36154a83437b6d26b3a209`. There is one commit on the branch. The only untracked file is `evaluation-1.md`.

### What I verified (with evidence)

**Differential fuzz: does the backend agree with the chart?** I ran both parsers on the same inputs, independently of the executor's 60k run and the evaluator's 45 hand-picked inputs.
- **How I ran each side.**
  - Backend: the worktree's compiled `TimestampParsing` (classes recompiled by my own `sbt testOnly`), called through a small Java harness.
  - Chart: `frontend/src/utils/chartTimeAxis.ts`, transpiled with the worktree's own `typescript`, run under node.
  - Comparison: epoch millis, or `null`.
- **Corpus 1: 300,000 inputs** (seed 1).
  - Sources: all fixture inputs; structured mutations across every D1 class; 1-3 character mutations of fixture seeds; random strings over `0-9-:Tt Zz+./[]_,eE`.
  - Shapes covered: years `0000`/`+12026`/`-0001`/`12026`/`202`/`20266`, months and days 00-99, hours 24/25, `:60`/`:61`, the fractions `.` `,5` `.5.5` `..5` and a 10-digit fraction, separators `T t space double-space tab _`, offsets up to `+24:00`/`+05:30:60`, bracketed ids including `[]`, and surrounding whitespace and tabs.
  - **Result: 0 disagreements** (6,243 accepted by both).
- **Corpus 2: 300,000 inputs leaning towards accepted values** (seed 7).
  - Shapes covered: years 0000-9999 including the edges near 0001 and 9999, every month and day up to 31, hour 24, `:60`, 1-9-digit fractions, the empty fraction, and 17 offset/id forms. Examples: `-12:00` near year 0001, and `+14:00` near 9999.
  - **Result: 0 disagreements** (144,851 accepted by both, at identical millis).
- **Sanity check that the harness ran the new code.** On both sides, `2026-02-29 12:00`, `2026-07-01T23:59:60Z` and `0000-07-01` give `null`. `9999-12-31T23:00:00-05:00` gives 253402315200000 and `0001-01-01T00:30:00+01:00` gives -62135598600000.

**Does any shape the spec still accepts now read null?** I compiled the base-commit `TimestampParsing.scala` (`git show f63ab8365:...`) separately with scalac 2.13.15 and ran the same 600,000 inputs through the old and new backend.
- 30,170 inputs are now rejected. **Every one** falls into a ticket class, under an independent Python classifier:
  - year: 26,803, plus 693 with a US year
  - leap second: 1,432
  - empty fraction: 567
  - hour 24: 107
  - impossible/clamped date: 42
  - the remaining rejections combine these classes
- Zero rejected inputs were UNCLASSIFIED.
- Nothing newly accepted (0). No instant changed for any value both versions accept (0).

**Acceptance criteria**
1. **Every disagreement class has a decision and a pinned case; parity holds on both sides.**
   - design.md D1 records a decision for all seven classes (A1-A6), plus A7 (`07/01/+12026`).
   - The fixture has 125 cases, up from 99. The fixture diff has 0 removed lines.
   - `ChartTimestampParsingParitySpec` passed in my `sbt testOnly` run.
   - `chartTimeAxis.test.ts` passed: jest `--testPathPatterns='chartTimeAxis|chartTimePlan|chartOverlayOption'` ran 2 suites, 728 tests, 0 failures, with `HELIO_JEST_MAX_WORKERS=3` and `nice -n 19`.
2. **The minimum case count is the same on both sides.** Both assert `>= 125`: `ChartTimestampParsingParitySpec.scala:23` and `chartTimeAxis.test.ts:33`. That matches the real count of 125.
3. **The `MM/dd/yyyy` row moved.** It left `unchanged` (removed line in the diff) and is now in `widenedByHel1502`, run as `"change ... (was null)"` (`DateBucketCharacterisationSpec.scala`).
4. **The step-level tests exist.**
   - `ComputeStepSpec`: `date_trunc("hour", $ts)` over `+05:00[Europe/Paris]` and `+02:00[Bogus/Zone]` gives `2026-07-01T12:00:00Z`.
   - `DateBucketStepSpec`: `253402300799999` gives `9999-12-31` and `-62135596800000` gives `0001-01-01`.
   - Both suites passed.

**Consumers cannot regress.** These all read through `parseInstant` / `parseNonEpochInstant` (`grep`):
- cast (`CastStep.scala:98-99`)
- datebucket (`DateBucketStep.scala:132,138`)
- compute (`ExpressionDateTimeFunctions.scala:36-37`)
- window day frames (`WindowRolling.scala:25` via `DateBucketStep.parseToUtcDate`)
- `ColumnClassifier` (`ColumnClassifier.scala:56` via `parseNonEpochDate`)

The old-vs-new diff above shows the only behaviour change is that the seven classes now read null. Cast keeps the original string only when `parseInstant` accepts it, so a value cast keeps is still readable by every downstream reader.
- `sbt testOnly 'com.helio.domain.*' 'com.helio.services.firstrun.*'` (`-J-Xmx3g`, `nice -n 19`): 128 suites, 2,544 tests, 0 failed, `[hel1468-guard] failed=0 aborted=0`.
- An earlier targeted run of the 6 changed specs plus cast specs: 7 suites, 311 tests, 0 failed.

**Constraints**
- C2: `looksLikeTimestamp` is untouched in the diff.
- C4: the fixture has 0 removed lines. The only removed characterisation row was re-added in its new group with the same expected value.
- C5: `passesGate` is the first condition in `parseNonEpochInstant` (`TimestampParsing.scala:117`), before every reader.

**UI.** No view, component or style changed. The frontend change is confined to the pure function `parseChartInstant`/`utcMillis`, whose consumers already handle `null`. There was nothing visual to judge, so I started no servers and took no screenshots.

**Evidence that is not self-authenticating:** none. Nothing in this report relies on mtime ordering.

### Verdict: CONFIRM

### Non-blocking notes
- **For the OWNER REVIEW section.** The compute date functions can now emit a string the shared parser rejects. Probed old vs new:
  - `add_days("9999-12-31", 1)` formats as `+10000-01-01T00:00:00Z`.
  - `add_days("0001-01-01", -1)` and `date_trunc("day", "0001-01-01T00:30:00+01:00")` format as `0000-12-31T00:00:00Z`.
  - The base parser read both strings; this branch reads both as `null`, so a downstream datebucket, compute or cast of such an output becomes null.
  - This is consistent with the spec's written-year rule and the chart agrees, so there is no parity break. It is an emergent consequence of D1's "written year, not instant year" detail: `0001-01-01T00:30:00+01:00` is accepted, but its own canonical ISO rendering is not.
  - The values are absurd-edge, but the owner should see it alongside A5.
- The evaluator's cosmetic notes stand: duplicated year predicate at `TimestampParsing.scala:72-73`, the misaligned `case _` at line 88, and a 159-column doc line in `chartTimeAxis.ts`.
- Differential evidence for the PR body: 600,000 generated inputs, 0 disagreements (151,094 accepted by both). Old vs new backend: 0 gained, 0 instants changed, and all 30,170 losses fall in the ticket's classes.
