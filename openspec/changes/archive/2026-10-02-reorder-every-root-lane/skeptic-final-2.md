## Skeptic Report — final gate (round 2, skeptic-final-2.md)
Reviewed head fa5e8373edc65e51f8a3f7029ec77478e8e36917 (base e184391c, resolved live).

### What I verified (with evidence)
- Diff read in full for useLaneReorder.ts, LaneColumn, PipelineRiverView, RootColumn, StepCard, usePipelineDetailPage note. Handlers are lane-scoped by step id (trunkLaneOfStep), not root 0; NOOP_MOVE removed (grep: zero hits for NOOP_MOVE / "DELIBERATELY UNTESTED" in frontend/e2e/backend/docs). Branch lanes pass no `reorder`, StepCard `reorderable=false` renders no Move/drag at all (honest, not disabled). Drop is ignored outside the drag's own lane.
- Jest `--testPathPatterns=pipelines`: 74 suites / 1016 tests pass.
- Guard test (PipelineDetailPage.reorderGuard.test.tsx) honesty: header and the usePipelineDetailPage.ts note both say defense-in-depth, no live path, hand-built input, does not show reachability; the two are consistent with each other and with the exhaustive stepTree invariant test (kept). Mutation by me, restored via git checkout (tree clean): (M1) guard condition forced false -> test FAILS (reorderPipelineSteps called 1x, expected 0); (M2) toast message uses raw root id instead of source name -> test FAILS. Failable, not vacuous.
- Backend: sbt testOnly PipelineStepRepositorySpliceSpec 29/29 pass, including the new non-first-root-only permutation test (root1 chain/head untouched, root2 head follows).
- E2E e2e/hel1007-multi-root-reorder.spec.ts against this worktree (readlink /proc/<pid>/cwd for 6439 and 9346 both resolve to this worktree): GREEN (1 passed). Red on base: restored base UI files (LaneColumn/RiverView/RootColumn/StepCard) from e184391c, spec FAILED (Move buttons count 0 vs 3; Move up disabled), then restored HEAD (tree clean). Spec reloads and asserts persistence on root 1.
- Live UI, dark and light screenshots (.playwright-mcp/sk-light.png dark, sk-light2.png light): root 1 lane shows enabled up/down controls named "Move step up/down in SkB"; keyboard Enter on last card's Move up reordered, focus stayed on the moved step's Move up button, order persisted after reload. Visual parity and spacing identical to root 0; tokens/shared styling unchanged. Only console error is the pre-existing expected 404 on /schedule.
- Test edits to existing tests are name-regex loosenings (/^Move step up/) necessitated by the new lane-qualified names; no assertions removed.

### Dev-DB records
Created by me: user skeptic-hel1007-1790968988664@example.com, pipeline 09571784-45e9-4f15-bbab-c99c4d560b48, sources 358f9962-3279-4aac-b25b-c9a3380e9c79, 71615ea3-7406-402b-b6a9-c3680d2704fe; pipeline and both sources deleted by exact id (204x3); user row remains (no API delete). E2E runs (self-cleaning finally): users hel1007-1790968938856-69402, hel1007-1790968950467-98328 (pipelines 928b1c27-3c9f-435e-b19f-3ca9f4b93b29, e3a0f9b7-f4b3-493b-a1c5-b97296c38a8f).

### Verdict: CONFIRM

### Non-blocking notes
- My fixture's attempted branch lane did not materialize (position ignored), so branch-lane rendering was verified by unit test (multiRootReorder "branch lanes expose no reorder controls"), not live.
- Untracked evaluation-2.md in change dir is not yet committed (orchestrator concern).
