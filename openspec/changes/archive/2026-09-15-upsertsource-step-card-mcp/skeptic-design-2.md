## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD: 2cebcabbb4c43f0def242959d29aa448a0d5768b

### What I verified (with evidence)
- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/upsertsource-step-card-mcp/HEL-1102`.
- I re-read design.md, specs/pipeline-upsertsource-editor/spec.md, tasks.md, ticket.md, and skeptic-design-1.md myself.
- **CR1 (save-error channel): resolved.** Decision 6 and task 2.4 now add new `saveError` state to `useStepCardState`. I confirmed the premise: `frontend/src/features/pipelines/hooks/useStepCardState.ts:226` `.catch(() => { // No-op ... })`. A real extraction helper exists: `frontend/src/services/extractErrorMessage.ts:17` reads `data.error`/`data.message`. The scope is written down (only upsertsource populates it, other ops keep swallowing, and the test asserts that). Clear-on-next-attempt is specified. The test goes through the real hook.
- **CR2 (ownership): resolved.** Decision 2 cites `PipelineService.scala:1830-1846` (confirmed: `validateTargetOwnership(cfg.target, ownerUser, ...)` at :1840). `isOwner` exists at `usePipelineDetailPage.ts:540`. The disabled-with-explanation UX is decided, the spec scenarios name the pipeline owner, and task 2.1 tests the non-owner case.
- **CR3 (filter): resolved.** Decision 1 and task 2.1 use `isStaticSource` / `type === "dataset"`.
- **CR4 (mode default): resolved.** Decision 4 gives the seed literal `{ mode: "append" }`. It also says a config with no mode displays append, and that re-selecting append is a no-op. The backend accepts this draft: `openspec/specs/pipeline-upsertsource-config/spec.md:45-53` says an absent target is not a write-time error. The editor spec wording now matches. Precedent confirmed: `stepNarrowing.ts:214` dedupe seeds `keep: "first"`.
- **CR5 (confirm vs persist): resolved.** Decision 5 says pending-mode state is local only and `persist` fires on Confirm. It also covers Cancel reverting, load-already-replace with no prompt, replace to append committing immediately, and going back re-prompting. The control is named as `Select`, which sibling editors already use (`SortConfig.tsx:64`, `FillNullConfig.tsx:90`). The spec scenarios cover each case.
- Non-blocking notes from round 1: the task 3.3 cycle proof now uses `existingSource`, and the MCP text now names the pipeline owner. Both folded in.

### Verdict: CONFIRM

### Non-blocking notes
- Task 1.3 still says "empty/incomplete-draft shape". Implement the literal `{ mode: "append" }` from Decision 4, and tidy the task text if convenient.
- `isOwner` today only reaches `PipelineDetailHeader`. The implementer must thread it down to `UpsertSourceConfig` (PipelineRiverView/LaneColumn → StepCard → StepOpEditor). Keep `StepCard`'s `React.memo` stable while doing it.
- `saveError` must respect the existing `requestTokenRef` guard: a stale rejection must not set an error that overwrites a newer in-flight or successful attempt. Clear it when a PATCH is dispatched, not only when one succeeds.
- Pass `extractErrorMessage` a specific fallback string. The helper returns the fallback for non-axios or bodiless errors.
