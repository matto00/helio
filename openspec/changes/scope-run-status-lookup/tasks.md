## 1. Red first

- [x] 1.1 In `ExistenceNotLeakedRoutesSpec`, expose the `PipelineRunCache` from `buildApi`, add a seeding helper that puts a run owned by the seeded pipeline, add the `GET /api/pipelines/{id}/runs/{runId}` row(s), and run it on unmodified main: capture the failing output (stranger gets 200 + rows) as red evidence
- [x] 1.2 Add a wrong-pipeline test (run seeded under pipeline A requested via a pipeline the stranger/owner can see = B) and a viewer-grantee 200 test; verify they fail/pass as expected on main (grantee already 200, wrong-pipeline red)

## 2. Fix

- [x] 2.1 Add `pipelineId` to `RunEntry`, thread it through `PipelineRunCache.put/update` and `SparkJobSubmitter.submit`; update fixtures; verify `sbt compile Test/compile`
- [x] 2.2 Add `PipelineRunService.runStatus(pipelineId, runId, user)` (visibility first, then cache, then pipeline match, one identical NotFound), remove the user-free `status(runId)`, and rewire `PipelineRunStatusRoutes` through `ServiceResponse.run`; verify the 1.x tests are green
- [x] 2.3 Verify completeness guards in `ExistenceNotLeakedRoutesSpec` still pass (access-helper file named by a row, Forbidden producer counts unchanged)

## 3. Audit and probes

- [x] 3.1 Audit every caller of `PipelineRunService.status` and the run-event/SSE/run-id exposure paths (`PipelineRunStreamRoutes`, `PipelineRunRegistry`, `runs/latest`, history, MCP, logs) for user-free lookups; record findings in the PR description (fix or file a follow-up for any hit)
- [x] 3.2 Probe `POST /api/patch-sets/preview` with an output update/delete edit and a valid payload; record the result; if it reproduces and HEL-1239 does not cover it, file a follow-up (do not fix here)

## 4. Gates

- [x] 4.1 `cd backend && nice -n 19 sbt testFull` passes (name any known flake: HEL-1228/1225/1215/1247); `openspec validate scope-run-status-lookup --type change` passes

## 5. Design-gate notes (round 1 CONFIRM; address during execution)

- [x] 5.1 Add ONE test asserting status + content-type + body are equal across all four arms: foreign pipeline, absent pipeline, absent run under an owned pipeline, run of pipeline A requested via visible pipeline B (run id normalised like `run()` does)
- [x] 5.2 Seed a fixed run id into the `PipelineRunCache` that `buildApi` builds, after `seedOwned()`, bound to the generated pipeline id; the row's `sites` still lists `PipelineRunService.scala`; add no `ServiceError.Forbidden` producer
- [x] 5.3 Rewrite (not just re-sign) `PipelineRunRoutesSpec` ~L331-355 (GET `/pipelines/any/runs/$runId` expecting 200; `cache.update` without `put`) to seed a real pipeline and a run bound to it; update `PipelineRunCacheSpec` 2-arg `put`; decide `update`'s pipelineId handling explicitly (preserve existing entry's id; an `update` on an absent key must not fabricate an unscoped entry)
- [x] 5.4 Refresh stale comments referencing `runService.status("latest")` (`PipelineRunRoutesSpec` ~L485, `PipelineRunLatestRoutes.scala` ~L34); frontend `fetchRunStatus` (pipelineService.ts) exists with no non-test caller -- note in the PR, do not delete

## Execution findings (HEL-1249)

- RED (unmodified code): row "GET pipeline run status" -> `foreign=Outcome(200,application/json,{"rowCount":1,"runId":"run-hel1249-seeded","rows":[{"secret":"owner-row"}],"status":"succeeded"})`, 200 was not equal to 404; 4-arm test -> absentRun 404 `Run not found: <RUN>` but foreign pipeline / absent pipeline / wrong pipeline all 200 + rows.
- Latent only: PipelineRunCache is written solely by SparkJobSubmitter.submit, which has no caller in main (HEL-202 dormant); no running backend can produce a hit today.
- 3.1 audit: PipelineRunService.status had one caller (this route). run-events gates on pipelineExistsShared; history and runs/latest use findByIdShared; no MCP/frontend caller (frontend fetchRunStatus in pipelineService.ts is test-only, left in place). No other user-free run lookup found.
- 3.2 probe: REPRODUCES with a valid payload for the OWNER on a real output (`{"edits":[{"target":{"kind":"output","id":"<real>"},"op":"update","patch":{"name":"y"}}]}` or op delete) -> 500. Root cause: PatchSetPreviewService builds PatchSetApplyContext without outputRepo (null), so PatchSetApplyResolvers.findOwnedOutput NPEs (PatchSetApplyResolvers.scala:773). /apply works (outputRepo wired). Not fixed here; follow-up to file unless HEL-1239 covers it.
