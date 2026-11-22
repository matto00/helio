- `frontend/src/features/pipelines/hooks/usePipelineDraftCreate.ts` — capture session epoch before the create; return from `.then` if it changed (no flush of the in-flight edit)
- `frontend/src/features/pipelines/hooks/usePipelineShapeInstantiation.ts` — epoch check after each step/Output create and in the `catch` before the toast
- `frontend/src/features/pipelines/hooks/usePipelineRunStream.ts` — mount-time epoch; `onTerminal` returns after `setSseActive(false)` when it changed
- `frontend/src/features/pipelines/hooks/usePipelineDraftUndo.ts` — epoch check after `undoPatchSet` and after `getPipelineWithDefinition`
- `frontend/src/features/pipelines/hooks/usePipelineDraftCreate.sessionEpoch.test.tsx` — new: sign-out test + same-session control
- `frontend/src/features/pipelines/hooks/usePipelineShapeInstantiation.sessionEpoch.test.tsx` — new: step, Output and catch-toast tests + controls
- `frontend/src/features/pipelines/hooks/usePipelineRunStream.sessionEpoch.test.tsx` — new: terminal-after-sign-out test + control (seeded Output)
- `frontend/src/features/pipelines/hooks/usePipelineDraftUndo.sessionEpoch.test.tsx` — new: two sign-out tests + control (seeded savedToastRef)
- `frontend/src/features/pipelines/hooks/usePipelineStepStructure.sessionEpoch.test.tsx` — added same-session aggregate-tail rollback test
- `openspec/changes/gate-remaining-pipeline-post-await/{red-run,mutation-runs}/*.txt` — red run on unmodified hooks and per-check mutation runs

Note: tests and fix are committed together (red run kept as .txt evidence in red-run/).
