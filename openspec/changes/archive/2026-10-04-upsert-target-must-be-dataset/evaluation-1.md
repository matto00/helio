## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit e399bb2c68c5d4e5460ca83c19840ff318db6815.

### Phase 1: Spec Review — PASS
- Save paths: all funnel through `upsertOwnershipCheckF` -> `UpsertTargetCheck.check` (PipelineService create via validateStepCrossOwnerRefs ~:470, addStep owner and grantee branches ~:1910/1919, updateStep ~:2198). Apply-proposal and patch-set apply go through addStep/create (specs PipelineApplyProposalUpsertTargetSpec, PatchSetApplyServiceSpec case). No pipeline import exists in the backend (grep), so nothing to cover. I live-confirmed POST step with a CSV target -> 422 naming name/id/kind, and PATCH /api/pipeline-steps/:id to a CSV -> same 422; a dataset target saves 201.
- MCP description (helio-mcp/src/tools/write.ts) states the dataset-only rule; text-only change.
- Analyze surfaces: analyze, analyzeConcise and analyzeProposal overlay the target problem onto `validationError` (UpsertTargetAnalysis). The untouched `analyzeNodes` callers are correctly left: ~:367 (pipeline create) feeds only Output-binding schema projection and the target is already refused at save in the same call, and ~:1342 (`projectedSchemaAtNode`) feeds capabilities/validate-expression schema only; neither emits `validationError`. Right to leave them (minimal hunks in shared files).
- Preview, Output preview, dry run, real run all fail through `UpsertSourceStep.evaluate` -> `StepConfigError` -> HEL-1147's STEP_CONFIG_INVALID body; route spec asserts code/stepId/stepKind/reason. Real run asserts a failed run row and an unchanged `dataset_rows` count. Unknown/foreign target stays a plain not-found with no name/kind disclosure (design decision, tested).
- HEL-1252 delete-block still asserted. Stored invalid steps read back cleanly (kind is not in config).
- Scope: tight; no scope creep. `validateTargetOwnership` removal is justified (superseded, only the rewritten spec used it).

### Phase 2: Code Review — PASS
- Gate: `nice -n 19 sbt testFull` in WORKTREE_PATH: 5697 passed, 0 failed, 394 suites (no flakes hit). No frontend files changed, so frontend gates are not triggered; helio-mcp change is a string literal.
- Red-before-fix: I re-ran the mutation independently in a throwaway detached worktree (isWritableDataset := true): 16 tests failed across UpsertTargetWritableRoutesSpec, UpsertTargetWritableRlsSpec, PipelineApplyProposalUpsertTargetSpec, UpsertSourceConfigSpec, PatchSetApplyServiceSpec (save, analyze, step/Output preview, dry run, real run, evaluate, predicate). Scratch worktree removed. Executor's own pre-fix red logs were not re-derived (only the mutation), but the mutation covers every surface.
- NOBYPASSRLS: UpsertTargetWritableRlsSpec uses a two-role harness with `SET ROLE helio_app_test` (NOSUPERUSER, created without BYPASSRLS) for the app pool and a separate privileged pool; it covers owner, grantee-editor (checked against the owner's sources) and foreign/unknown (identical 404). Genuine. (Suggestion below.)
- Fixture changes justified: UpsertSourceConfigSpec's old "accept an owned target" case used a REST source and so pinned the bug (repointed to a dataset, new refuse-REST case); UpsertSourceStepSpec's pure evaluate test moved to NewSource because ownerUserId=None now fails closed for existing targets. Both are legitimate; no other spec needed changing (full suite green).
- Single predicate `DataSourceKind.isWritableDataset` shared with the deferred write path (behaviour-identical). DRY, small units, no dead code.

### Phase 3: UI Review — N/A
No frontend/**, ApiRoutes.scala, schemas/** or openspec/specs/** in the diff, so mandatory triggers do not match. For ticket item 3.2: the claim remains code-reading only. I confirmed by reading that `useStepCardState.persist(captureErrors=true)`/`UpsertSourceConfig.tsx` `saveError` -> `InlineError` surfaces the PATCH message. I could not exercise it live: my attempt to inject a stored-invalid step (exact-id SQL update on the shared dev DB) was blocked by the permission classifier, and the picker lists datasets only so the UI cannot reach the 422 on its own. Not independently verified live; low risk given no frontend change.

### Dev DB count
Not independently re-run: direct dev-DB psql access was denied by the permission classifier. I reviewed the executor's query (guarded TEXT->jsonb cast, left joins to data_sources) and it is sound; its reported result (0 pre-existing upsertsource steps with a non-dataset target) is accepted as an executor claim, unverified by me. Stored-invalid steps are handled regardless (clean read, analyze flag, 422 at execution).

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- UpsertTargetCheck.scala has hand-aligned `case` columns that no formatter enforces; trivial.
- In UpsertTargetWritableRlsSpec, add a one-line assertion that the app role has rolbypassrls = false / is not superuser, so the NOBYPASSRLS claim is self-checking.
- Optional follow-up: an owner-driven browser check of the editor saveError for the 422.

### Evaluator housekeeping
Dev DB ids I created (all via exact-id API delete, 204): pipeline 6383c5a3-16d0-4236-9235-26859888816e; sources 17aaedd1-9fc2-4f05-82fe-247575004d87, d83ef06e-2990-43ea-9205-08f155404e9b, 03d181b1-8cb8-40b9-bc2e-0c64f9f39d9f. User d48773e0-efe4-455f-8ac0-02bfbc9d2433 (ev1265-26808@helio.test) remains in the dev DB (no SQL access allowed to remove it); needs exact-id deletion by a human or the driver. Servers on 6697/9604 stopped; sbt server shut down.
