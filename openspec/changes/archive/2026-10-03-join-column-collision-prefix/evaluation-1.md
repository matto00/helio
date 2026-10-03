## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit a2e52e0dc78d613d4fac8bd94f0c04a1f9fe4953.

### Phase 1: Spec Review — PASS
Issues: none. Owner ruling (auto-prefix right, never error/drop) implemented via single rule JoinColumnNaming (left kept; duplicate join key kept once from left; right collisions -> right_<name>, then right_<name>_2.. deterministic by sorted name). Applied in JoinStep runtime, analyze inferJoin, Spark path. Rename is surfaced via analyze (all five analyzeNodes call sites), so editor columns / Output pickers / analyze_pipeline see it. Dev-DB inventory, design/spec, PR-body notes present. Scope is tight (lookup deliberately unchanged, documented as follow-up).

### Phase 2: Code Review — PASS
Gates: backend `sbt testFull` (clean tree at a2e52e0d): Tests succeeded 5371, failed 0, canceled 0. No flakes observed (HEL-1228/1225, HEL-1215, HEL-1247 did not fire). No frontend files changed, so frontend gates not applicable.

Specific asks:
1. /api/outputs/:id/rows traced: OutputRoutes `rows` -> OutputService.rows (OutputService.scala:364-401) -> nodeSnapshotRepo.listRowsPaged, which returns the stored snapshot rows parsed as JsObject (items = rows.map(_.parseJson...asJsObject)). Only sort/filter are resolved against output.schema; no column renaming/aliasing/masking anywhere on that path. Rows come back with whatever column names the join run materialized (so `cnt` = left, `right_cnt` = right after re-run). The PR-body claim is accurate. Stored fieldMapping is not rewritten/re-validated (consistent with pr-body-notes.md).
2. Mutation independently confirmed: inserted `if (true) return rightCols.map(c => c -> c).toMap` at top of JoinColumnNaming.resolve; ran JoinColumnCollisionSpec, JoinColumnNamingSpec, PipelineAnalyzeJoinCollisionSpec -> many FAILED (naming unit tests, runtime inner/left collision, analyze lane/source projections, apply/infer parity cases). Reverted via git checkout; `git status --short` clean, HEAD unchanged.
3. analyzeNodes call sites: five in PipelineService (create/applyPipeline ~L366, analyze ~L999, concise analyze ~L1122, schema-at-step ~L1333, proposal ~L1436) all pass secondary schemas via resolveSecondarySourceSchemas. Persisted-pipeline paths use findByIdInternal (pipeline ACL is the gate; create path follows validateStepCrossOwnerRefs at L342). Proposal path (un-applied, unvalidated) uses caller-scoped findByIdOwned, so another tenant's source resolves to absent -> documented passthrough, no cross-tenant schema leak. Runtime JoinStep resolves via the existing path unchanged. No analyzeNodes call omits the helper.

Other notes: no dead code/TODOs; no untyped escapes; ADT/decode failures degrade tolerantly (Try) consistent with surrounding code.

### Phase 3: UI Review — N/A
No frontend/UI-triggering files changed beyond backend service/analyze logic (no ApiRoutes.scala/schemas/openspec/specs route-contract changes besides a new change-dir spec; no UI surface edited).

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- Consider a follow-up ticket for `lookup`'s same silent-overwrite semantics (already noted in LookupStep doc).
- Spark rename path (renameCollidingRightColumns) is covered by a unit spec but not by a live Spark run; acceptable given Spark joins are not exercised in default CI.
