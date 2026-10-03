## 1. Red first
- [x] 1.1 Add a collision test (runtime + analyze) that fails on main, showing the overwrite; record the red output

## 2. Implementation
- [x] 2.1 Add `JoinColumnNaming` pure helper per design Decision 1 with unit tests (single, several, pre-existing `right_x` on left and right, key on both sides, ragged rows)
- [x] 2.2 Use it in `JoinStep.evaluate` (inner and left)
- [x] 2.3 Use it in `PipelineAnalyzeService.inferJoin`; add `secondarySourceSchemas` async pre-resolution at ALL five `analyzeNodes` call sites (centralized helper) for source-kind secondaries (Decision 3) with tests (source-kind rename visible in analyze; unresolvable source falls back to passthrough)
- [x] 2.4 Apply the helper in `SparkJobSubmitter`'s join (rename colliding right columns before the join, Decision 5) with helper-level tests
- [x] 2.5 Verify frontend/MCP surfaces (Decision 6); update any client-side column computation

## 3. Verification
- [x] 3.1 Parity test comparing runtime row columns and analyze-inferred columns (Decision 4)
- [x] 3.2 Mutation: disable prefixing, show tests go red, restore
- [x] 3.3 Read-only dev-DB inventory of colliding joins (exact SELECTs, no writes); report as a table: pipeline id, join step id, secondary kind, colliding column names, what each would be renamed to, and whether join key columns collide (always yes by definition; state the verified current behavior)
- [x] 3.4 Full backend gate `cd backend && nice -n 19 sbt testFull`; frontend/mcp gates if touched
- [x] 3.5 PR body: owner-facing analysis of Outputs/panels bound to the old right-side name, verified against real code paths

## Standing Constraints
- [C1] Backend gate is `cd backend && nice -n 19 sbt testFull` (never bare `sbt test`), one full suite at a time; known flakes (HEL-1228/1225, HEL-1215, HEL-1247) are reported by name.
- [C2] Dev DB access is read-only with exact SELECTs; any cleanup uses exact ids only, never disabling triggers/FKs, never `pgrep -f`/`pkill -f`. No production or gcloud actions.
- [C3] Red-first: show the failing collision test on unmodified main logic before the fix, and a mutation (prefixing removed) turning tests red after.
