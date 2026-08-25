## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

1. **Round-1 CR 1 (variable-length fraction) — FIXED, independently re-verified on this machine's JVM**
   (`java T2.java`, scratchpad). The builder form now specified in design.md Decision 1 and tasks.md §2.2
   (`appendPattern("yyyy-MM-dd HH:mm[:ss]")` + `appendFraction(ChronoField.NANO_OF_SECOND, 0, 9, true)`):
```
OK   2026-07-01 12:00:00 / 12:00 / .1 / .123 / .123456 / .123456789
FAIL 2026-03-14                      (bare date still falls through to LocalDate.parse — good)
FAIL not-a-date                      (stays discriminate)
FAIL 2026-07-01 12:00:00Z            (offset-carrying strings not swallowed)
FAIL 2026-07-01T12:00:00             (T form correctly left to ISO_LOCAL_DATE_TIME)
ISO OK 2026-03-14T22:08:39 / .1 / .123456 / 2026-03-14T22:08
```
   The 1-digit and 6-digit fractions that broke the round-1 `[.SSS]` pattern now parse. Chain placement
   (after `OffsetDateTime.parse`, before `LocalDate.parse`) remains non-regressing. **Confirmed.**

2. **Round-1 CR 2 (`validationError` is not an execution-failure mechanism) — FIXED.** design.md
   Decision 2 and tasks.md §3.1 now specify `Future.failed(new IllegalArgumentException(...))` in
   `evaluate`. Verified that mechanism actually exists and is already used for bad granularity:
   `DateBucketStep.scala:59-62` — `case Left(err) => Future.failed(new IllegalArgumentException(err))`.
   The ADDED requirement's wording also now explicitly says "not an analyze-time `validationError`".
   **Confirmed in design.md, tasks.md, and spec.md — but NOT in proposal.md (see CR 1).**

3. **Round-1 CR 3 (MODIFIED/ADDED contradiction) — fixed only at the prose level.** The MODIFIED
   requirement now carries "**except** where the zero-parse-rate execution-failure requirement below
   applies". Prose is consistent. **But the scenarios underneath it are not** (see CR 2).

4. **Spec carry-forward re-checked** — all original prose clauses and the 9 original scenarios of
   `openspec/specs/pipeline-date-bucket-op/spec.md` are still present in the delta, plus 2 new
   tz-less scenarios and 4 new guard scenarios. No regression introduced by this round's edits.

5. **Existing test surface checked against the new guard** —
   `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineSpec.scala:489-495`:
```scala
"datebucket: unparseable value yields null" in {
  val rows = Seq(Map("ts" -> "not-a-date".asInstanceOf[Any]))
  ...
  result.head("ts").asInstanceOf[AnyRef] shouldBe null
}
```
   This is a single-row, non-empty, field-present, zero-parse input run through the engine — precisely
   the case the new guard makes fail. See CR 2.

### Verdict: REFUTE

### Change Requests

1. **proposal.md was not updated with round 1's CR-2 correction and now contradicts design.md,
   tasks.md, and spec.md.** proposal.md "What Changes" still reads: "`DateBucketStep.apply` surfaces a
   `validationError` when zero rows parse out of a non-empty input", and "Impact" still reads "a step
   that previously 'succeeded' with all-null output can now fail with a `validationError` instead". Both
   the *mechanism* (`validationError`, refuted as nonexistent at execution time) and the *location*
   (`apply`, which returns `Seq[Row]` and cannot fail a step; the guard now lives in `evaluate`) are
   stale. Rewrite both proposal.md clauses to match design.md Decision 2 — execution failure via
   `Future.failed(new IllegalArgumentException(...))` in `evaluate`. The "Capabilities" bullet
   ("a new requirement is added for the zero-parse-rate `validationError` guard") needs the same fix.

2. **The MODIFIED requirement's "Unparseable value yields null" scenario is a direct, concrete
   counterexample to the ADDED requirement — the prose qualifier did not reach the scenarios.**
   MODIFIED scenario: `{"field": "ts", "granularity": "day"}` applied to a row containing
   `{"ts": "not-a-date"}` → THEN output contains `{"ts": null}`. That input has one row, its `field`
   value is present and non-blank, and zero rows parse — so the ADDED requirement's guard SHALL fire and
   execution SHALL fail. Two normative scenarios in the same capability demand opposite outcomes for the
   same input. This is not hypothetical: the existing test at `InProcessPipelineEngineSpec.scala:489-495`
   encodes exactly this scenario and will break. Fix by changing the MODIFIED scenario (and the
   corresponding existing test) to a **partially**-parseable input, which is the behavior that clause
   actually still governs, e.g. rows `[{"ts": "2026-03-17T00:00:00Z"}, {"ts": "not-a-date"}]` →
   `[{"ts": "2026-03-17"}, {"ts": null}]` — or state explicitly why the guard should not apply here.

3. **tasks.md §1.1 instructs writing a test that the new design makes fail.** §1.1 requires: "a
   genuinely-unparseable shape (e.g. `"not-a-date"`) still yields `null` (**should already pass**)".
   Under §3.1's guard, a lone-unparseable-row input fails execution instead — the task as written
   directs the executor to assert the exact behavior §3.1 removes, and labels it a passing baseline.
   Re-scope that bullet to a mixed input (at least one parseable row alongside the unparseable one) so
   it tests the discriminate-parser property without colliding with the guard.

4. **tasks.md §4.2 ("confirm no regression in existing coverage") will be violated by design, and the
   plan does not say so.** The guard intentionally changes an existing, asserted behavior
   (`InProcessPipelineEngineSpec.scala:489`). Add an explicit task to update that test in lockstep with
   §3.1, and note in §4.2 that this one assertion change is expected and intentional — otherwise the
   executor will hit a red existing test with no guidance and may either "fix" it by weakening the guard
   or bypass the gate.

### Non-blocking notes

- design.md Decision 3's identifier was corrected to `isTimestamp` (131-135) per round 1's note — verified
  against the source. Good.
- design.md and tasks.md are internally consistent with each other on both the formatter and the guard
  mechanism; the drift is confined to proposal.md and the scenario/test layer.
- `scripts/concertino/next-report-number.sh` (and the rest of the current script set) does not exist in
  this worktree — it predates them; I used the repo-root copy at
  `/home/matt/Development/helio/scripts/concertino/`. Not a blocker, but the same absence will affect any
  script the executor/evaluator is told to run from inside this worktree.
