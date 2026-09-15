## 1. Frontend — types & registries

- [x] 1.1 Add `UpsertSourceConfig`/`UpsertSourceStep` to `frontend/src/features/pipelines/types/pipelineStep.ts` (target discriminated union, mode) and verify `tsc --noEmit` passes
- [x] 1.2 Add an `upsertsource` entry to `OP_TYPES` in `stepNarrowing.ts` (icon + label) and verify it appears in the add-step dropdown (`OpDropdown` renders one item per `OP_TYPES` entry)
- [x] 1.3 Add default/seed config for `upsertsource` in `stepNarrowing.ts`'s seed map — literal `{ mode: "append" }` (no `target` key, per design.md Decision 4) — and verify `handleAddStep`-equivalent test covers it
- [x] 1.4 Update `pipelineStepToStep`/narrowing so a persisted `upsertsource` step resolves to the real `OpType`, not `unsupportedOpType`, and verify with a unit test on `stepNarrowing.ts`

## 2. Frontend — step card editor

- [x] 2.1 Create `frontend/src/features/pipelines/ui/stepConfigs/UpsertSourceConfig.tsx`: a radio choice between "Use existing dataset" (filtered with `isStaticSource`/`s.type === "dataset"` from `sourcesSlice`/`fetchSources`, disabled with an inline explanation when `!isOwner`) and "Create new source" (name field), with no pre-selected target, and verify unit tests cover no-default-selection, the owner-enabled case, and the non-owner-disabled case. Thread `isOwner` down from `usePipelineDetailPage.ts` through `StepCard`/`StepOpEditor`/`stepCardState` props to `UpsertSourceConfig` — it currently only reaches the page header; this is a new prop on each, not a new computation
- [x] 2.2 Add the append/replace mode `Select` to `UpsertSourceConfig.tsx`, seeded to `"append"` when absent, gating a transition INTO `replace` behind `ConfirmInline` (Cancel reverts to the last committed mode; loading an already-`replace` step shows no confirmation; `replace` → `append` commits immediately), and verify unit tests cover: default-append-selected, confirm-then-commit, cancel-reverts, load-already-replace-no-prompt
- [x] 2.3 Wire `UpsertSourceConfig` into `StepOpEditor.tsx`'s dispatch ladder ahead of the `isUnsupportedOpType` fallback, and verify a unit test renders the real editor (not the "unsupported" notice) for an `upsertsource` step
- [x] 2.4 Add scoped `saveError` state to `useStepCardState` (set from a rejected `persist()`'s backend message via `extractErrorMessage` — add a specific fallback string there for an error carrying no backend message, rather than reusing a generic one that could mask a real-but-unparsed rejection; cleared at the start of the next `persist` attempt; MUST respect the existing `requestTokenRef` guard so an out-of-order/superseded rejected response never overwrites the result of a newer, still-in-flight or already-succeeded request), thread it into `UpsertSourceConfig`'s inline error display, and verify unit tests cover: the backend message shown verbatim, the token-guard (stale rejection doesn't clobber a newer success), the no-backend-message fallback, and that other op kinds' existing swallow-on-reject behavior is unchanged

## 3. helio-mcp

- [x] 3.1 Add an `upsertsource` config-shape block to `add_pipeline_step`'s description in `helio-mcp/src/tools/write.ts`, matching `pipeline-upsertsource-config` exactly (both target forms, both modes, identical not-found ownership behavior naming that the target must be owned by the PIPELINE OWNER not the calling agent, named cycle-rejection at write time)
- [x] 3.2 Apply the same documentation update to `update_pipeline_step`'s description if it separately enumerates step config shapes; otherwise state explicitly in the PR why no change was needed there
- [x] 3.3 Prove end-to-end against a freshly started (non-session-attached) built helio-mcp process talking to a real backend: `add_pipeline_step` with a `newSource` target, with an `existingSource` target owned by the caller (as pipeline owner), and an `existingSource` target that closes a cycle (an existing pipeline reading the source, per `pipeline-cycle-detection`'s direct-cycle scenario — a `newSource` target cannot form a cycle) — capture the raw tool responses as evidence

## 3a. Backend fix (driver-ruled, mid-execution — see design.md "Backend fix")

- [x] 3a.1 Add `case PipelineCycleGuard.PipelineCycleRejected(msg) => Left(ServiceError.BadRequest(msg))` to `PipelineService.classifyDbError` itself (~line 2340), leaving the two existing local arms (`:374`, `:818`) in place, and verify `sbt compile` succeeds
- [x] 3a.2 Investigate why HEL-1101/HEL-1100's own tests didn't catch the addStep/updateStep gap (wrong-path coverage vs. status-code-unpinned assertion vs. other) and record the finding in design.md
- [x] 3a.3 Add an API-level regression test per cycle-guarded write path (create, addStep, updateStep, duplicateStep, proposal-apply if separate) asserting HTTP 400 (not merely "not 200") and a named-cycle body, and verify `sbt test` passes
- [x] 3a.4 Re-run the fresh-helio-mcp live proof of the cycle-rejected case and confirm the tool response now carries the named-cycle message instead of a generic internal-error string

## 4. Tests & verification

- [x] 4.1 Run `npm run typecheck`, `npm run lint`, and the full `npm test` suite in `frontend/` and verify all pass
- [x] 4.2 Run the helio-mcp package's own build/typecheck/test commands and verify all pass
- [x] 4.3 UI-review the step card in both light and dark theme against the running dev app (per `feedback_visual_cohesion_gate`) and verify no new visual dialect is introduced
- [x] 4.4 Keyboard-only pass over the target picker and mode toggle, verifying focus order and that the destructive-replace confirmation is reachable and operable without a mouse
