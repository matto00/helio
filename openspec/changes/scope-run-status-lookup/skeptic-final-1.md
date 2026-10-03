## Skeptic Report — final gate (round 1, skeptic-final-1.md)
Reviewed head_sha 9b119e9644203e9cecbd1f7753234b407785f811

### What I verified (with evidence)
- Diff vs live-resolved base 587e331c read in full. Route now calls ServiceResponse.run(runService.runStatus(pipelineId, runId, user)); runStatus does findByIdShared(pipelineId, Some(user)), then cache.get(runId).filter(_.pipelineId == pipelineId.value). All failure arms return one shared ServiceError.NotFound("Run not found") (no id echoed) => byte-identical 404.
- No user-free run lookup remains: grep shows the old status(runId) removed; only remaining main-code cache.get is inside runStatus. cache.put has one caller (SparkJobSubmitter, now passes pipeline.id.value); cache.update no longer fabricates unbound entries (unit-tested).
- Own mutation 1 (drop pipelineId filter): ExistenceNotLeakedRoutesSpec 55 pass / 1 FAIL (the 4-arm byte-identical test, wrong-pipeline arm). Mutation 2 (drop findByIdShared visibility check): 2 FAIL (new table row + 4-arm test). Both reverted (git checkout; worktree clean apart from untracked evaluation-1.md).
- Grantee still 200: dedicated test inserts viewer grant and asserts 200 for owner and viewer; owner-control in the table row asserts not 404/403.
- Completeness guards: new row's site PipelineRunService.scala already in the covered set; Forbidden-producer count unchanged (2); guards pass (56 tests green in the spec). Row is failable (mutation 2). No dead/vacuous tests found; PipelineRunRoutesSpec updated to bind runs to a real seeded pipeline.
- Fresh full suite: `nice -n 19 sbt testFull` = 5316 passed, 0 failed, 368 suites.
- ACs: 404 uniformity, grantee read, spec row, caller audit (only caller was the route, per evaluation and my grep), patch-sets/preview probe reported by evaluator (follow-up to be filed by orchestrator). Spec/design/tasks match the diff.

### Verdict: CONFIRM

### Non-blocking notes
- Cache is per-instance and only populated by SparkJobSubmitter.submit; hardening is defense-in-depth.
- Ensure the patch-sets/preview 500 follow-up ticket is actually filed.
