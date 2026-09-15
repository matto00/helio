## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `cf3edb22d5c5233adc0912a4c8dcae5931e585c6`. Base resolved live via `resolve-review-base.sh` to `2cebcabb`.

### What I verified (with evidence)

- **Backend fix is minimal.** `git diff 2cebcabb...HEAD -- backend/src/main` adds exactly one arm, `case PipelineCycleGuard.PipelineCycleRejected(msg) => ServiceError.BadRequest(msg)`, to `classifyDbError` (PipelineService.scala:2360), plus a comment. `PipelineCycleRejected extends RuntimeException` (PipelineCycleGuard.scala:29), so it never overlapped the `PSQLException` arm or the earlier arms. Before this change it could only reach `case other` (the 500). The two local arms at :374 and :818 are unchanged. The only other backend change is the new test file `PipelineCycleRouteStatusSpec.scala`: 4 real-route tests that assert `StatusCodes.BadRequest` and a body naming the cycle. This matches design.md's "Backend fix" section. There is no other scope creep.
- **Other consumers of the sentinel.** `upsertSourceConfigOf` / `isUnconfiguredUpsertTarget` / `existingSource` appear only in `stepNarrowing.ts`, `useStepCardState.ts`, `UpsertSourceConfig.tsx` and `pipelineStep.ts` (grep over frontend/src and helio-mcp/src, tests excluded). No other renderer receives an upsertsource config, so the sentinel fix covers every current consumer.
- **Gates re-run by me:**
  - `sbt test`: 4353 succeeded, 0 failed, EXIT=0.
  - Frontend `jest`: 317 suites / 3378 passed.
  - `npm run typecheck` and `npm run lint`: clean.
  - `helio-mcp`: `build` and `typecheck` clean; root `npx jest helio-mcp` 28 suites / 271 passed.
- **MCP live proof, re-run by me.** Spawned a fresh `node helio-mcp/dist/index.js` over stdio with a newly minted PAT against localhost:9441, which is confirmed to be this worktree's backend (via /proc cwd). The test pipeline `827cca5e…` has root dataset `a54bd1c5…`.
  - `add_pipeline_step` description contains the upsertsource block.
  - A `newSource` target succeeded.
  - An `existingSource` target (`db3a5c8b…`, mode replace) succeeded.
  - A cycle target (`a54bd1c5…`) returned `status 400 … HEL-1081 e2e dataset -> skeptic-1102-cycle -> HEL-1081 e2e dataset`.
  - Raw output: ref=/home/matt/Development/helio/.concertino/runs/HEL-1102/evidence/.skeptic-evidence/mcp-proof.txt
- **"UI renders a step the agent created" — FAILS when more than one upsertsource card is open.** I opened both agent-created cards on `/pipelines/827cca5e…`.
  - Read the live DOM `checked` property twice, and both reads matched. Card 2 (existingSource) had `existing:true`. Card 1 (newSource) had `existing:false, newSrc:false`, while its name field showed `skeptic_1102_new`. The page contains 4 radios, all with `name="upsertsource-target-kind"`.
  - Screenshot: ref=/home/matt/Development/helio/.concertino/runs/HEL-1102/evidence/.skeptic-evidence/skeptic-1102-agent-steps-open-light.png. Card 1 visibly has no target radio selected, even though its name field is showing.
  - Isolation check: I reloaded the page and opened only card 1. It then read `newSrc:true`. Opening a second card is what clears the first card's radio, which proves the page-global radio group is the cause.
- **Not re-run by me:** the fresh add-step sentinel reproduction. The sentinel normalization reads as correct (`dataSourceId === ""` maps to `undefined`), but the cross-card radio defect below affects that path too, so the fix below has to be re-verified live anyway.

### Verdict: REFUTE

### Change Requests
1. `frontend/src/features/pipelines/ui/stepConfigs/UpsertSourceConfig.tsx:604` and `:614`. `name="upsertsource-target-kind"` is a constant that every upsertsource card on the page shares. As a result, the browser treats all of those cards' radios as one group. Selecting or rendering a checked radio in one card clears the checked radio in every other card, and arrow-key navigation moves between cards.
   - Reproduced live: an agent-created newSource step renders with no target selected once a second upsertsource card is open.
   - Fix: give each card its own group name, e.g. from React `useId()` or the step id.
   - Add a test that renders two `UpsertSourceConfig` instances (one newSource, one existingSource) and asserts `toBeChecked()` on both at the same time.
   - Re-verify live with two cards open.

### Non-blocking notes
- The backend accepts an `upsertsource` step chained after another upsertsource step (parentStepId pointing at a terminal step). This came up in my MCP proof. It is outside this ticket; consider a spinoff if terminal steps should reject children.
- Test residue left in the shared dev DB: pipeline `skeptic-1102-cycle` (827cca5e…) and PAT `skeptic-hel1102` (expires in 1 day).
