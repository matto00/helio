- `frontend/src/features/pipelines/hooks/useRunHistory.ts` — new: per-page-open token, on-demand/boot-when-truncated/forced post-run run-history loading, freshness and modal view state
- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` — drops the unguarded run-history effect; chains the truncated-banner fetch off this open's pipeline fetch; forced post-run refresh; per-mount data-sources guard; hook-exposed pipeline retry; click-time run-history open/close
- `frontend/src/features/pipelines/state/pipelinesSlice.ts` — `fetchPipelineRunHistory({pipelineId, openId, force})` with in-flight `condition`, latest-request-wins, per-pipeline status/requestId/openId/loadedOpenId
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — wires `openRunHistory`/`closeRunHistory`/retry and the modal's view; error-state Retry uses the hook's retry
- `frontend/src/features/pipelines/ui/RunHistoryModal.tsx` — loading and error states, count-free title unless fresh
- `frontend/src/features/pipelines/state/pipelinesSlice.test.ts` — run-history thunk tests migrated and extended (dedupe, cross-pipeline/open, force, latest-wins)
- `frontend/src/features/pipelines/ui/PipelineDetailPage.runHistory.test.tsx` — new RTL file: on-demand fetch, StrictMode revisit, revisit/late-response/A-B-A freshness, modal close on id change, error/Retry, forced post-run refresh, StrictMode data-sources dedupe
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — modal/banner/boot-fetch tests migrated to mock `fetchRunHistory` and await it; `makeStore` fixture gains the four new slice fields
- `frontend/src/features/pipelines/ui/RunHistoryModal.test.tsx` — new props on existing renders; loading/error/count-title tests
- `openspec/changes/pipeline-detail-boot-cost/{boot-audit.md,measurements.md,tasks.md,files-modified.md,logs/**}` — evidence and records

Throwaway, created and deleted before the final commit (never committed): `e2e/zz-hel1354-lib.ts`, `e2e/zz-hel1354-probe.spec.ts`, `e2e/zz-hel1354-measure.spec.ts`, `e2e/zz-hel1354-throttle-hel910.spec.ts`, `e2e/zz-hel1354-profile.spec.ts`. Scratch `git worktree` of base 70b063a47 (outside the repo, removed) and a temporary `main.tsx` StrictMode edit (reverted, never committed).

Cycle 2: logs renamed `*.log` -> `*.log.txt` (gitignored otherwise), provenance/truncated-open/split notes in `measurements.md`, stale count 7 in `PipelineDetailPage.runHistory.test.tsx`. Throwaway `e2e/zz-hel1354-{lib,probe,measure}.ts` re-created for the committed-head re-run and deleted again before commit.
