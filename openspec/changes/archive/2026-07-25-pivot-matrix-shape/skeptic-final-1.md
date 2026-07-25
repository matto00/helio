## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Conditional expansion matches design.md exactly.**
   Read `PivotMatrixShape.scala:95-121` (`buildExpansion`) directly: when `agg.toLowerCase` is in
   `{sum,avg,min,max,count}` it emits `aggregate` (groupBy = `index :+ column`, one `Aggregation(alias
   = values, fn = agg, field = values)`, original casing preserved) then `pivot` with `agg = "first"`
   (hardcoded literal); when `agg = "first"` it emits `pivot` alone with `agg = "first"` (canonical
   lowercase). Cross-checked against `PivotStep.scala:71-137` and `AggregateStep.scala:71-107` directly
   (not trusting design.md's claims): confirmed `AggregateStep.apply` lowercases `fn` before matching
   and has no `"first"` case (throws `IllegalArgumentException` otherwise); confirmed `PivotStep.apply`'s
   `SupportedAggs.contains(cfg.agg)` and inner `match` are exact/case-sensitive with no `.toLowerCase`
   anywhere in the file. Design.md Decisions 1 and 2 are accurately implemented.

2. **Collision validations present, correct, tested.**
   `validateCollisions` (PivotMatrixShape.scala:166-177) rejects `column ∈ index`, `values ∈ index`,
   `values == column`, each with a distinct, field-naming error message. Verified the hazard against
   `AggregateStep.apply`'s actual merge line (`keyMap ++ aggMap`, AggregateStep.scala:104) — `aggMap`
   is applied last and would silently clobber a `keyMap` entry, confirming the stated risk is real, not
   invented. All three collisions have dedicated tests in `PivotMatrixShapeSpec` (lines 135-169) and
   pass.

3. **outputContract honest and correctly shaped.**
   `PivotMatrixShape.scala:77-84`: `RowCountContract.Unbounded`, `fields = Vector.empty`, description
   names the `<values>_<column-value>` dynamic-columns caveat and ties it to pivot's own analyze
   contract. Matches HEL-391's `OutputContract` shape (3 fields, no `role`) and the epic-wide
   `fields = Vector.empty` precedent explicitly sanctioned by the pre-brief.

4. **No scope creep — confirmed by diff, not by narrative.**
   `git diff main...HEAD --stat -- backend/src/main/resources/db/migration/ schemas/` → empty.
   `git diff main...HEAD --stat -- frontend/ backend/.../ApiRoutes.scala schemas/ openspec/specs/` →
   empty (Phase 3 UI review correctly N/A; no UI surface touched). `grep -n "^import" PivotMatrixShape.scala`
   shows only `com.helio.domain.steps.*` and `spray.json._` — no `com.helio.api.protocols` import.
   `OutputContract`/`PipelineShape` trait shape unchanged (only the one-line Registry addition in
   `PipelineShape.scala`).

5. **Registry-parity and catalog HTTP tests extended, not duplicated.**
   `PipelineShapeSpec.scala` — same file, same `expectedIds` set literal extended to 5, same equality
   assertion extended (git diff confirms in-place edits, no new parallel test class).
   `PipelineShapeRoutesSpec.scala` diff (5 lines changed) — the existing "include named entries for..."
   test extended in place to add a `pivot-matrix` lookup + non-empty `paramsSchema` assertion; no new
   test added alongside it.

6. **Test coverage is genuine, not just decode-path.**
   `PivotMatrixShapeEngineSpec.scala:47-77` runs two `east`/`Q1` rows (revenue 30.0 + 20.0) with `agg =
   "sum"` through the real `InProcessPipelineEngine` and asserts `revenue_Q1 == 50.0` — a real
   duplicate-collapse assertion that would fail if the pre-aggregate step were dropped or miswired
   (pivot's own "first" would silently return 30.0 instead). A second scenario (agg="first", no
   duplicates) confirms the one-step path. This is beyond decode-path coverage.

7. **Commit and worktree hygiene.**
   `git status` shows only `workflow-state.md` modified and `evaluation-1.md` untracked — both expected
   workflow artifacts, no stray code files. Single commit `92c87268`, message prefixed `HEL-398`, scoped
   diff (15 files, matches `files-modified.md`).

### Gates re-run myself (fresh evidence, not trusted from prior reports)

- `sbt testOnly` on the four target specs: **33/33 passed** (own run, output captured).
- `sbt test` full backend suite: **2022/2022 passed**, 0 failed, 0 canceled, Flyway confirms main is
  still at V72 (no new migration).
- `npm run lint`: clean (0 warnings, `--max-warnings=0`).
- `npm run format:check`: clean.
- `npm run check:schemas`: in sync.
- `npm run check:scala-quality`: clean (only pre-existing, unrelated soft-budget file-size warnings).
- `npm run check:openspec`: fails with exactly the expected "complete (12/12) but not archived" message
  — consistent with the executor's documented `--no-verify` rationale; archiving is a downstream phase.

### Acceptance criteria traced

- AC1 (catalog entry with params + honest output contract): `paramsSchema` (index/column/values/agg) +
  `outputContract` in `PivotMatrixShape.scala`, live-verified via extended `PipelineShapeRoutesSpec`.
- AC2 (`expand` yields optional-aggregate+pivot, run produces expected matrix): `buildExpansion` +
  `PivotMatrixShapeEngineSpec`'s end-to-end assertions.
- AC3 (tests: expansion→steps, end-to-end run): both `PivotMatrixShapeSpec` and
  `PivotMatrixShapeEngineSpec` present and passing.
- AC4 (backward compatible, additive, no persisted schema change): confirmed via empty migration/schema
  diff and full-suite pass with no regressions.

### Verdict: CONFIRM

### Non-blocking notes

- None beyond what design.md already flags as an explicitly deferred epic-level open issue
  (`fields = Vector.empty` across all shapes — a human-owned decision, not specific to this ticket).
