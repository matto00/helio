## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 9b119e9644203e9cecbd1f7753234b407785f811

### Phase 1: Spec Review — PASS
Issues: none. All five ACs addressed: uniform 404 across foreign/absent/wrong-pipeline (single shared `RunStatusNotFound` ServiceError, fixed message, no id echoed); owner + viewer grantee 200 tested; row added to ExistenceNotLeakedRoutesSpec; caller audit recorded (only caller of `status` was the route; now removed); patch-sets/preview 500 probed and reported (reproduces, root cause named, follow-up to be filed by orchestrator/PR). CONSTRAINTS empty.

### Phase 2: Code Review — PASS
Gates (fresh run in WORKTREE_PATH, `nice -n 19 sbt testFull`): 5316 tests, 0 failed, 368 suites, no flakes hit.
Independent red verification: mutated PipelineRunService.runStatus to drop the findByIdShared visibility check and the pipelineId filter. ExistenceNotLeakedRoutesSpec then failed 2 tests (row "GET pipeline run status" and the 4-arm byte-identical test); 54 passed. Mutation reverted (worktree clean, git status empty). Red evidence is real.
Byte-identity: all four arms produce the same `Left(RunStatusNotFound)` through `ServiceResponse.run`; the 4-arm test asserts status + content-type + body equal (run id normalised). Verified.
update() no longer fabricates unscoped entries; pipelineId preserved; tested. No dead code, no leftover TODOs.

### Phase 3: UI Review — N/A
Backend-only.

### Overall: PASS

### Non-blocking Suggestions
- Cache lookups are latent today (SparkJobSubmitter.submit has no main caller); fine as defense-in-depth.
- File the patch-sets/preview follow-up (PatchSetPreviewService missing outputRepo) unless HEL-1239 covers it.
