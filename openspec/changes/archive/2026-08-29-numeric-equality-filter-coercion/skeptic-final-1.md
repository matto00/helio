## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

1. **Diff scope.** `git show --stat HEAD` (commit `1718b586`): touches only
   `FilterStep.scala`, `FilterStepSpec.scala`, and planning artifacts. No scope creep.

2. **The fix itself, read in full.** `backend/src/main/scala/com/helio/domain/steps/FilterStep.scala`
   — the `=`/`!=` arm now computes `numericMatch` via a new private `numericFieldValue(fieldVal)` (matches
   only `Int|Long|Float|Double|BigDecimal|java.math.BigDecimal`) combined with `value.flatMap(_.toDoubleOption)`,
   falling back to the original stringified comparison when either side fails to parse numerically.

3. **Independently re-derived the red**, not trusted from either report. Diffed HEAD's `FilterStep.scala`
   against the pre-fix version at `c70893be` (`git show c70893be:...`), confirmed the only functional diff
   is exactly the `=`/`!=` arm plus the new helper. Copied the pre-fix file over the fixed one, ran
   `sbt "testOnly com.helio.domain.steps.FilterStepSpec"` myself:
   - `should return a row whose numeric years_exp is 0 when the condition value is "0"` — **FAILED**:
     `Vector() was not equal to Vector(Map("years_exp" -> 0.0))`
   - `should exclude a numeric row value from != when the numeric value matches` — **FAILED**:
     `Vector(Map("years_exp" -> 0.0), Map("years_exp" -> 3.0)) was not equal to Vector(Map("years_exp" -> 3.0))`
   - The other 11 of 13 new tests passed even pre-fix (expected — they pin behavior the old code already
     had, or the `"0.0"` string-equality coincidence). These are exactly the two tests that matter (`= "0"`
     returning 0 rows is the ticket's reported symptom); no weak/vacuous "red" claim. Restored the fixed
     file afterward (`git status --porcelain` confirms the worktree is clean of my edits).

4. **Post-fix, ran the same spec file myself**: 13/13 pass.

5. **Ran the full backend suite myself**: `cd backend && sbt test` — 3773 tests, 242 suites, 0 failed, 0
   canceled, "All tests passed." Matches the evaluator's claimed count exactly (independent re-run, not
   trusted). Correctly did not rely on the vacuous root `npm test` gate (HEL-880) — this is a backend-only
   change and `sbt test` is the real gate here.

6. **Enumerated the `match` arms in `evalCondition` myself** (9 arms: `is null`, `is not null`, `contains`,
   `=`/`!=`, `>`/`>=`/`<`/`<=`, `case _`). Cross-checked against `design.md` D4's operator table — 1:1 match,
   no arm omitted from the audit, including `contains` (correctly left as textual, tested at
   `FilterStepSpec` "keep contains textual...").

7. **Regression hazard (numeric-looking string columns) checked in both directions.** Tests assert full
   row-set equality (not size-only) for `player_id "007"` vs `"7"` under both `=` and `!=`, which would
   catch a naive symmetric-parse regression. Traced the ingestion path myself in `PipelineRowJson.scala`:
   `jsValueToAny` maps `JsNumber -> n.toDouble`, `JsString -> s` — a JSON source cannot deliver `"007"` as
   a JSON number (leading zero is invalid JSON number syntax, must be quoted), so a digit-string column
   from any JSON-based ingestion path (static, REST connector, SQL connector) is genuinely a `String` at
   runtime, confirming design.md's stated constraint rather than merely trusting the prose. The only way a
   numeric-looking string becomes a `Double` at row-eval time is an explicit user-authored cast step —
   a deliberate, visible type change, not a silent ingestion-path leak, so it doesn't undermine the fix.

8. **Null semantics (D2) unchanged and pinned.** Verified in code: for `fieldVal == null`, `numericFieldValue`
   returns `None` (no case matches), so the arm always falls through to the pre-existing string-null path
   (`fieldStr == null`), unchanged. Tests pin both `=` (excludes null) and `!=` (always satisfies null) with
   distinct row sets.

9. **Prose-vs-code audit.** Read `design.md` (D1-D5), `files-modified.md`, the commit message, and
   `specs/pipeline-filter-op/spec.md` line by line against the actual diff. All claims are accurate:
   type-keyed (not both-sides) coercion, D5's helper placement (not touching shared `PipelineRowJson.toDouble`,
   confirmed shared by sort/aggregate via grep), the operator table, and the spec-delta scenarios all match
   the shipped `evalCondition` exactly. AC1's "when both sides parse as numbers" phrasing is looser than the
   actual (correct, ticket-mandated) type-keyed rule, but this is reconciled by AC3 (the explicit regression
   hazard requirement) and the design's own documented deviation — not a contradiction, since the loose AC1
   wording is superseded by the stricter, later AC in the same list.

10. **Weak-assertion audit.** No assertion found that would pass under a wrong implementation — every new
    test asserts exact row-set equality (`shouldBe Vector(...)`), several with multi-row fixtures
    specifically constructed so a naive symmetric-parse fix would produce a different, wrong result.

### Production-survey partial — judgment

Agree with the evaluator's "acceptable partial" call. The ticket's 7th AC requires checking prod for saved
pipelines with a numeric `=` filter currently matching nothing; no agent in this pipeline has prod DB
credentials, and the executor disclosed (rather than fabricated or silently omitted) that only the local
dev DB was queried (0 matching rows). The code fix itself is verified correct and total (all operator arms
audited, all edge cases tested) independent of the survey's scope, so this is a genuine deployment-adjacent
follow-up, not a code defect gating this change. One real gap: the evaluator's own report notes
`tasks.md` 1.2/2.1 promised "an included transcript" of the survey query, and no such transcript is
persisted anywhere under the change directory — it was only relayed out-of-band. I confirmed this myself:
`ls openspec/changes/numeric-equality-filter-coercion/` shows no survey-transcript file. This is a
non-blocking gap (matches the evaluator's own "Non-blocking Suggestions" item) — worth a fast-follow, not a
reason to REFUTE the code change.

### Verdict: CONFIRM

Ships. The fix is minimal, precisely scoped, matches every design decision to the letter, the red was
independently re-derived (not merely trusted), the full backend suite is green under my own run, and the
named regression hazard is verified correct against both the code and the actual ingestion paths.

### Non-blocking notes

- Persist the production-survey query + "0 rows, dev DB only, no prod access" result as a small file under
  the change directory (evaluator already flagged this) so a future reader doesn't see AC 7 as silently
  dropped.
- Consider filing (or confirming filed) the fast-follow ticket to run the equivalent survey query against
  prod directly, since this change is a live, silent behavior change for any affected saved pipeline.
