## Skeptic Report — final gate (round 1, skeptic-final-1.md)
Reviewed head e399bb2c68c5d4e5460ca83c19840ff318db6815.

### What I verified (with evidence)
- Diff against live base eda4669e read in full (main + helio-mcp + tests). All save paths (create, addStep owner/grantee, updateStep, apply-proposal, patch-set apply) funnel through upsertOwnershipCheckF -> UpsertTargetCheck.check; 422 names name/id/kind. No pipeline import exists (design grep; no steps created by dashboard import). Route spec cases at UpsertTargetWritableRoutesSpec:184-262 cover create, update, inline create; PipelineApplyProposalUpsertTargetSpec and PatchSetApplyServiceSpec cover the other two.
- Analyze: analyze, analyzeConcise, analyzeProposal overlay validationError. Untouched analyzeNodes callers (PipelineService ~:367 create-time Output binding, ~:1342 projectedSchemaAtNode) emit schema only, not validationError; create path refuses the target at save in the same call. Right to leave.
- Preview / Output preview / dry run / real run: all via UpsertSourceStep.evaluate -> StepConfigError -> HEL-1147 STEP_CONFIG_INVALID; spec cases :290-:340 incl. real run asserting failed run and unchanged dataset_rows, sibling-branch preview unaffected, HEL-1252 delete-block still asserted (:351).
- Stored invalid steps read back cleanly (kind is not in config; spec :267). Dev DB count independently re-run read-only by me (PGOPTIONS default_transaction_read_only=on): upsertsource steps = 0, existingSource = 0, matching the executor's claim.
- Non-BYPASSRLS: UpsertTargetWritableRlsSpec uses SET ROLE helio_app_test (CREATE ROLE ... NOSUPERUSER, no BYPASSRLS) for the app pool; covers owner, grantee-editor (checked against owner's sources), foreign/unknown identical 404, evaluate fail-closed with no owner. Genuine, same harness as the existing RLS specs.
- I re-ran the targeted specs (UpsertTargetWritable*, PipelineApplyProposalUpsertTargetSpec, UpsertSource*, PatchSetApplyServiceSpec): 89 passed, 0 failed. Evaluator's full testFull (5697 pass) and its independent mutation (isWritableDataset := true -> 16 red across save/analyze/preview/dry/real/evaluate) accepted; the mutation flips the single shared predicate so it exercises the new branch on every surface. Pre-fix red is the executor's claim (logs uncommitted); the mutation substitutes for it and I accept that.
- Design decisions: reusing STEP_CONFIG_INVALID is sound (target id is step config, kind is immutable, user-fixable only by editing the step; missing/foreign stays a plain not-found in the reference class; no new client handling needed). Disclosure of name/kind to editor grantees/previewers is acceptable: produced only after findByIdOwned as the pipeline owner succeeded, same ACL as the existing success path, foreign/unknown ids never reach the kind branch (tested). Consistent with HEL-1252: R3 reference unchanged and pinned.
- No UI/frontend diff, so no visual judgment applies. No gate-defect on mtime evidence (none relied on).

### Verdict: CONFIRM

### Non-blocking notes
- UI editor 422 display is code-reading only (useStepCardState captureErrors -> saveError); not exercised in a browser by anyone. Low risk.
- Suggest a self-checking rolbypassrls=false assertion in the RLS spec.
- Evaluator left user d48773e0-efe4-455f-8ac0-02bfbc9d2433 (ev1265-26808@helio.test) in the dev DB; needs exact-id deletion by the driver/human. I created nothing in the dev DB and started no servers.
