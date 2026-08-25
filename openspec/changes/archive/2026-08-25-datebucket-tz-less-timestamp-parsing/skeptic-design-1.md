## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **java.time claims — re-verified independently on this machine's JVM** (`java T.java`, scratchpad `T.java`):
```
ISO T no frac        => OK 2026-03-14T22:08:39
ISO T frac           => OK 2026-03-14T22:08:39.123
ISO default parse space => FAIL Text '2026-07-01 12:00:00' could not be parsed at index 10
ISO on bare date     => FAIL Text '2026-03-14' could not be parsed at index 10
OffsetDateTime on tzless => FAIL ... at index 19
Instant on tzless    => FAIL ... at index 19
pat space secs       => OK 2026-07-01T12:00
pat space nosecs     => OK 2026-07-01T12:00
pat space frac(.123) => OK 2026-07-01T12:00:00.123
pat space frac(.1)     => FAIL Text '2026-07-01 12:00:00.1' could not be parsed, unparsed text found at index 19
pat space frac(.123456)=> FAIL Text '2026-07-01 12:00:00.123456' could not be parsed, unparsed text found at index 23
```
   The design's core claim (ISO_LOCAL_DATE_TIME accepts T-separated tz-less, rejects space-separated) is **accurate**. The design's *literal proposed pattern* is **not** adequate — see CR 1.

2. **Chain-placement correctness** — read `DateBucketStep.parseToUtcDate` (backend/src/main/scala/com/helio/domain/steps/DateBucketStep.scala:110-125). The chain is `epoch → Instant.parse → OffsetDateTime.parse → LocalDate.parse`. Inserting the two LocalDateTime attempts after `OffsetDateTime.parse` and before `LocalDate.parse` is **correct and non-regressing**: tz-carrying strings are consumed by the earlier branches (proved above they never reach the new ones), and `ISO_LOCAL_DATE_TIME` provably rejects a bare `2026-03-14`, so `LocalDate.parse` still owns that shape.

3. **`validationError` mechanism — checked against ground truth, and the design is wrong about it.** `grep -rn validationError backend/src/main` returns hits **only** in `PipelineAnalyzeService.scala` and `PipelineAnalyzeProtocol.scala`. Read `inferSplitText` (PipelineAnalyzeService.scala:201-222): it returns `(Vector[SchemaField], Option[String])` — a schema-only, **analyze-time advisory** that passes the schema through unchanged and *never fails execution*. See CR 2.

4. **MODIFIED requirement carry-forward** — diffed the change delta's MODIFIED requirement against `openspec/specs/pipeline-date-bucket-op/spec.md`. All original prose clauses and all 9 original scenarios are carried forward verbatim, plus 2 new scenarios. Carry-forward is **complete**. However the carried-forward null-on-failure clause now contradicts the ADDED requirement — see CR 3.

5. **Guard's three "SHALL NOT fire" cases** — traced against `DateBucketStep.apply` (line 88-99). Empty input / all-field-absent / partial are each correctly enumerated, and the all-field-absent scenario's expected output (`{"ts": null}` per row) matches what `row + (outputCol -> null)` actually produces when `outputColumn` is absent (`outputCol == field`). Per-row null-on-partial-failure parity with `CastStep` is genuinely preserved by the stated condition. Specification of the three cases is **correct and complete**; only its failure *mechanism* is unimplementable as written.

6. **Non-Goals** — consistent with the ticket's ACs ("decided explicitly by the human", "inventoried but not modified without a separate ticket") and the escalation-resolution history recorded in design.md Context. Justified; no objection.

7. **RED-then-GREEN planning** — tasks.md §1.2 requires capturing failing output against unmodified source before any edit, and §4.1 explicitly demands assertions on bucketed VALUES with a zero null-bucket count, not "no exception". This satisfies systematic-debugging / verification-before-completion. §1.1 also includes a discriminate-negative (`"not-a-date"` still nulls). No objection.

### Verdict: REFUTE

### Change Requests

1. **The custom space-separated pattern as literally specified silently loses real-world data.**
   design.md Decision 1 and tasks.md §2.2 specify `yyyy-MM-dd HH:mm[:ss][.SSS]`. `.SSS` matches **exactly three** fractional digits. Verified above: `2026-07-01 12:00:00.1` and `2026-07-01 12:00:00.123456` both FAIL under that exact pattern — and Postgres/pandas/`str(datetime)` exports (the very sources this ticket exists for) emit 6-digit microseconds by default. That reintroduces the exact silent-all-null bug for a common shape. Replace the literal pattern in design.md Decision 1 and tasks.md §2.2 with a `DateTimeFormatterBuilder` that accepts a variable-length fraction, e.g. `appendPattern("yyyy-MM-dd HH:mm[:ss]")` + `appendFraction(ChronoField.NANO_OF_SECOND, 0, 9, true)`, and add an explicit test case for 1-digit and 6-digit fractions to tasks.md §1.1.

2. **`validationError` is not an execution-failure mechanism; the guard as designed cannot be implemented where it is placed.**
   design.md Decision 2, tasks.md §3.1, and the ADDED requirement all say the step "SHALL fail step execution with a `validationError` (the same mechanism `inferCompute`/`inferSplitText` use)". Ground truth: `validationError` exists only on the *analyze* path (`PipelineAnalyzeService`/`PipelineAnalyzeProtocol`); `inferSplitText` operates on `inputSchema` alone, has **no access to row values**, and its `Some(msg)` return does not fail anything — it passes the schema through unchanged. The zero-parse-rate condition is only knowable at execution time from actual rows, which analyze never sees. Decide and state one of: (a) fail at execution via the mechanism `DateBucketStep` already uses for bad granularity — `Future.failed(new IllegalArgumentException(...))` in `evaluate` (DateBucketStep.scala:57-61) — and drop the `validationError` framing entirely; or (b) keep `validationError` and re-scope the guard to something analyze can actually evaluate. Update design.md Decision 2, tasks.md §3.1, and the ADDED requirement's wording consistently with whichever is chosen.

3. **The MODIFIED and ADDED requirements contradict each other once merged into the archived spec.**
   The MODIFIED requirement states unconditionally: "If the value at `field` cannot be parsed against any of the above forms, the output field's value for that row SHALL be `null` ... **rather than raising an error**". The ADDED requirement states that for all-unparseable non-empty input the step SHALL raise. After archive both live in one spec file with no cross-reference, so the contract is self-contradictory for exactly the case the new guard targets. Qualify the MODIFIED clause (e.g. "...SHALL be `null` ..., except where the zero-parse-rate guard requirement below applies").

### Non-blocking notes

- design.md Decision 3 cites `SchemaInferenceEngine.isTimestampLike` at lines 132-135. The actual method is named **`isTimestamp`** and spans lines **131-135**. The substance of the finding (T-separator-only gap, space form typed `text`) is correct; only the identifier is wrong. Worth fixing so the follow-up ticket is filed against a real symbol.
- tasks.md §1.1 says "or extend the existing test file if one exists" — there is no `DateBucketStepSpec`; existing datebucket coverage lives in `InProcessPipelineEngineSpec.scala`, `PipelineStepSpec.scala`, and the TimeSeries shape specs. Creating a new `DateBucketStepSpec` is fine; just don't spend a cycle hunting for a file that isn't there.
- The guard's own tests (§3.2) are written after the fix with no RED capture. Acceptable — the guard is new behavior rather than a bug fix — but a red-first capture for "all-unparseable input currently succeeds silently" would be cheap and would prove the guard actually fires.
