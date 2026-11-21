## Standing Constraints

- [C1] Never read/cat/grep/source/print or copy any .env file or a tree containing one; never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ). scripts/concertino/.concertino.env may be read by scripts, never printed.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with stop-servers.sh; delete test residue with buildUserDeleteSql by exact id; plain emails.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; never a background run past the tool timeout.
- [C6] Red first with mutations; full spec files; record and COMMIT the red run before implementation code.
- [C7] Scratch in .concertino/scratch/HEL-1798/; follow-up references in .concertino/runs/HEL-1798/evidence/.
- [C8] Lane-private DB helio_hel1798: DATABASE_URL for start-servers.sh, Playwright, e2e cleanup, and every DB-touching jest/commit-hook run; any backend started with ANTHROPIC_API_KEY exported empty.
- [C9] No prod, release, concertino sync or MCP deploy; no claude.ai session link in commits or PR bodies.
- [C10] Do not edit usePipelineDraftUndo.ts (HEL-1792) or CI workflow/shard files (HEL-1793); scope is the eight hooks, and a newly found in-scope site means escalate, not widen.

### Frontend

## 1. Enumerate

- [x] 1.1 Per design.md Context (post-await.sh at openspec/changes/archive/2026-11-20-reset-per-user-state-on-logout/post-await.sh), enumerate dispatches, dispatching-helper calls and service calls after await/.then in all of features/pipelines/hooks; commit post-await-sites.md with dispositions; verify every design table row is present.

## 2. Red tests (commit before any fix)

- [x] 2.1 usePipelinePageLoad: mount-effect steps/Outputs settles and retryStepsLoad's analyze after clearAuth; red.
- [x] 2.2 usePipelineStepStructure: aggregate tail, no syncSteps/createOutput/deletePipelineStep/fetchOutputs/previewOutput after clearAuth; red.
- [x] 2.3 usePipelineDraftSave: no saveDraft request, no draftSaveRunPending, settle or failed dispatch, and reload adopts nothing, after clearAuth; red.
- [x] 2.4 useOutputImmediateActions: no previewOutput after clearAuth; red.
- [x] 2.5 useRunHistory: no fetchPipelineRunHistory after a truncated fetchPipelineById lands post-clearAuth; red.
- [x] 2.6 usePipelineRootAndToggleActions: duplicate step, add root and remove root issue no fetchPipelineById/steps resync after clearAuth; red.
- [x] 2.7 usePipelineStepMutations: handleRemoveStep does not resync steps after clearAuth; red.
- [x] 2.8 usePipelineRunAndSaveActions: run and dry run issue no run-history/preview refresh after clearAuth; red.
- [x] 2.9 Commit the red run output (red-run/) with the tests in one commit, before any fix.

## 3. Fix

- [x] 3.1 Apply design.md D1-D3 in the eight hooks; each 2.x test turns green.
- [x] 3.2 One mutation per hook (remove a new check) turns its test red; record in mutation-runs/.

## 4. Tidy

- [x] 4.1 Remove the duplicated guard test; guard suite passes with one fewer test.
- [x] 4.2 Comment the casts in recentVisitsListeners.ts; lint passes.
- [x] 4.3 Split sessionStateAllowlist.ts per design.md D5; guard results unchanged.

### Tests

## 5. Verify

- [ ] 5.1 Full frontend jest (3 workers), lint, typecheck, format:check pass.
- [ ] 5.2 e2e hel1634-logout-user-switch.spec.ts and pipeline-page specs exercising these hooks pass against helio_hel1798.
