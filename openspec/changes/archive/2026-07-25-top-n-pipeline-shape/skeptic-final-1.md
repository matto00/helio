## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Ground truth diff read.** `git diff main...HEAD --stat` (backend-only change): new
   `TopNShape.scala` (123 lines), `PipelineShape.scala` +3/-1 (registry line), `SingleRowShape.scala`
   +2/-1 (case-insensitivity fix), plus test files `TopNShapeSpec.scala`, `TopNShapeEngineSpec.scala`,
   extended `PipelineShapeSpec.scala`/`SingleRowShapeSpec.scala`/`PipelineShapeRoutesSpec.scala`. No
   `frontend/**` files touched (`git diff main...HEAD --name-only -- frontend/` empty) — confirms
   backend-only, so UI/design judgment (Section 4) does not apply.

2. **AC1 — catalog entry with params + output contract.** Read `TopNShape.scala` full file:
   `id = "top-n"`, `paramsSchema` declares `measure`/`direction`/`n`/`ties` (lines 31-60),
   `outputContract = OutputContract(RowCountContract.AtMostParam("n"), Vector.empty, ...)` (lines
   62-66). `PipelineShape.Registry` includes `TopNShape.id -> TopNShape` (`PipelineShape.scala:45`).
   Verified via HTTP-layer test: `PipelineShapeRoutesSpec` new case "include named entries for both
   single-row and top-n, each with a non-empty paramsSchema" — ran it (see gate re-runs below), green.

3. **AC2 — expand yields sort+limit; run returns correct top/bottom N.** `TopNShape.expand`
   (`TopNShape.scala:68-80`) builds exactly `Vector(SortStep expansion, LimitStep expansion)`.
   `TopNShapeEngineSpec` runs the real expansion through `InProcessPipelineEngine` against a 10-row
   fixture: top-3 desc → `Seq("row-10","row-9","row-8")`; bottom-3 asc → `Seq("row-1","row-2","row-3")`.
   Both re-ran fresh, both pass.

4. **AC3 — ties policy documented, strict works, keep-ties explicitly deferred.**
   `validateTies` (`TopNShape.scala:110-122`): absent → `"strict"` default; explicit `"strict"` →
   accepted; any other value → `Left` with message naming the value, `"window"` op, and "not yet
   supported" — not silently ignored, not half-built. Confirmed by test "return Left naming the
   window-op deferral when \"ties\" is an unsupported value" (asserts message contains both
   `"keep-ties"` and `"window"`), re-ran, green.

5. **AC4 — tests: expansion → step list; e2e run with a real N/N+1 tie-break.**
   `TopNShapeEngineSpec` test "keeps the earlier-input row when two rows are tied at the N/N+1
   boundary (strict ties)": 3-row fixture, `n=2`, rows 2 and 3 tied at `score=5.0`, asserts
   `Seq("first","second")` survives (row 3 dropped). This is a genuine boundary tie (not vacuous —
   row 1 has a distinguishing higher score). Traced the mechanism: `SortStep.apply`
   (`SortStep.scala:59-87`) uses `.sortWith`, which Scala's collections library implements via a
   stable merge sort — ties preserve original relative order, exactly as the design and test claim.
   Re-ran the test fresh, passes.

6. **AC5 — backward compatible: additive, no persisted schema change, no migration.**
   `ls backend/src/main/resources/db/migration/ | tail -5` → newest is `V72__add_lookup_op.sql`, no
   new file added by this change; `git diff main...HEAD --stat -- backend/src/main/resources/db/migration/`
   is empty. `schemas/pipeline-shape-catalog.schema.json` diff against main is empty (0 lines) — read
   the full file, confirmed it already generically supports `"at-most-param"` with `paramName` and
   empty `fields`, so no schema update was needed and none was made.

7. **No inline FQNs.** `grep -rn "com\.helio\." backend/src/main/scala/com/helio/domain/shapes/TopNShape.scala backend/src/main/scala/com/helio/domain/shapes/PipelineShape.scala` — only the `package` line and scaladoc `[[com.helio.domain.PipelineStep]]` cross-references, no inline FQN usage in code bodies. Ran `npm run check:scala-quality` fresh: "Scala code-quality check: clean (64 soft warning(s))" — all 64 warnings are pre-existing file-size soft-budget notices on files untouched by this diff; zero issues on the new/modified files.

8. **domain/shapes doesn't import `com.helio.api.protocols`.** `grep -rn "com\.helio\.api\.protocols" backend/src/main/scala/com/helio/domain/shapes/` → only a scaladoc mention in `ShapeStepExpansion.scala` (pre-existing, unmodified by this diff) explicitly documenting that the file "never imports `com.helio.api.protocols`" — no actual `import` statement anywhere in `domain/shapes` main sources. Layering convention held.

9. **Fresh gate re-runs (not trusting evaluator's pasted output):**
   - `sbt testOnly` on the five directly-relevant specs → 46/46 tests pass (`TopNShapeSpec`,
     `TopNShapeEngineSpec`, `PipelineShapeSpec`, `SingleRowShapeSpec`, `PipelineShapeRoutesSpec`).
   - Full `sbt test` (backend, clean invocation) → **1983 tests, 109 suites, 0 failures** — no
     regressions anywhere in the suite.
   - `npm run check:scala-quality` → clean, as above.
   - `openspec validate top-n-pipeline-shape --strict` → "Change 'top-n-pipeline-shape' is valid".
   - No scalafmt task configured in this backend project (`sbt scalafmtCheckAll` → "Not a valid
     command") — consistent with evaluator's claim that no Scala formatter is wired up; nothing to
     run there.

10. **`SingleRowShape` fix scoped correctly.** Diff is exactly one line
    (`SupportedFns.contains(m.fn)` → `SupportedFns.contains(m.fn.toLowerCase)`), matching
    `AggregateStep.apply`'s own `fn.toLowerCase` runtime matching — pre-authorized in ticket.md's
    "Orchestrator pre-brief notes" #1 and confirmed at the design gate. New `SingleRowShapeSpec` case
    proves `"SUM"` (uppercase) now returns `Right` with the original casing preserved on the wire
    (`Aggregation("total", "SUM", "amount")`, not lowered) — validated, doesn't silently rewrite data.

11. **`PipelineShapeProtocolSpec`'s pre-existing `AtMostParam("n")` wire round-trip** — confirmed via
    grep this file is untouched by the diff (not in `git diff --stat`) and its `{"kind":
    "at-most-param","paramName":"n"}` round-trip test exists and ran green as part of the full suite
    — task 2.3's wire-serialization requirement is genuinely covered, not just asserted.

12. **Task 3.1 (file HEL-337 spinoff)** is correctly left unchecked in `tasks.md` — it's explicitly
    scoped as an orchestrator/post-delivery action, not a code task, per both the ticket and the
    executor's own annotation.

### Verdict: CONFIRM

All five acceptance criteria trace to real, independently re-run evidence. The tie-break test at the
N/N+1 boundary is genuine (not vacuous), the ties-policy deferral is explicit and tested (not
silently ignored), the change is additive with zero schema/migration drift, layering conventions
(no inline FQNs, no `domain/shapes` → `api.protocols` import) hold, and the full backend suite
(1983 tests) passes with no regressions. Backend-only change; no UI surface to review.

### Non-blocking notes

- None beyond what the design-gate skeptic already flagged as optional polish (the `WindowStep` vs.
  `SortStep` stability-comment tension) — correctly left out of this ticket's scope.
