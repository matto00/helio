## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `538a867d718204775f7c0844450f683889e145e3` (no implementation commits yet).

### What I verified (with evidence)

- Read ticket.md, proposal.md, design.md, tasks.md, the three spec deltas, `docs/live-draft-preview.md` §5, §8 (8.1-8.7) and §12, and board `PipelineLive--step1-filter-dragged.png`.
- The API claims in design Context hold: `evaluatePipeline(..., {sources, previous, editedStepId})` (`evaluator/evaluatePipeline.ts:149-186`); `DraftPreviewRequest {roots, steps, lanes?, sources?, rowsStepId?}` (`types/draftPreview.ts:45-51`); `createDraftPreviewScheduler` (`services/draftPreviewScheduler.ts:47`); `draftSaveService.ts` (`getPipelineWithDefinition`, `saveDraft`, `extractDraftSaveConflict`); draft-save types (`types/draftSave.ts`).
- One citation is stale: `state/stepRowCount.ts:278-295`. The file is 26 lines long. The fact it supports (counts come from runs) is correct.
- Backend `DraftSaveService.runAfter` (`backend/.../services/pipelines/draft/DraftSaveService.scala:146-160`) awaits `runService.submit`. That call returns only after the whole run finishes (`PipelineRunExecutor.scala:328-345` builds `RunResultResponse` after `onRunSuccess`). The response carries only `DraftRunStarted(runId, "succeeded"|"blocked")`, with no rows or `stepRowCounts`.
- The frontend run state (`runStatus`, `runStepRowCounts`, `runResult`) is set only by the `submitPipelineRun` thunk reducers (`state/pipelinesSlice.ts:217-246`). `handleRunPipeline` also calls `setSseActive(true)` before submitting (`hooks/usePipelineRunAndSaveActions.ts:63-74`).
- Today's spine counts come from the in-session run, else the persisted `lastRunStepRowCounts`, else "—" (`state/stepRowCount.ts`). That is a binding requirement in `openspec/specs/pipeline-detail-spine-layout/spec.md:40-41`. The same spec at `:69-70` requires the preview table to show rows "returned ... by the step preview endpoint" and that "opening the page SHALL issue exactly one step-preview request".
- The draft-save `enabled` field is optional and the server defaults it to `true` (`DraftDiff.scala:228`, `r.req.enabled.getOrElse(true)`).

### D2 scope judgment (asked explicitly)

D2 covers config edits, enabled toggles and deletes, and disables other structural operations during a draft. **That satisfies the ticket's literal ACs and "What" bullets.**
- AC1 concerns client-evaluable step edits.
- AC3's "order" holds trivially, because order cannot change in a draft.
- "Show cascade confirmation before deleting steps" is met by the draft delete plus the 422. The server 422s on any removal not listed in `confirmCascade`.
- The "What" bullet "Editing a step creates a client-only draft" is met by config edits.

However, `docs/live-draft-preview.md` §8.1/§8.4 designs the bulk save so that it carries creates and the final trunk order, which implies drafting those operations. Blocking add, insert, reorder and Output edits while a draft is open is a user-visible restriction. **That is an owner product call, not a design defect.** I flag it for escalation and do not REFUTE on it.

### Verdict: REFUTE

### Change Requests

1. **Save & run's run handling is unspecified, and it conflicts with how the run path works (D9 step 3, tasks 3.5, D15 "the run starts (status appears)").**

   `POST .../draft/save` with `runAfterSave: "run"` is synchronous through the whole run. It returns only `{runId, status: "succeeded"|"blocked"}`, with no rows or step counts. The "existing run-status path" that D9 hands the run to is driven entirely by `submitPipelineRun`'s reducers, which this path never dispatches. As written, there is no specification of:
   - the in-session status while the save request is open, which can last the length of a run;
   - whether `setSseActive(true)` is set before posting, so progress streams;
   - how `runStatus`, `runStepRowCounts` and `runResult` are set afterwards. One option is a new reducer action. Another is to clear the in-session counts and refetch the pipeline's persisted `lastRunStepRowCounts`.
   - how a `status: "blocked"` run is shown;
   - what "Save & run disabled while a run is queued/running" means when the run happens inside the save.

   Specify each of these in D9 and add a jest case per outcome. Without this, AC4's "starts a run" has no defined observable, and the post-save spine shows stale counts.

2. **The spine-count source and the no-draft preview path change shipped requirements with no spec delta, and the design is ambiguous about the no-draft state (D3 "with no draft, the draft walk is the base walk", D7, task 2.7).**

   `pipeline-detail-spine-layout` requires run counts (`spec.md:41`) and exactly one step-preview request on page open (`spec.md:70`). The design does not say whether, with no draft, the spine shows:
   - real run counts, as today, or
   - base-walk sample counts. For a source over the 1,000-row cap, that shows at most 1,000 instead of the run's count, and it drops the partial/truncation marking.

   It also does not say whether the "104" in "104 → 92" is the sample base walk or the run count. Mixing a run count with a sample count would mislead.

   Decide which count is shown in each state. Then add MODIFIED deltas for "The spine lists sources, numbered steps with row counts..." and "The preview table shows rows after the selected step..." in `pipeline-detail-spine-layout`, and for the phone Steps tab counts in `pipeline-detail-mobile-layout`. Also list the hel1579 e2e that asserts one step-preview request on open among the tests to change (task 4.3).

3. **Always send `enabled` in the save body (task 1.1, D9 step 2).** The server treats an omitted `enabled` as `true`. A request builder that follows the optional field in `types/draftSave.ts` would silently re-enable every disabled step on save. State that `buildDraftSaveRequest` sends `enabled` for every step, and add a unit test with a disabled step.

### Non-blocking notes

- **Owner call to escalate (D2):** structural operations disabled during a draft. See above.
- **AC4 "one journal row":** the planned e2e observable (the returned `applicationId` can be undone) shows that at least one row exists, not exactly one. If a read endpoint for applications exists, count the rows. Otherwise, cite HEL-1629's backend spec that asserts one row.
- **Stale citation:** fix `stepRowCount.ts:278-295` in the design's Context.
- **Accent rule versus the board:** the board's draft chip uses an accent dot and tint (`PipelineLive--step1-filter-dragged.png`). The plan makes the chip non-accent, following the ticket's DESIGN.md v3 accent rule. That is correct; keep it.
