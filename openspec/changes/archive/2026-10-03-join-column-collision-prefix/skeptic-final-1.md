## Skeptic Report — final gate (round 1, skeptic-final-1.md), head a2e52e0d

### What I verified (with evidence)
- Diff vs live base (8c63961a): JoinColumnNaming is one shared rule used by JoinStep, PipelineAnalyzeService.inferJoin, SparkJobSubmitter (read in full).
- Re-ran suites myself: `sbt testOnly *JoinColumn* *PipelineAnalyzeJoinCollisionSpec *PipelineAnalyzeServiceSpec *SparkJobSubmitterSpec` -> 196 passed, 0 failed. Evaluator's pasted full gate (5371 pass), red-first output (7 failing on unmodified logic) and mutation (41 fail) are pasted, unambiguous and consistent with the code.
- Edge cases attacked: key on both sides (dropped right copy, never renamed); left lacking key (right key kept, cannot collide); mapping computed once from key union of all rows (ragged rows consistent); pre-existing right_x on left or right (reserved, `_2` suffix); Spark path renames before USING join, with a test; every analyzeNodes call site routed through resolveSecondarySourceSchemas, proposal path uses owner-scoped lookup (good tenant hygiene).
- pr-body-notes.md claims match code paths (fieldMapping by name, existence checked only at Output creation, dev DB has 0 joins); the correction that right (not left) wins on main is accurate per `leftRow ++ rightRow`.

### Verdict: REFUTE (one spec/implementation contradiction)

### Change Requests
1. specs/pipeline-join-column-collision/spec.md, requirement "Prefixed names are collision-proof and deterministic", says "Right columns are processed in their original column order." The implementation (JoinColumnNaming.scala `colliding = kept.filter(left.contains).sorted`, doc rule 5) processes in ascending code-point order, and for runtime Map rows an "original column order" does not even exist. The two give different outputs: left {a, a_2, right_a}, right {a, a_2, right_a}; sorted order yields a->right_a_2, a_2->right_a_2_2; original order with a_2 first would yield a_2->right_a_2, a->right_a_3. Fix the spec (and the analogous wording in the "Runtime and analyze-time schemas agree" requirement about "right-column order", which is only about schema listing order and is fine) to state sorted-name processing, ideally with a scenario pinning the example above, and confirm a test pins it. Do not change the code. This archived spec would otherwise be the contract of record and is false.

### Non-blocking notes
- `lookup` still overwrites on collision; correctly disclosed as a follow-up in notes and code comment.
- Spark column-name case-insensitivity (cnt vs CNT) is not addressed; out of scope but worth a follow-up mention.
