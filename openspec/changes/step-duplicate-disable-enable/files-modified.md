# Files Modified: step-duplicate-disable-enable

## Backend — migration

- `backend/src/main/resources/db/migration/V86__pipeline_steps_enabled.sql` — new migration, coordinator-confirmed number; adds `pipeline_steps.enabled BOOLEAN NOT NULL DEFAULT true`.

## Backend — domain

- `backend/src/main/scala/com/helio/domain/PipelineStep.scala` — trait gains `def enabled: Boolean`.
- `backend/src/main/scala/com/helio/domain/steps/*.scala` (22 files: AggregateStep, AssertStep, CastStep, ChunkByTokenCountStep, ComputeStep, DateBucketStep, DedupeStep, ExtractHeadingsStep, FillNullStep, FilterStep, GroupByStep, JoinStep, LimitStep, LookupStep, PivotStep, RenameStep, SelectStep, SortStep, SplitTextStep, StringOpsStep, UnionStep, UnpivotStep, WindowStep) — each case class gains a trailing `enabled: Boolean = true` constructor param (default keeps every pre-existing 6-positional-arg call site — tests, `DemoData`-style seeds — compiling unchanged).

## Backend — repository

- `backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala` — `PipelineStepRow`/`PipelineStepTable` gain `enabled`; `insert`/`insertInternal`/`insertAtInternal` gain an `enabled: Boolean = true` param; `update`/`updateInternal` gain `enabled: Option[Boolean] = None` (None = no-change); `rowToDomain`'s 22-arm dispatch threads `row.enabled` through. 329 lines (over the 250 soft budget pre-change too; `check:scala-quality` reports it as an existing informational warning, not a new failure).

## Backend — protocol

- `backend/src/main/scala/com/helio/api/protocols/PipelineStepProtocol.scala` — sealed trait `PipelineStepResponse` gains `def enabled: Boolean`; all 22 per-kind response case classes gain `enabled: Boolean = true` (always serialized — `jsonFormat6`→`jsonFormat7`); `fromDomain` threads `s.enabled`; `CreatePipelineStepRequest` gains `enabled: Option[Boolean] = None`; `UpdatePipelineStepRequest` gains `enabled: Option[Boolean] = None`; both request formats `jsonFormat3`→`jsonFormat4`.

## Backend — services

- `backend/src/main/scala/com/helio/services/PipelineService.scala` — `analyze` filters `steps.filter(_.enabled)` before building `PipelineAnalyzeService` inputs (boundary iii); `analyzeProposal` filters `proposal.steps.filter(_.enabled.getOrElse(true))` (boundary iv); `persistNewStep` threads `req.enabled.getOrElse(true)` into `insertInternal`/`insertAtInternal`; `updateStep` threads `req.enabled` into both `updateInternal` call sites; new `duplicateStep(stepId, user)` (findByIdInternal → NotFound masking + editor/owner ACL → config round-trip decode → `insertAtInternal(..., originalListIndex + 1, existing.enabled)` → 201). 846 lines (pre-existing over-budget file; HEL-682 owns splits).
- `backend/src/main/scala/com/helio/services/PipelineRunService.scala` — `runPipeline` filters `allSteps.filter(_.enabled)` before `executeRun` (boundaries i/ii — covers both full run and dry run through one call site); `previewStep` rejects a disabled target step with 422 ("step is disabled") and filters the executed prefix `.filter(_.enabled)`.
- `backend/src/main/scala/com/helio/services/BoundPanelService.scala` — `projectSchema` filters `steps.filter(_.enabled.getOrElse(true))` before building analyze inputs (boundary v).

## Backend — routes

- `backend/src/main/scala/com/helio/api/routes/PipelineStepRoutes.scala` — new `POST /api/pipeline-steps/:id/duplicate` route (thin shell, mirrors the dashboard/panel duplicate route shape).

## Backend — tests

- `backend/src/test/scala/com/helio/domain/PipelineStepSpec.scala` — `enabled` defaults true across all 22 subtypes; explicit-`enabled=false` construction test.
- `backend/src/test/scala/com/helio/infrastructure/PipelineStepRepositorySpec.scala` — a raw row inserted without `enabled` defaults true (migration-default proof); `insert`/`insertAtInternal` persist `enabled=false`; `update` toggles + leaves unchanged when omitted.
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepProtocolSpec.scala` — `enabled` always serialized; a disabled step round-trips as `false`.
- `backend/src/test/scala/com/helio/api/PipelineStepRoutesSpec.scala` — create with/without `enabled`; PATCH `enabled` round-trips and survives a config-only PATCH unchanged; duplicate lands at index+1 with equivalent type/config/enabled (including a disabled clone), preserves config, 404 masking, 403 viewer.
- `backend/src/test/scala/com/helio/api/routes/PipelineAnalyzeRoutesSpec.scala` — analyze excludes a disabled step's entry entirely; the surviving step's input schema proves the disabled step never ran.
- `backend/src/test/scala/com/helio/api/routes/PipelineRunRoutesSpec.scala` — preview excludes a disabled step from the executed prefix; previewing a disabled target step returns 422.
- `backend/src/test/scala/com/helio/api/routes/PipelineAnalyzeProposalRoutesSpec.scala` — a proposal step carrying `enabled: false` is excluded from `analyzeProposal`'s response.
- `backend/src/test/scala/com/helio/api/routes/BoundPanelRoutesSpec.scala` — a disabled `select` step is excluded from `projectSchema`'s binding-gate projection (a metric binding that a live `select` would break still succeeds); confirms the disabled step is also skipped by the real run.
- `backend/src/test/scala/com/helio/services/PipelineRunServiceSpec.scala` — run/dry-run skip a disabled step (rename-column diff observed in written rows); all-disabled behaves as a zero-step passthrough; re-enabling restores the step with config intact.

## Schemas

- `schemas/create-pipeline-step-request.schema.json` — adds `enabled: boolean` (optional).

## Frontend — types

- `frontend/src/features/pipelines/types/pipelineStep.ts` — `BasePipelineStep` gains `enabled?: boolean` (wire type stays `Option`-shaped per the spray-json-omission precedent, even though the backend always sends it).
- `frontend/src/features/pipelines/types/step.ts` — `Step` gains `enabled: boolean` (always a real boolean by the time a `Step` is built).

## Frontend — state

- `frontend/src/features/pipelines/state/stepNarrowing.ts` — `makeStep` seeds `enabled: true`; `pipelineStepToStep` maps `ps.enabled ?? true`.
- `frontend/src/features/pipelines/state/stepNarrowing.test.ts` — `enabled` defaults/threading coverage for `makeStep`/`pipelineStepToStep`; existing `Step` fixtures updated with `enabled: true`.

## Frontend — services

- `frontend/src/features/pipelines/services/pipelineService.ts` — `normalizePipelineStep` (`enabled ?? true`) applied to `getPipelineSteps`/`createPipelineStep`/`updatePipelineStep`/`reorderPipelineSteps`; new `updatePipelineStepEnabled(stepId, enabled)` (PATCH `{enabled}`) and `duplicatePipelineStep(stepId)` (POST duplicate, no body).
- `frontend/src/features/pipelines/services/pipelineService.test.ts` — normalization + new-endpoint coverage, mirroring the existing schedule/run-history normalization tests.

## Frontend — UI

- `frontend/src/features/pipelines/ui/StepCard.tsx` — Disable/Enable + Duplicate icon buttons (siblings of drag handle/Move in the actions cluster); `--disabled` card modifier; preview button + preview fetch gated on `step.enabled`; preview fingerprint gains `enabledBits`; **cycle 2**: preview-refresh effect fix, see below. 529 → 615 lines (+86, cycle 1 +50 / cycle 2 +36).
- `frontend/src/features/pipelines/ui/StepCard.test.tsx` — toggle/duplicate delegation, disabled-card muting + hidden preview control, editor-stays-editable, no-error-chip, and `enabledBits`-triggered refetch coverage; fixtures updated with `enabled: true`; **cycle 2**: two new unit tests pinning the re-enable-never-fetches-immediately invariant.
- `frontend/src/features/pipelines/ui/PipelineRiverView.tsx` — computes `enabledBits` from its own `steps` prop; threads `onToggleStepEnabled`/`onDuplicateStep`/`enabledBits` to every `StepCard`. 289 → 307 lines (+18).
- `frontend/src/features/pipelines/ui/PipelineRiverView.test.tsx` — delegation coverage for the two new callbacks; fixtures updated with `enabled: true`.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — `stepsFingerprint` gains `enabled`; new `handleToggleStepEnabled` (optimistic flip → PATCH → reconcile; revert + toast) and `handleDuplicateStep` (POST → splice after original; toast, non-optimistic); both threaded into `PipelineRiverView`. 653 → 700 lines (+47).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — toggle optimistic-mute/persist/revert + duplicate-splice + fingerprint-re-triggers-analyze integration coverage; **cycle 2**: new fake-timers + deferred-PATCH regression test reproducing the re-enable/open-preview race end to end.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — `--disabled` card modifier (opacity-only, token language unchanged) and the two new action-button styles (reuse the existing 24×24 icon-button recipe — no new button style per `DESIGN.md` §5).

## Cycle 2 — evaluation-1.md change requests (re-enable/open-preview race)

**Root cause** (UI/component-effect layer, `StepCard.tsx`'s preview-refresh `useEffect`): a `step.enabled` false→true transition was treated identically to a fresh tray "activation" — disabling a step reset `lastFetchedFingerprint.current` to `null` (the same signal used for "never fetched since the user last opened the tray"), so re-enabling took the immediate/undebounced fetch branch instead of the 500ms-debounced one. That immediate GET raced the same click's own `PATCH /api/pipeline-steps/:id` (the enable), and when the GET reached the backend before the PATCH's DB write committed, `previewStep`'s defensive check (correctly, by design) returned `422 "step is disabled"` — which then stuck in `previewError` with nothing to retrigger a retry.

**Probe**: added `PipelineDetailPage.test.tsx`'s `"re-enabling a step with its preview open debounces the refetch instead of racing the enable PATCH"` (fake timers + a deferred `updatePipelineStepEnabled` promise the test resolves explicitly, so a real wire-timing gap is reproducible under jsdom) and ran it against the pre-fix code.

**Probe output** (pre-fix, red):
```
expect(received).toBe(expected) // Object.is equality
Expected: 1
Received: 2
  > 1882 |       expect(fetchStepPreviewMock.mock.calls.length).toBe(fetchCallsBeforeReEnable);
```
The preview fetch fired immediately on the optimistic re-enable click, before the deferred PATCH resolved and before any timer advanced — confirming the immediate/undebounced path fires exactly as diagnosed.

**Fix** (`StepCard.tsx`): the effect now (a) does NOT reset `lastFetchedFingerprint` to `null` when a step is merely disabled (only a user-initiated close/collapse resets it) and (b) tracks the step's previous-enabled state in a `wasEnabledRef`; when a run detects `wasEnabled === false` (a re-enable), it unconditionally takes the debounced branch — even when the recomputed `configFingerprint` happens to textually equal what was last fetched (a single-step pipeline's `enabledBits`+config round-trip back to the exact same string across a disable→enable cycle, which a naive fingerprint-equality check would otherwise treat as "nothing changed" and skip refetching entirely — a second, related bug the first fix attempt surfaced and this iteration also closes).

**Verification (fresh, post-fix)**: the same probe test → green; two new StepCard-level unit tests (`"re-enabling ... still debounces, never fetches immediately"` covering both the fingerprint-round-trip case and the never-fetched-while-disabled-from-mount edge case) → green; full `src/features/pipelines` suite (545 tests, was 542) → green; full frontend suite (1846 tests, was 1843) → green; `npm run lint` / `npm run format:check` / `npm --prefix frontend run build` → all green. Backend untouched this cycle (fix is frontend-only), so `sbt test` was not re-run.

## File-size budget notes (HEL-682 owns splits)

Pre-change (per ticket): StepCard.tsx 529, PipelineDetailPage.tsx 653, PipelineRiverView.tsx 289.
Actual post-change (end of cycle 2): StepCard.tsx 615 (+86), PipelineDetailPage.tsx 700 (+47), PipelineRiverView.tsx 307 (+18) — all three were already over the 250-line CONTRIBUTING.md soft budget before this change; growth here is incremental to that pre-existing state, not a new violation. `check:scala-quality`'s backend soft-budget warnings (`PipelineStepRepository.scala` 329 lines, `PipelineService.scala` 846 lines) are likewise pre-existing, informational-only.

## Spinoff candidate (not fixed in this change — out of design.md's scoped touch points)

`backend/src/main/scala/com/helio/services/PatchSetUndoInverse.scala`'s `fullPipelineStepInverse`/`pipelineStepCreateRequestFromResponse` read `type`/`config`/`position` directly off the raw persisted-step JSON but do not read `enabled`. Since the wire now always carries `enabled`, extending these two helpers to also propagate it would fix a latent gap: a PatchSet undo/redo that deletes-then-recreates a step (or fully reverts one) currently always recreates it enabled, silently dropping a disabled step's state. `design.md`'s Impact list and `tasks.md` do not touch `PatchSet*` files, so this is deliberately out of scope here — flagging for a follow-up ticket.

## Live-check pointers (for the evaluator)

This run used dev port 5844 / backend port 8751 (per the orchestrator's assignment) — do not leave servers running from this session; no servers were started by the executor (unit/integration tests only, per instructions). `sbt test` uses each spec's own embedded-Postgres instance (`EmbeddedPostgres`), not the shared dev DB — the V86 migration was exercised there, not against the shared dev Postgres. To manually verify against a running instance: start the backend (`cd backend && sbt run`, applies V86 to whichever DB `DATABASE_URL` points at — additive/instant-default, safe even if the parallel HEL-462 lane's V85 hasn't landed on that DB yet) and the frontend (`npm run dev`), then open a pipeline's detail page, confirm the Disable/Enable and Duplicate icon buttons appear as siblings of the drag handle and Move buttons on each StepCard header, and exercise: disable a step (card mutes, preview control disappears, analyze/preview reflect the skip), re-enable (restores), and duplicate (clone appears directly after the original, config+enabled equal).
