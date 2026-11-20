## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed on HEAD 87cf01a5f745fdd7315d21530a78a176ec83211a. The planning artifacts are untracked in the change dir. I formed my own view from the code first, then checked prior CRs.

### What I verified (with evidence)

- **Server citations hold** (`backend/.../services/pipelines/PipelineAnalyzeReads.scala`):
  - `rootDsOpts` comes from `findByIdOwned(dsId, user)` (lines 76-77).
  - Secondaries are resolved with `findByIdInternal` (80).
  - Upsert problems are computed as the owner (81).
  - The drift baseline uses `findByIdOwnedByInternal(…, pipeline.ownerId)` (99-104).
  - Cost `resolveRoot = findByIdOwned(_, user)` (144).
  - `toCostVerdictResponse` (194-207) builds `step-config-invalid` from `analyzed[].validationError`. It clears both `autoRunnable` and `canRun`.
  - The stale comments the design names are at 70-72 and 133-141.
- **D1 parity.** `AutoRunTriggerService.computeVerdict` (92-107) uses `gather(…, resolveRoot = dataSourceRepo.findByIdInternal)` plus `RunConfigGate.stepConfigReasons`, and it does not depend on the user. `triggerAutoRun(dataSourceId, user, now)` exists (61), so the D6 direct call is valid.
- **D2 message safety.**
  - `stepConfigProblem` = `StepConfigValidation.validateStepConfig(op, rawConfig)`, which is schema-independent by signature (`PipelineAnalyzeService.scala:25-26`). `checkEnabledStep` runs it before inference (32-41), so the "superset" claim in the trigger-agreement argument holds.
  - The typed-message example is real: `ExpressionTypeInference.booleanOperands` produces `'<op>' requires boolean operands, got <types>` (around line 78).
  - The "identical to caller-view error" branch leaks nothing new. An identical string must already be derivable from the caller's view.
- **Warnings stay safe.** `AnalyzeSchemaWarnings` emits a warning only from projections known to be complete. An empty (grantee-view) root is incomplete, so keeping `warnings` caller-view creates no bogus grantee warnings and no new detail.
- **Round 3 CR1 (`estimatedRows` leak) is resolved.**
  - `PipelineCostEstimator.estimateRows` (138-142) does fall back to the sum of dataset row counts.
  - D3 now limits a non-owner to `summary.lastRunRowCount` or absent. The spec's first requirement says the same.
  - D6 adds the never-run assertion on (b)/(e), red against a D1-only implementation, plus a mutation.
  - Risks were updated.
  - The client consumes `estimatedRows` only through AI-step cost disclosure (`usePipelineDetailPage.ts:235` → `StepOpEditor`/`MobileStepSheet`/`GenerateTextConfig`). An absent value is an existing state there.
- **Repo reads used by D2.** `findByIdOwnedByInternal` (`DataSourceRepository.scala:191-196`) has the same owner-filter semantics as the owner's own `findByIdOwned` (180-185), so the owner-view pass reproduces the owner's analyze exactly.
- **Client citations hold.**
  - `selectPipelineCallerRole` is at `useSourceSampleAccess.ts:43-47`.
  - `isOwner` is at `usePipelineDirtyAndOwner.ts:54-57`.
  - `analyzeStatus` is set to `loading`/`failed` while the previous `analyzeResult` is kept (`pipelinesSlice.ts:326-337`). This justifies D4 rule 2.
  - `ACTIONS_HEIGHT_PROPERTY` is set in `MobilePipelineActions`' layout effect and removed on cleanup (37, 44). Unmounting the bar resets the padding to the `0px` fallback (`PipelineMobile.css:268`).
- **Run-entry enumeration.** I grepped `runPipeline|dryRun|onRunNow|onRunPipeline|onDryRun` across `frontend/src`, excluding tests. The only page entries are the ones D4 names: header, mobile pills, `OutputSheetPreviewCard` (59, 67), `onRunNow` (`usePipelineDetailSaveWiring.ts:83` → toast at `usePipelineDraftSettle.ts:120`), and `runToUpdate` (gated by `canRun`). There is no keyboard run shortcut.
- **Precedent.** `VIEW_ONLY_TEXT` and the `Eye`/`ICON_SIZE.sm` recipe exist in `DashboardMetaFacts.tsx:13,57-62`. `MobilePipelineHeader.tsx` and `RunHistoryModal.tsx:184` exist as cited.
- **Q2 follow-up.** HEL-1794 exists: Backlog, label Follow-up, relatedTo HEL-1661 (checked via Linear).
- **Coverage.**
  - Every ticket AC maps to a D6 test: viewer desktop/phone light/dark e2e, grantee banner e2e, red-first commit.
  - Every driver constraint maps to C9/C10 and D6: `helio_app_test`, stranger 404, no new source detail, editor `autoRunnable` parity with the trigger, PR-body callout.
  - Q1 maps to D2, Q2 to D4/D5, and Q3 to D3.
  - Nothing is TBD. I found no proposal/design/tasks contradiction.

### Verdict: CONFIRM

The design is sound and implementable. Every prior change request is addressed. I found no new information-exposure path, and no product question is left unsettled by the ticket and the Q1-Q3 rulings.

### Non-blocking notes
- D6 (d)'s "the response contains no `float`" check could be brittle if some unrelated field ever carries that word. Scope it to the step's `validationError` and the reason `detail`, plus a whole-response check that excludes the step's own config.
- The cost reason codes themselves (`rows-above-threshold` vs none) reveal one coarse bit about the owner's dataset size on a never-run pipeline. Q3 explicitly grants grantees the codes, so this is within the ruling. Mention it in the PR body alongside the `estimatedRows` rule.
- While a draft exists and the role is `pending`, the reserved desktop slot holds Discard + Save & run, not Dry run + Run pipeline. The executor should size the reservation for whichever pair the draft state will show.
- D4 rule 2 keeps a stale `callerRole` until the next analyze succeeds (for example, after a grant change). This is acceptable and self-heals on the next result.
- Any client-side checks that read a step's caller-view `inputSchema` (empty for a grantee) are outside this AC. If one shows a problem state to grantees, it belongs in HEL-1794.
