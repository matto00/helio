## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Diff scope, from ground truth** (`git diff main...HEAD --stat`): only
  `DateBucketStep.scala`, `DateBucketStepSpec.scala` (new), `InProcessPipelineEngineSpec.scala`
  (one assertion), plus change-dir artifacts. No scope creep.
- **Variable-length fraction is real, not a fixed-width pattern.** Read the source: the formatter is
  `new DateTimeFormatterBuilder().appendPattern("yyyy-MM-dd HH:mm[:ss]").appendFraction(ChronoField.NANO_OF_SECOND, 0, 9, true).toFormatter()`.
  Re-verified in a **live JVM** (standalone `java T.java` replicating both formatters):
  `2026-07-01 12:00:00` / `12:00` / `.1` / `.123456` / `.123456789` all → `2026-07-01`;
  `2026-03-14T22:08:39` and `.1` / `.123456789` → `2026-03-14` via `ISO_LOCAL_DATE_TIME`;
  `not-a-date` and `2026-13-45 99:99:99` → FAIL on both (parser stays discriminate). The design-gate
  round-1 correction (1- and 6-digit fractions) is genuinely fixed, not merely re-described.
- **Ordering contract**: the two new branches sit after `Instant.parse`/`OffsetDateTime.parse` and
  before `LocalDate.parse` in the `orElse` chain — matches design.md decision 1. Confirmed by test
  ("already-offset-bearing string unchanged", "bare yyyy-MM-dd still matches").
- **Zero-parse-rate guard**: read `evaluate` directly — computes `nonBlankInputCount` (rows with a
  non-null, non-blank value at `config.field`) and `nonNullOutputCount` (bucketed rows with a
  non-null value at the resolved `outputColumn`), and fails via
  `Future.failed(new IllegalArgumentException(...))` only when `> 0 && == 0`. `outputCol` is
  resolved identically to `apply`'s (`config.outputColumn.filter(_.nonEmpty).getOrElse(config.field)`),
  so the count reads the right column. Empty input, all-absent/null/blank input, and
  partially-parseable input all take the success branch — covered by four explicit tests.
- **Tests assert VALUES, not "no exception"**: `DateBucketStepSpec` asserts literal bucket strings
  (`"2026-03-01"`, `"2026-04-01"`, `"2026-07-01"`, `"2026-03-14"`, `"2026-03-17"`), the ticket's own
  two-month repro as a *set* of two distinct buckets plus an explicit `null`-count of 0, and the
  partial-parse case asserts the good row's value AND the bad row's `null`. This is real evidence for
  a silent-wrong-answer bug class.
- **RED was real, and I derived it independently rather than trusting a transcript**: I re-ran main's
  exact pre-fix parse chain (`Instant.parse` → `OffsetDateTime.parse` → `LocalDate.parse`) in a live
  JVM against all four repro shapes — every one returns `null`. So every new value assertion in
  `DateBucketStepSpec` necessarily fails on main; the RED is structurally guaranteed by the code, not
  dependent on a captured log. Likewise, `InProcessPipelineEngineSpec`'s pre-existing assertion was
  `shouldBe null` on main and is now `intercept[IllegalArgumentException]` — the diff itself proves
  the guard changes behavior.
- **Tests green, run by me**: `sbt -batch "testOnly com.helio.domain.steps.DateBucketStepSpec com.helio.domain.engine.InProcessPipelineEngineSpec"` →
  `Tests: succeeded 184, failed 0, canceled 0` / `All tests passed.` (the stack traces in the log are
  the intentional unreachable-DB connector test's expected output, not failures).
- **`SchemaInferenceEngine.scala` untouched**: `git diff main...HEAD -- .../SchemaInferenceEngine.scala`
  returns empty. Sibling gap reported in design.md decision 3, not fixed — as required.
- **Acceptance criteria traced**:
  1. tz-less ISO parsing — `parseToUtcDate` branches + live JVM check + value-asserting tests. MET.
  2. UTC-vs-configured-timezone decided by the human, not assumed — design.md Context/Risks record the
     Planning escalation and the explicit option-(a)-over-(b)/(c) product-owner decision. MET.
  3. RED-then-GREEN on the exact repro shape — `"the two months from the ticket's own repro land in
     two distinct buckets"` asserts `Set("2026-03-01","2026-04-01")` and zero null buckets; RED
     independently reproduced above. MET.
  4. Sibling surfaces inventoried, not modified — design.md decision 3; diff confirms. MET.
- **UI review**: N/A — no `frontend/**` files in the diff, so no design-standard judgment applies.

### Verdict: CONFIRM

### Non-blocking notes
- The worktree's `scripts/concertino/` is a stale partial copy (no `next-report-number.sh`,
  `emit-event.sh`, `persist-evidence.sh`); I used the main repo's `scripts/concertino/`. Worth a
  glance at worktree provisioning, unrelated to this change.
- Follow-up ticket for the `SchemaInferenceEngine.isTimestamp` space-separator gap (design.md
  decision 3) still needs to be filed during Delivery — not a code defect here.
- The guard's failure message is good (names the field and the row count). Consider including one
  offending sample value in a future iteration to shorten diagnosis; not required.
