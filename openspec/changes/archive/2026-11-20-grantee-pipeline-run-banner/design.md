## Context

See proposal.md (Why) and ticket.md (premise validation, driver constraints, owner rulings Q1-Q3). Verified on main 87cf01a5f (and by design-gate round 1, `skeptic-design-1.md`):

- `PipelineAnalyzeReads.analyze` admits owner/editor/viewer via `findByIdShared`. It then:
  - resolves `rootDsOpts` with `findByIdOwned(dsId, caller)` (lines 75-78); these feed `sourceSchemas` and `schemasByRoot`, hence every step's input/output schema, `validationError` and `warnings`;
  - resolves source-kind join/union secondaries with the privileged `findByIdInternal` (`resolveSecondarySourceSchemas`, line 79) — an existing precedent: a grantee already receives step schemas projected from a secondary they do not own;
  - gathers cost inputs with `resolveRoot = findByIdOwned(_, user)` (line 144), so an unowned root is `unclassified-source` (`PipelineCostEstimator.scala:131`);
  - builds `step-config-invalid` reasons from the analyzed steps' `validationError` (`toCostVerdictResponse`, 194-207), clearing `autoRunnable` and `canRun`.
- The run path (`PipelineRunSupport.scala:107`) and `AutoRunTriggerService` (line 101) resolve roots with `findByIdInternal`. The trigger checks step config with the schema-independent `RunConfigGate.stepConfigReasons` (`PipelineAnalyzeService.stepConfigProblem`), not analyze's schema-aware inference (HEL-1280 class); this difference exists for owners today.
- `countDatasetRows` runs in `withSystemContext` (`DataSourceRepository.scala:204-215`).
- `findByIdOwnedByInternal(dsId, ownerId)` (HEL-1503/HEL-1516) reads a source as the given owner sees it, system context plus explicit `owner_id` filter; analyze already uses it for the drift baseline (`primaryOwnerViewF`).
- Some inference messages carry text derived from the input schema, so owner-view messages are not automatically safe for a grantee: e.g. `ExpressionTypeInference.scala:78` (`'<op>' requires boolean operands, got <types>`, types from the input schema) and the union collision text in `MultiInputSchemaInference.scala:90`. (`ColumnSchemaInference.scala:126-128`'s groupBy-type message is config-derived, not an example.)
- Existing owner-view exposure precedents: `resolveSecondarySourceSchemas` (privileged) and the drift baseline (`sourceSchemaDrift`, owner view via `findByIdOwnedByInternal`). This change adds none.
- Client:
  - `SpineStatusStrip` renders `denyReasonCopy` of each reason when `!autoRunnable`; `step-config-invalid` copy is "A step in this pipeline has a problem…".
  - Run entries (skeptic CR3, re-verified by the executor's audit): `PipelineSpineHeader` Dry run / Run pipeline / Save & run (+ Discard); `MobilePipelineActions` the same as pills; `OutputSheetPreviewCard` "Run pipeline" (`OutputSheetPreviewCard.tsx:61-69`, via `PipelineDetailDialogs` `onRunPipeline`); the draft-save "run refused" toast's Run now (`usePipelineDraftSettle.ts:116-121`, `onRunNow`); `SpineStatusStrip` "Run to update" (already `canRun`-gated). No run entry in the schedule dialog, the run-history modal or `MobileStepSheet`.
  - Existing selectors: `selectPipelineCallerRole` (`features/sources/hooks/useSourceSampleAccess.ts:43-47`); `isOwner` (`usePipelineDirtyAndOwner.ts:54-57`, from `currentPipeline.ownerId` vs current user).
  - Phone bottom clearance: `ACTIONS_HEIGHT_PROPERTY = "--pipeline-mobile-actions-h"`, set by `MobilePipelineActions`' layout effect from the bar's `offsetHeight`, read by `PipelineMobile.css:268`.
- Precedent: HEL-1782 D1 "View only" (`VIEW_ONLY_TEXT`, `DashboardMetaFacts.tsx:13,57-62`: lucide `Eye` `ICON_SIZE.sm`, `--font-mono`, `--text-xs`, `--app-text-muted`, no pill, visible, not `aria-hidden`).

## Goals / Non-Goals

**Goals:** every AC, driver constraint and owner ruling in ticket.md; each behaviour locked by a test that fails without the change.

**Non-Goals:**
- No wire-shape change, no migration, no change to `PipelineService.scala`, `PipelineCostInputGathering`'s signature, `RunConfigGate` or the trigger.
- `rootDsOpts`, `sourceSchemas`, step input/output schemas and `warnings` keep their caller-view computation (driver: no new column names/types to a grantee). The drift baseline and the sample path are untouched.
- Full viewer read-only of the pipeline page (step editing, rename, schedule edit/pause, outputs): follow-up ticket per Q2.
- Pre-existing: `countDatasetRows` omits zero-row datasets (affects owners equally; skeptic non-blocking note).

## Decisions

### D1. Cost-estimator roots from the privileged read

`resolveRoot = dataSourceRepo.findByIdInternal` in `PipelineAnalyzeReads.analyze`, for every caller. Safe because `findByIdShared` already confirmed access; identical to the run path and the trigger, so the estimator half of the verdict agrees across analyze, manual run and auto-run. For an owner this differs from today only for a root the owner does not own, which normal binding does not produce.

Alternative rejected: client-side suppression of `unclassified-source` (leaves `autoRunnable`/`canRun` wrong).

### D2. Step validity from an owner-view validation pass (Q1)

- When the caller is not the owner, resolve the owner's root schemas with `findByIdOwnedByInternal(dsId, pipeline.ownerId)` for each root (same root list, same order as `rootDsOpts`), and run `PipelineAnalyzeService.analyzeNodes(nodeInputs, ownerSchemasByRoot, secondarySchemas)` a second time, overlaid with the same `upsertProblems`. Call it `ownerProjections`. For the owner, `ownerProjections` is the existing `projections` (no second pass, no extra query).
- `ownerProjections` is used ONLY to decide validity:
  - the `step-config-invalid` reasons and the `autoRunnable`/`canRun` clearing in `toCostVerdictResponse`;
  - which steps carry a `validationError` in the response.
- Everything else in the response (`sourceSchemas`, each step's `inputSchema`/`outputSchema`, `warnings`) still comes from the caller-view `projections`, byte-for-byte as today.
- **Message text for a non-owner** (owner ruling: no new column names or types; `ExpressionTypeInference.scala:78` shows owner-view messages can carry schema types):
  - if the step fails the schema-independent `stepConfigProblem(op, rawConfig)`, use that message (it is derived from the step's own config only, which a grantee already receives from the steps route);
  - else, if `ownerProjections` reports an error identical to the caller-view `projections` error for that step (e.g. the upsert-target problems, already computed as the owner and sent to grantees today), keep that text;
  - else, if `ownerProjections` reports an error, use one fixed neutral sentence (e.g. "This step's configuration does not match its input."), the same for every step kind;
  - else, no `validationError`.
  The same text is the `step-config-invalid` reason's `detail`. Owners keep today's messages unchanged.
- An accurate verdict does not require sending any schema to the grantee, so no escalation is needed on that point. If the executor finds a case where it would (e.g. the client needs owner-view schemas to render something the AC requires), it stops and raises an `ESCALATION` rather than widening any response.
- **Trigger agreement (owner ruling):** they must keep differing in one respect, and identically for owner and grantee. The trigger's `RunConfigGate` is schema-independent by design (it runs on a dataset write with no analyze pass), while analyze's schema-aware inference is a strict superset of it (`checkEnabledStep` runs `validateStepConfig` first). After D1+D2:
  - a pipeline valid for the owner: analyze (any caller) has no `step-config-invalid`, the trigger has none, and the estimator reasons are identical (same `findByIdInternal` roots, same `PipelineCostEstimator`) → same eligibility;
  - a config the trigger rejects: analyze rejects it too (superset);
  - a step valid by config but invalid against the owner's schema: analyze flags it, the trigger does not — the existing HEL-1280-class gap, unchanged and equal for owner and grantee.
  Making them identical would mean changing the trigger or weakening analyze, both out of scope. The PR body states this.
- Alternative rejected: widening `rootDsOpts` to the owner view (sends source name and schema to grantees).
- Alternative rejected: dropping schema-aware validation for grantees only (a grantee would see "valid" where the owner sees an error).

- Update the stale comments at `PipelineAnalyzeReads.scala:70-72` and `133-141` that document the old `findByIdOwned` cost resolution.

### D3. Neutral cost-reason detail for non-owners (Q3)

In `toCostVerdictResponse`, when the caller is not the owner, every reason produced by `PipelineCostEstimator` gets a fixed per-code neutral `detail` (a small map in `PipelineAnalyzeReads`, one constant sentence per code, containing no source kind, URL wording or digits; unknown code → a generic constant). `step-config-invalid` detail follows D2. Owners unchanged. Wire shape unchanged (`detail` stays a string). The client renders `denyReasonCopy(code)`, so no client copy change.

**`estimatedRows` for a non-owner** is `summary.lastRunRowCount` when the pipeline has a last run (already grantee-visible in the header, `SpineLastRunMeta`), otherwise absent. It is never the owner's live dataset row count: `PipelineCostEstimator.estimateRows` falls back to the sum of dataset row counts on a never-run pipeline, and after D1 that would newly reach grantees (including viewers, who never get `sourceRowCount`), defeating this decision. Reason codes and `autoRunnable` stay the owner's. Owners unchanged.

### D4. Client: role gate for run entries (Q2)

- One hook `usePipelineRunRole(pipelineId)` returning `"owner" | "editor" | "viewer" | "pending"`, built from the existing `isOwner` and `selectPipelineCallerRole` (no parallel selector). Analyze is re-dispatched on every debounced edit, by the watchdog and on reload, and `analyzeStatus` returns to `loading` each time while the previous `analyzeResult` is kept (`pipelinesSlice.ts:326-337`), so the rule reads the most recent RESULT, never the current status alone:
  1. `owner` when `isOwner` is true. The executor confirms, with a jest test rendering the page from a direct deep link, that `currentPipeline.ownerId` and the current user are both present on the first header paint; if not, the owner falls through to rule 2 and the reserved slot (below) prevents shift.
  2. else, when `analyzeResult[pid]` exists: its `callerRole`, whatever `analyzeStatus` is now (a later `loading` or `failed` never changes a known role);
  3. else, no result yet and status idle or loading: `pending`;
  4. else, no result and status `failed`: `editor` (show the controls; the server still refuses a viewer's run).
  Jest cases: each rule; a viewer stays `viewer` through a later `loading` and a later `failed`; an editor keeps visible, enabled controls through a re-analyze `loading`.
- `canRunFromUi = role === "owner" || role === "editor"`.
- Gated (hidden, not disabled; HEL-1782 hides): header Dry run, Run pipeline, Save & run; phone Dry run, Run pipeline, Save & run pills; `OutputSheetPreviewCard` Run pipeline (prop passed only when `canRunFromUi`); the save toast's Run now (action omitted for a viewer). `handleRunPipeline`, `handleDryRun`, `saveAndRun`'s run step and `onRunNow` return early when the role is `viewer` (defence for any path the audit finds). Discard stays for everyone with a draft.
- **Layout rule (desktop).** The trailing group is right-aligned (`.spine-header__trailing`, `margin-left: auto`). While `pending`, the run slot is rendered empty with the min-width of Dry run + Run pipeline, so an editor's controls appearing move nothing. When the role resolves to `viewer`, the empty slot is removed and the schedule chip and ⋮ shift right once; this one-time shift on resolve is accepted (at most once per page load, never after) and recorded with before/after screenshots in scratch. "View only" does not go in the trailing group (D5). Owners never pass through `pending` (rule 1) and see no change.
- **Layout rule (phone).** While `pending`, the pill row renders at its normal height with no pills. On `viewer` with no draft the action bar unmounts (D5).
- The executor's audit greps `handleRunPipeline`, `handleDryRun`, `runPipeline(`, `saveAndRun`, `onRunNow`, `onRunPipeline`, `Run to update`, `Run pipeline` across `frontend/src` and records each hit and its gate in `.concertino/scratch/HEL-1661/run-entry-audit.md`. `PanelContent.tsx:212` (a dashboard panel's "Run pipeline" that only navigates to the pipeline) is recorded as out of scope.
- `OutputSheetPreviewCard.tsx:59` ("Run the pipeline to populate it.") and `OutputHistoryModal.tsx:51` ("Run the pipeline to start recording this Output's history.") are listed in the audit as deferred to HEL-1794 (the Q2 follow-up).
- `RunHistoryModal`'s empty copy "Run or dry-run this pipeline to see its history here." gets a viewer variant ("No runs yet."), since it invites a viewer to act.

### D5. "View only" indicator

- Reuse `VIEW_ONLY_TEXT` and the HEL-1782 D1 recipe. Extract a shared presentational component only if the dashboard's DOM and CSS stay byte-identical; otherwise reimplement with the same tokens and a comment naming the dashboard source.
- Desktop: in the header's meta line beside `SpineLastRunMeta` (the pipeline counterpart of HEL-1782's `DashboardMetaFacts` placement: a meta fact, not an action). Phone: in `MobilePipelineHeader` beside the run status, at the existing line height.
- Shown only for `viewer`.
- Phone action bar for a viewer with no draft: render nothing (or a zero-height bar) so `--pipeline-mobile-actions-h` resolves to `0px`; the executor verifies the tab body's computed `padding-bottom` on the running app equals `var(--space-2) + var(--space-4)`. With a draft, the bar shows the draft status and Discard only.

### D6. Tests

- **Backend ScalaTest, NOBYPASSRLS `helio_app_test`** (shape of `Hel1516GranteeDriftPreviewSpec`). Pipelines: (a) CSV root + compute step referencing a root column (valid for the owner); (b) dataset root with rows; (c) a root with `source_url` (URL-backed); (d) a compute step `flag AND amount` over a boolean `flag` and a numeric `amount` owner root column (owner-view error `'AND' requires boolean operands, got boolean and float`); (e) an owner-owned dataset root plus a compute step referencing a root column, valid for the owner. Callers owner/editor/viewer/stranger. Assert:
  - codes and `autoRunnable` equal the owner's; no `unclassified-source`; (a) has no `validationError` and no `step-config-invalid` for grantees, editor `canRun` true, viewer `canRun` false;
  - (d) grantee: the step is invalid, `validationError` and the reason `detail` are the neutral sentence and the response contains no `float`; owner keeps the exact typed message;
  - (b) and (e) never run: the owner's `estimatedRows` equals the dataset row count; the editor's and viewer's are absent. After one run, a grantee's `estimatedRows` equals `lastRunRowCount`. (Red against a D1-only implementation.)
  - grantee estimator `detail` matches the neutral map (no kind, URL wording or digits); owner `detail` unchanged;
  - grantee caller-view fields as explicit expected values written literally in the test, not a captured snapshot: each `sourceSchemas` entry has name `""` and empty fields; step input/output schemas contain no root column; `warnings` as main produces them;
  - stranger → `NotFound`;
  - trigger agreement on (e) and (b): call `AutoRunTriggerService.triggerAutoRun(datasetId, editor, now)` with the editor as the user and assert its result (allowed, or denied with codes) equals the eligibility and estimator codes in that editor's analyze response. Red on main: the editor's analyze for (e) carries `unclassified-source` and `step-config-invalid`; the trigger carries neither.
  Red first: equality, validation and detail assertions fail on main.
- **Jest:** `usePipelineRunRole` (owner, pending, editor, viewer, analyze failed); header, mobile actions, Output sheet card and save toast hide run entries for viewer, keep Discard, show "View only"; editor unchanged; run handlers no-op for viewer; run-history empty copy for viewer.
- **e2e (red first, committed before implementation):**
  - `e2e/hel1661-viewer-run-controls.spec.ts`: viewer on desktop and phone viewports, light and dark: Run pipeline / Dry run `toHaveCount(0)`, "View only" visible; viewer opens an Output sheet: no Run pipeline; editor control case shows both.
  - `e2e/hel1661-grantee-source-banner.spec.ts`: editor and viewer on pipeline (a): after the analyze response (wait on the response, not a timeout) neither "source type we don't yet recognize" nor "A step in this pipeline has a problem" is present; an editor's Run pipeline is enabled.
  - Seed through the API with plain emails; delete residue by exact id.
- Mutations recorded in evaluation evidence: revert D1; revert D2 (use caller-view validity); revert D3; return the owner's `estimatedRows` to grantees; remove each of the desktop, phone and Output-sheet gates. Each must turn a named test red.

## Risks / Trade-offs

- [Second `analyzeNodes` pass for grantees] → Pure in-memory walk plus one root read per root; owners pay nothing extra.
- [A grantee learns a step is invalid without the reason] → Neutral text by owner ruling; the owner still sees the detail.
- [Editor `autoRunnable`/`canRun` flip on many shared pipelines] → This is what run and trigger already do; D6 parity locks it; called out in the PR body.
- [Raw estimator detail on the write path (pre-existing)] → The trigger's `Denied.reasons` returned to a dataset/form writer still carry raw detail (`AutoRunTriggerService.scala:144-152`, `DataSourceService.scala:121-132`). Q3 ruled on analyze; named in the PR body and offered to the driver as a follow-up.
- [`analyzeConcise` still validates against the caller's view] → MCP/concise only, outside the UI AC; named in the PR body as a follow-up candidate.
- [`estimatedRows` for grantees] → Last-run count or absent, never the live dataset count (D3); locked by D6.
- [Existing e2e selectors] → Owner/editor names unchanged; executor greps `e2e/` for each touched selector and matches tests by title.

## Migration Plan

None. Rollback is a revert.
