## 1. Red evidence (write and capture failing FIRST, against current main)

- [x] 1.1 Write `DateBucketStepSpec` tests (or extend the existing test file if one exists) for:
      T-separated tz-less timestamp buckets to expected month/day (currently fails — asserts `null`
      today, must assert real value); space-separated tz-less timestamp buckets correctly (currently
      fails); fractional-seconds T-separated and space-separated forms bucket correctly at 1-digit,
      3-digit, and 6-digit (microsecond) widths (currently fail — 6-digit microseconds are the
      Postgres/pandas default and must not be silently dropped by a fixed-width fraction pattern);
      a genuinely-unparseable row still yields `null` for that row **when at least one other row in
      the same input parses successfully** (a partially-parseable input, e.g.
      `[{"ts": "2026-03-17T00:00:00Z"}, {"ts": "not-a-date"}]"` — should already pass, proves the
      parser stays discriminate). Do NOT test a *lone* unparseable row here — under §3.1's guard
      that now fails execution instead of nulling (see §3.2), so a single-row all-unparseable case
      belongs in §3.2, not here.
- [x] 1.2 Run the suite against the unmodified `DateBucketStep.scala`, capture the RED output
      (failing assertions on the new-shape tests) as evidence before making any source change.

## 2. Fix — accepted-shape parsing

- [x] 2.1 Add `LocalDateTime.parse(str, DateTimeFormatter.ISO_LOCAL_DATE_TIME)` (T-separated,
      optional fractional seconds) to `parseToUtcDate`'s `orElse` chain, after the
      `OffsetDateTime.parse` branch and before the bare-`LocalDate` branch, mapped to UTC via
      `.atZone(ZoneOffset.UTC).toLocalDate`.
- [x] 2.2 Add a second `orElse` branch using a `DateTimeFormatterBuilder`-constructed formatter for
      the space-separated form: `appendPattern("yyyy-MM-dd HH:mm[:ss]")` plus
      `.appendFraction(ChronoField.NANO_OF_SECOND, 0, 9, true)` for a **variable-length** (0–9
      digit) fractional-seconds component — NOT a fixed `[.SSS]` literal pattern, which requires
      exactly 3 digits and silently rejects both 1-digit and 6-digit (microsecond) fractions,
      reintroducing the all-null bug for the most common real-world width. Same UTC mapping.
- [x] 2.3 Re-run the tests from 1.1 — the new-shape assertions should now pass (GREEN); capture this
      as the green evidence paired with 1.2's red capture.

## 3. Fix — zero-parse-rate execution-failure guard

- [x] 3.1 In `DateBucketStep.evaluate`, after computing the bucketed rows via `apply`, count (a) how
      many input rows have a non-blank value at `field`, and (b) how many of the bucketed rows have
      a non-null value at the resolved output column. When (a) > 0 and (b) == 0, return
      `Future.failed(new IllegalArgumentException(...))` (the same failure mechanism `evaluate`
      already uses for an unsupported `granularity`) instead of the successful result — do NOT use
      `validationError`; it is an analyze-time-only, schema-only concept
      (`PipelineAnalyzeService`/`PipelineAnalyzeProtocol`) with no row-level access and no execution
      failure semantics, so it cannot implement this guard.
- [x] 3.2 Add tests: all-unparseable non-empty input triggers the guard (execution fails,
      including the single-row case `[{"ts": "not-a-date"}]`); empty input does not; all-field-absent
      input does not; partially-parseable input does not (still nulls the unparseable rows, doesn't
      fail the step). Capture a RED run first showing the all-unparseable case currently succeeds
      silently with all-null output (proving the guard actually changes behavior, not just
      re-describing already-passing behavior).
- [x] 3.3 **Update the existing test** `"datebucket: unparseable value yields null"` at
      `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineSpec.scala:489-495`.
      That test currently runs a single-row, all-unparseable input (`[{"ts": "not-a-date"}]`)
      through the full engine and asserts `null` output — this is now precisely the case the new
      guard makes fail. This assertion-behavior change is **expected and intentional** (the whole
      point of the guard), not a regression to work around: change the test to assert that
      execution now fails (matching whatever run-failure assertion idiom this spec file already
      uses elsewhere, e.g. for the unsupported-granularity test at line ~497), or move a
      still-nulls-a-lone-row assertion to a genuinely partially-parseable input if this spec file
      wants to keep a null-output case at all. Do not weaken or bypass the new guard to keep this
      test's original assertion passing unchanged.

## 4. Verification and evidence (systematic-debugging / verification-before-completion laws)

- [x] 4.1 Assert bucketed VALUES in every new/modified test (not "no exception" / "step ran") —
      rows land in the expected bucket, null-bucket count is zero for parseable input.
- [x] 4.2 Run the full backend test suite (`sbt test`) and confirm no *unintended* regression in
      existing `DateBucketStep`/`pipeline-date-bucket-op` coverage. The one intentional exception is
      `InProcessPipelineEngineSpec.scala`'s `"datebucket: unparseable value yields null"` test,
      updated per §3.3 above — that assertion change is expected, not a regression; every other
      existing `datebucket` test should still pass unmodified.
- [x] 4.3 Exercised the ticket's own CSV repro shapes (`2026-03-14T22:08:39`, `2026-04-02T11:30:00`)
      as an "equivalent pipeline run" via `DateBucketStepSpec`'s
      `"the two months from the ticket's own repro land in two distinct buckets"` test, confirming
      2 distinct month buckets (`2026-03-01`, `2026-04-01`) and zero null-bucket count. Ran against
      `sbt test`'s per-suite ephemeral `EmbeddedPostgres` instance, not the shared dev DB — no
      pipeline/step/type/data-source rows were created against the shared instance, so there is
      nothing to clean up there (avoids the dev-DB-sharing hazard entirely rather than needing
      post-hoc cleanup verification).

## 5. Documentation

- [x] 5.1 Update `DateBucketStep.scala`'s doc comments (`parseToUtcDate`'s Scaladoc enumerates
      exactly three forms today) to describe the newly-accepted shapes.
- [x] 5.2 PR description explicitly notes: bucketed outputs will change for any pipeline whose
      `datebucket` input is tz-less, so it can be spot-checked post-deploy (product-owner
      instruction — no pre-merge inventory required).
