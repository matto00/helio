## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 87cf01a5f745fdd7315d21530a78a176ec83211a (the change dir is untracked; there are no code commits yet). I formed my view from the code first and read skeptic-design-1.md only afterwards.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/pipeline-grantee-run-banner/HEL-1661`.
- **Analyze ground truth (`PipelineAnalyzeReads.scala`).**
  - `rootDsOpts` uses `findByIdOwned(dsId, user)` (76-78).
  - Secondaries use the privileged `findByIdInternal` (80). So a grantee already receives step schemas projected through a secondary they do not own, as the design says.
  - Upsert problems use the owner (81).
  - The drift baseline is owner-view through `findByIdOwnedByInternal` (99-104). This is a further existing precedent: `sourceSchemaDrift` already sends a grantee owner-view column names and types (added, removed and type-changed).
  - Cost `resolveRoot = findByIdOwned(_, user)` (144). `toCostVerdictResponse` (194-207) builds `step-config-invalid` from `analyzed`. The design's citations hold.
- **D2 superset argument.**
  - `checkEnabledStep` runs `validateStepConfig` first and only then inference (`PipelineAnalyzeService.scala:32-40`).
  - `stepConfigProblem` is that same function (25-26).
  - `RunConfigGate.stepConfigReasons` calls `stepConfigProblem` (`RunConfigGate.scala:18-23`).
  - The trigger's `computeVerdict` uses `findByIdInternal` roots and the same estimator (`AutoRunTriggerService.scala:93-112`). It does not depend on the user.
  - The superset claim is therefore correct, apart from one edge case: an enabled step whose node never resolves in `analyzeNodes` (dangling parent) is absent from `analyzed`, but the gate still checks its config. This is pre-existing and does not block.
- **D2 privacy.**
  - `stepConfigProblem` reads only `(op, rawConfig)`, so its message is config-derived, and the steps route already gives a grantee the config.
  - Real owner-schema-derived message text exists, so the neutral fallback is necessary. Examples:
    - `ExpressionTypeInference.scala:78`: `'<op>' requires boolean operands, got <types>`, where the types come from the input schema.
    - The union collision text in `MultiInputSchemaInference.scala:90`.
  - With the D2 rule (config message, else one fixed sentence), no owner-schema name or type can reach a grantee. No escalation is needed.
- **D3.**
  - Every estimator detail that carries a kind, URL wording or digits is in `PipelineCostEstimator.scala:98-131`.
  - A per-code map replaces all of them. The wire shape is unchanged.
- **D4 run-entry inventory, by grep across `frontend/src`.**
  - Header (`PipelineSpineHeader.tsx:189-240`).
  - Phone pills (`MobilePipelineActions.tsx`).
  - `OutputSheetPreviewCard.tsx:61-69`.
  - The save toast's Run now (`usePipelineDraftSettle.ts:116-121`, wired at `usePipelineDetailSaveWiring.ts:83`).
  - The run-history empty copy (`RunHistoryModal.tsx:184`).
  - The only other hit is `PanelContent.tsx:212`, a dashboard-side "Run pipeline" button that navigates to the pipeline (`onGoToPipeline`) and does not run it. It is outside this page; see the notes.
- **Analyze lifecycle (affects D4).**
  - `pipelinesSlice.ts:326-337` sets `analyzeStatus[pid] = "loading"` on every dispatch and keeps the previous `analyzeResult`.
  - Analyze is re-dispatched on debounce (`usePipelineDebouncedAnalyze.ts:130`), by the watchdog (`usePipelineAnalyzeDeferWatchdog.ts:55`) and on reload (`usePipelinePageLoad.ts:70,146`).
- **D5 phone clearance.**
  - `ACTIONS_HEIGHT_PROPERTY = "--pipeline-mobile-actions-h"` is set from `offsetHeight` and removed on unmount (`MobilePipelineActions.tsx:16,33-45`).
  - It is read with a `0px` fallback at `PipelineMobile.css:268`. The verification proposed in D5 is falsifiable.
- **Desktop trailing group.** `.spine-header__trailing` is `margin-left: auto; flex: none` (`PipelineSpineHeader.css:176-182`): right-aligned, in the order schedule chip, run buttons, ⋮.
- **Round-1 change requests.** All six are addressed:
  - CR1 is settled by Q1 and D2.
  - CR2 by Q3 and D3.
  - CR3: the inventory has been corrected.
  - CR4 by Q2: keep Discard, with a follow-up ticket.
  - CR5: the real variable is now named.
  - CR6: analyze failure and first paint are now defined.

### Verdict: REFUTE

The server design (D1-D3) is sound and honours Q1 and Q3. The refutation is about a defect in the client role hook, one contradiction among the artifacts, and two test or layout specifications that cannot be executed as written.

### Change Requests

1. **D4's role rule is keyed on analyze status and breaks during re-analyze.**
   - The order "callerRole once analyze succeeds → `pending` while loading → `failed` → editor" reads against the current `analyzeStatus`. Status goes back to `loading` on every debounced re-analyze, and a later analyze can fail after an earlier one succeeded.
   - Read literally, the rule has two failures:
     - (a) An editor's Run pipeline and Dry run disappear, or shrink to a reserved slot, every time they edit a step.
     - (b) A viewer whose re-analyze fails is promoted to `editor`, and the run controls appear. That violates the spec line "a viewer SHALL never see them appear and then disappear".
   - Required revision: the role comes from the most recently received `analyzeResult[pid].callerRole` whenever one exists, regardless of `analyzeStatus`.
     - `pending` applies only when there is no result yet and status is idle or loading.
     - `failed` with no prior result → `editor`.
   - Add jest cases for both: a viewer stays `viewer` through a later `loading` and a later `failed`; an editor keeps visible, enabled controls through a re-analyze `loading`.
2. **tasks.md C9 contradicts D2, D3, C12 and C14.**
   - C9 says "Server change limited to the cost-input resolveRoot in PipelineAnalyzeReads". D2 adds an owner-view validation pass and D3 adds neutral detail, both by owner ruling.
   - An evaluator applying C9 literally would flag D2 and D3 as violations.
   - Required revision: reword C9 to "Server change limited to `PipelineAnalyzeReads` (D1 resolveRoot, D2 owner-view validity, D3 non-owner detail); no change to `PipelineService.scala`, `RunConfigGate`, the trigger or `PipelineCostInputGathering`'s signature".
3. **The trigger-agreement test does not match its spec scenario.**
   - The spec scenario needs "a dataset feeding a valid pipeline with a compute step over a root they do not own".
   - D6's pipelines are (a) a CSV root with a compute step and (b) a dataset root with no compute step. Neither is a dataset root with a compute step.
   - D6 also does not say how "an editor's dataset write" is produced. An editor can write to the owner's dataset only through a form submit (`appendFormRow`), or the test can call `AutoRunTriggerService.triggerAutoRun(datasetId, editor, now)` directly.
   - Required revision:
     - Add a pipeline (e) to D6: an owner-owned dataset root plus a compute step that references a root column, valid for the owner.
     - Name the entry point: `triggerAutoRun` with the editor as the user, or the HEL-1784 form-submit path.
     - Assert that the trigger's result (`Allowed`, or `Denied` with codes) equals the eligibility and estimator codes in the editor's analyze response for (e), and that the result is red on main. On main the editor's analyze carries `unclassified-source` and `step-config-invalid`; the trigger carries neither.
4. **The desktop "no shift" check has no defined outcome, and it will almost certainly fail as designed.**
   - The trailing group is right-aligned (`margin-left: auto`). A reserved slot the width of Dry run + Run pipeline, replaced by the narrower "View only", moves the schedule chip when the role resolves to `viewer`.
   - D4 says only "the executor measures that this does not shift". It does not say what to do when it does.
   - Required revision: choose one rule in design.md.
     - (a) The viewer's slot keeps the reserved min-width, with "View only" right-aligned inside it.
     - (b) "View only" goes in the header meta line beside `SpineLastRunMeta`, which matches where HEL-1782 puts it (`DashboardMetaFacts`, a meta-facts row, not the action group). The one-time shift on resolve is accepted and recorded.
     - (c) Another explicit rule.
   - State the screenshot evidence that proves the chosen rule.

### Non-blocking notes

- **D2 cites the wrong example.** `ColumnSchemaInference.scala:126-128` is not an example of an owner-schema type leaking. `'name': 'badType'` comes from the step config (`groupBy[].type`, read at 117-119), and the error fires whatever the input schema is. On main a grantee already receives that exact message.
  - Case (d) still kills the "pass owner text through" mutant, because the neutral sentence differs from the typed text. But it does not exercise a message whose content is schema-derived.
  - Recommend adding or swapping in a compute step such as `flag AND amount` over a numeric owner column. Its owner-view text is `'AND' requires boolean operands, got boolean and float` (`ExpressionTypeInference.scala:78`). Assert that the grantee gets the neutral sentence and that the response contains no `float`. Correct the citation.
- **Caller-view snapshot.** Prefer explicit expected values (for example, a grantee's `sourceSchemas` entry has name `""` and empty fields) over a snapshot "captured in the red run", so the assertion cannot be regenerated by mistake.
- **`analyzeConcise` (`PipelineAnalyzeReads.scala:215-261`)** still validates against the caller's view, so a grantee on MCP or concise still gets "Unknown field" errors. It is out of the UI AC; consider a follow-up.
- **Raw detail on the write path (pre-existing).** The trigger's `Denied.reasons` (`AutoRunTriggerService.scala:144-152`) carries raw estimator detail (kind, counts) back to an editor or viewer writer through the awaited write responses (`DataSourceService.scala:121-132`, including `appendFormRow`). Q3 neutralizes detail only in analyze. Mention this in the PR body, or file a follow-up if the owner meant Q3 to cover every grantee-visible surface.
- **Dashboard button.** `PanelContent.tsx:212`'s "Run pipeline" is a navigation button on dashboard panels. A pipeline viewer who clicks it lands on a page with no run controls. Record it in the run-entry audit as out of scope.
- **Stale code comments.** Update the comments at `PipelineAnalyzeReads.scala:70-72` and `133-141`, which document the `findByIdOwned` cost resolution that D1 removes.

### Product questions not settled by the ticket and rulings

- Whether Q3's neutral detail also covers the dataset-write and form-submit `Denied` reasons (see the notes). It does not block this change.
