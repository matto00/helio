## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Read in full (not diffs): `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/pipeline-date-bucket-op/spec.md`, plus ground-truth source
`backend/src/main/scala/com/helio/domain/steps/DateBucketStep.scala` and test file
`backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineSpec.scala`.

1. **Fix 1 — proposal.md re-framing.** proposal.md:16-20 now states the guard as
   `Future.failed(new IllegalArgumentException(...))` in `evaluate`, "the same mechanism already used
   for an unsupported `granularity`", and explicitly disclaims `validationError`. Capabilities (24-28)
   and Impact (30-37) match. Verified against source: `DateBucketStep.evaluate` (line 57-63) already
   does exactly `case Left(err) => Future.failed(new IllegalArgumentException(err))`. Mechanism claim
   is true.
2. **Stale-reference sweep.** `grep -rn "validationError\|inferSplitText\|inferCompute"` across the
   artifact set: every surviving hit is either an explicit *negation/correction* (proposal.md:19,28,37;
   design.md:57-59,74; tasks.md:40; spec.md:85) or the original ticket text (ticket.md:50, the human's
   *suggested* option 1, which design.md decision 2 explicitly overrides). No stale prescriptive
   `validationError`/`apply`-based framing survives anywhere. design.md's Risks section (93-106)
   describes the guard as `Future.failed(IllegalArgumentException)` — consistent.
3. **Fix 2 — MODIFIED/ADDED non-contradiction.** spec.md:67-72 is now the two-row partially-parseable
   case (`[{"ts":"2026-03-17T00:00:00Z"},{"ts":"not-a-date"}]` → `[{"ts":"2026-03-17"},{"ts":null}]`),
   retitled "…when at least one other row parses". The MODIFIED requirement prose (15-17) carries an
   explicit `except`-carve-out pointing at the zero-parse-rate requirement. I walked all 10 MODIFIED
   scenarios and all 4 ADDED scenarios: every MODIFIED scenario's input has at least one parseable
   `field` value (or is the granularity-failure case), so none of them collide with the ADDED guard;
   the ADDED guard's three negative scenarios (empty / all-field-absent / partially-parseable) are
   each consistent with `apply`'s actual behaviour (`row + (outputCol -> null)` for an unparseable or
   absent field — source lines 90-100), including the all-field-absent scenario's asserted
   `{"ts": null}` output. No remaining contradiction.
4. **Fix 3 — tasks.md §1.1.** Now scopes the null-yielding red test to a partially-parseable input and
   explicitly forbids a lone-unparseable-row case here, deferring it to §3.2. Consistent with spec.md.
5. **Fix 4 — §3.3 line reference, independently re-checked.** `grep -n` shows
   `"datebucket: unparseable value yields null"` at InProcessPipelineEngineSpec.scala **489**, body
   through **495** — tasks.md's `489-495` is exact. Its content is exactly as tasks.md describes:
   single-row `Seq(Map("ts" -> "not-a-date"))`, asserts `result.head("ts") shouldBe null` — i.e.
   precisely the case the new guard makes fail. The cited failure idiom at "line ~497" is real:
   `"datebucket: unsupported granularity fails at execute time…"` at 497, using
   `intercept[IllegalArgumentException](run(rows, step))` — a directly reusable idiom. §4.2 correctly
   flags this one assertion change as intentional.
6. **No other missed all-unparseable test.** Enumerated all 10 `datebucket` tests in
   InProcessPipelineEngineSpec (lines 422, 430, 438, 446, 454, 462, 471, 479, 489, 497) — every input
   other than 489's is parseable (`2026-03-17`, epoch strings, `…Z`) or is the granularity-failure
   case. Repo-wide `grep -rn '"datebucket"' backend/src/test/` found only:
   PipelineAnalyzeServiceSpec (analyze-time/schema-only, never executes rows — including its
   `NOT_JSON` malformed-config case), PipelineStepConfigCodecSpec / PipelineStepSpec (codec/registry
   only), TimeSeriesShapeSpec (expansion only), and TimeSeriesShapeEngineSpec, whose executed source
   rows (lines 52-58) are all parseable `yyyy-MM-dd` values. 489 is the only affected existing test —
   tasks.md's plan is complete.
7. **Plan-vs-source feasibility.** §2.1/§2.2's insertion point (after `OffsetDateTime.parse`, before
   `LocalDate.parse`) matches the real `orElse` chain at source lines 122-125; §3.1's "count non-blank
   input field values vs. non-null output column values" is computable in `evaluate` with the same
   blank/null semantics `parseToUtcDate` uses (lines 111-114), and the `outputColumn`-resolution rule
   (§3.1 "resolved output column") matches `apply`'s `cfg.outputColumn.filter(_.nonEmpty).getOrElse(field)`.

### Verdict: CONFIRM

All four claimed fixes are present, correct, and complete against ground truth. The artifact set has
no surviving placeholders, no internal contradictions, and every ticket acceptance criterion maps to a
task (AC1→§2.1/2.2, AC2→design.md Context/Decisions escalation record, AC3→§1.2/§2.3/§4.1/§4.3,
AC4→design.md Decision 3 + §follow-up filing).

### Non-blocking notes

- tasks.md §1.1 says "Write `DateBucketStepSpec` tests (or extend the existing test file if one
  exists)". Ground truth: there is **no** `DateBucketStepSpec`; all datebucket coverage lives in
  `InProcessPipelineEngineSpec.scala`. Either choice is permitted by the task text, but the executor
  should not be surprised, and should keep new tests co-located with the existing 10 rather than
  splitting coverage across two files without reason.
- §4.3's manual dev-DB repro should heed the shared-dev-DB caution already written into the task;
  nothing in the plan needs changing.
