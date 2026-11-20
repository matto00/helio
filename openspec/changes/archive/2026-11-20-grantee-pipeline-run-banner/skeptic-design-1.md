## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 87cf01a5f745fdd7315d21530a78a176ec83211a; the change dir is untracked.

### What I verified (with evidence)

- **Root cause of the banner: confirmed.** `PipelineAnalyzeReads.scala:142-145` calls `costInputGathering.gather(..., resolveRoot = dsId => dataSourceRepo.findByIdOwned(dsId, user))`. `findByIdOwned` (`DataSourceRepository.scala:180-185`) filters on `owner_id = caller`, so a grantee's root gives `kind = None`. `PipelineCostEstimator.classifyRoot` (`PipelineCostEstimator.scala:128-138`) then emits `unclassified-source`. `SpineStatusStrip.tsx:20-30` renders `denyReasonCopy` for each reason when `!autoRunnable`, and `denyReasonCopy.ts:62-63` maps it to "...a source type we don't yet recognize...". The client source list plays no part.
- **Parity of `findByIdInternal`: confirmed for the cost-estimator half.** `AutoRunTriggerService.scala:101` and `PipelineRunSupport.scala:107` both resolve roots with `findByIdInternal`. Pipeline access is gated earlier by `findByIdShared` (`PipelineAnalyzeReads.scala:40,47,182-183`), so a stranger still gets `NotFound`.
- **`countDatasetRows` DB context: resolved already.** It runs in `ctx.withSystemContext` (`DataSourceRepository.scala:204-215`). A grantee's dataset roots resolved through `findByIdInternal` get the owner's count. The design's "executor must check" item has its answer, but a test should still cover it.
- **What "reason codes only" really leaks:** see CR2. `CostReasonResponse` carries `detail`, and `classifyRoot`'s detail strings include the exact source kind.
- **Run entries:** grepped `frontend/src/features/pipelines` for run handlers. See CR3. Two of the entries the design names do not exist, and one real entry is missing from its list.
- **Role resolution:** `isOwner` already exists (`usePipelineDirtyAndOwner.ts:54-57`, from `currentPipeline.ownerId`). A `callerRole` selector already exists (`features/sources/hooks/useSourceSampleAccess.ts:43-47`). `callerRole` is computed server-side at `PipelineAnalyzeReads.scala:151-153`.
- **HEL-1782 precedent:** `openspec/changes/archive/2026-11-19-read-only-viewer-shell-polish/design.md` D1 and `DashboardMetaFacts.tsx:13,57-62` match the recipe the design quotes (lucide `Eye` at `ICON_SIZE.sm`, mono, `--text-xs`, muted, no pill). HEL-1782 also has D2, "Edit shortcuts inert". See CR4.

### Verdict: REFUTE

### Change Requests

1. **The owner-equality and trigger-parity claims are false for any pipeline with a schema-dependent step. Rescope them and say what a grantee actually sees.**
   - The step-config reasons in analyze come from `analyzed` (`PipelineAnalyzeReads.scala:174`, `toCostVerdictResponse` at 194-207). `analyzed` is built from `schemasByRoot`, which comes from caller-scoped `rootDsOpts` (`findByIdOwned`, lines 75-78 and 86-89).
   - For a grantee the root schema is empty. A `compute` step that references any column then fails `ExpressionEvaluator.validate(expr, Set())` (`ColumnSchemaInference.scala:63-66`, `ExpressionEvaluator.scala:180-181`). That adds `step-config-invalid`, which makes `autoRunnable` false **and `canRun` false for an editor**.
   - The trigger uses the schema-independent `RunConfigGate` instead (`AutoRunTriggerService.scala:109`). So the trigger's reasons differ from analyze's even for owners (HEL-1280 class).
   - Consequences:
     - (a) The spec scenarios "reasons/autoRunnable equal the owner's" and "Verdict agrees with the auto-run trigger … same reason codes" are wrong as written. A red test built on a realistic pipeline cannot go green without widening `rootDsOpts`. Widening it would put the source's name and schema in `sourceSchemas`, which breaks C10.
     - (b) After D1, a grantee on such a pipeline swaps "source type we don't yet recognize" for "A step in this pipeline has a problem…" (`denyReasonCopy.ts:56-57`). That message also reads like a bug, so the AC's intent ("neutral state … not a message that reads like a bug") is still missed.
   - Required revisions:
     - Scope the equality and parity requirements to `PipelineCostEstimator` reasons, `estimatedRows`, and the estimator half of `autoRunnable`, explicitly excluding `step-config-invalid`.
     - Add a compute-step pipeline to the D4 NOBYPASSRLS spec so the actual grantee outcome is recorded.
     - State in design.md that `rootDsOpts` must not change.
     - Either settle the grantee `step-config-invalid` behaviour in scope, or record it as a named follow-up. Raise it as a product question in the PR body (see "Product questions" below).

2. **`detail` strings exceed "reason code only".**
   - `classifyRoot` builds `Root '<rootId>' is a remote source ('sql')` and `... URL-backed source ('csv')`. `rows-above-threshold` carries the exact count. All of these pass through `CostReasonResponse(r.code, r.detail, r.stepId)` (`PipelineAnalyzeReads.scala:204`).
   - The driver constraint says nothing beyond the reason code may reach a grantee, and the design's D1 privacy paragraph and spec omit `detail`.
   - Required revision: either redact or neutralize `detail` for non-owner callers, inside `PipelineAnalyzeReads`, with no wire-shape change; or explicitly state that `detail` reveals the exact kind and URL-backedness and record that as accepted, with the D4 test asserting the `detail` content. Pick one in design.md. Do not leave it implicit.

3. **The run-entry inventory is wrong. Fix the design, the spec delta and the tests.**
   - There is no schedule-dialog "Run now". `onRunNow` (`usePipelineDetailSaveWiring.ts:83`) is the action on the draft-save "run refused" warning toast (`usePipelineDraftSettle.ts:116-121`). `PipelineScheduleDialog` gets no run prop (`PipelineDetailDialogs.tsx:96-103`).
   - There is no run action on the run-history modal. `RunHistoryModal` has only `onRetry`, a refetch (`RunHistoryModal.tsx:162-206`).
   - `PipelineDetailDialogs`'s `onRunPipeline` (line 56) feeds **`OutputEditorSheet` → `OutputSheetPreviewCard`'s "Run pipeline" button** (`OutputSheetPreviewCard.tsx:61-69`). A viewer can reach it by opening an Output that has not been in a saved run. It is missing from the gated list.
   - Correct D2, the proposal and `pipeline-detail-spine-layout/spec.md` to name the real entries:
     - header Dry run / Run pipeline / Save & run
     - phone pills
     - the Output sheet's Run pipeline
     - the save-toast "Run now" (unreachable for a viewer, but gated by the handler early return)
     - "Run to update" (already `canRun`-gated)
   - Add the Output sheet button to the jest coverage and the viewer e2e.
   - The phone step sheet (`MobileStepSheet.tsx`) has no run entry. Record that in the audit rather than leaving it in the spec as if it had one.

4. **Hiding Discard while leaving draft creation open strands a viewer, and it conflicts with the driver constraint.**
   - The driver constraint says "Follow HEL-1782's viewer precedent (hide edit affordances; 'View only' indicator)". The design instead lists hiding edit affordances as a Non-Goal.
   - The design then hides Discard (`PipelineSpineHeader.tsx:193-200`, `MobilePipelineActions.tsx:60-68`) while a viewer can still edit steps into a client-only draft. That leaves a draft they cannot discard. The page would also show "View only" beside fully editable step cards, a Rename item, and Edit/Pause schedule menu items (`PipelineSpineHeader.tsx:62-75`, `MobilePipelineHeader.tsx:62-74`), all of which the server refuses.
   - Required revision, choosing one:
     - (a) Hide or disable edit affordances for a viewer, as the driver constraint reads; or
     - (b) Keep Discard for a viewer who has a draft, document the deviation from the driver constraint explicitly, and get it ruled before execution.
   - Either way, the phone draft status slot ("Draft · unsaved changes") must be accounted for.

5. **The phone layout-gap mechanism is misnamed.** No `--mobile-actions-height` exists. The tab body's bottom padding uses `--pipeline-mobile-actions-h` (`PipelineMobile.css:268`). Name the real variable, and the place that sets it, in D3 and task 3.3. Otherwise the "must be 0" check is unfalsifiable.

6. **Define the `pending` fallback.** Under D2 a grantee stays `pending` until analyze returns. If analyze errors or never resolves, an editor permanently loses Run controls with no explanation. State the behaviour on analyze failure and add a jest case. Also confirm that an owner's `currentPipeline.ownerId` and `currentUser` are both present on the first header paint after a direct deep link, or the "owner never sees controls appear late" claim does not hold.

### Product questions the ticket does not settle (for the orchestrator/driver)

- **Q1:** What should a grantee see when analyze reports `step-config-invalid` only because their root schema is caller-scoped (CR1b)? Is fixing that in scope for HEL-1661 (AC2's "reads like a bug" intent), or a follow-up?
- **Q2:** How far does viewer read-only go on the pipeline page (CR4)? The driver constraint says "hide edit affordances"; the design defers that. A ruling is needed if the design keeps the narrower scope.
- **Q3:** Is it acceptable for `detail` to reveal the exact source kind (`sql`/`rest_api`) and URL-backedness to grantees (CR2)?

### Non-blocking notes

- Reuse the existing `callerRole` selector in `useSourceSampleAccess.ts:43-47` and `isOwner` from `usePipelineDirtyAndOwner.ts`, rather than adding a parallel selector.
- The claim that "`features/pipelines/ui` has no role gating at all" is inaccurate: `isOwner` already gates Share and upsert-target choices. It does not affect the plan.
- `RunHistoryList`'s empty-state copy, "Run or dry-run this pipeline to see its history here." (`RunHistoryModal.tsx:184`), invites a viewer to do something they cannot. Consider a viewer variant.
- Pre-existing and out of scope: `countDatasetRows` omits zero-row datasets, and `gather` treats the missing key as `None`, so the row estimate becomes unavailable. This contradicts its own doc comment. It affects owners equally.
