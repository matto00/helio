## Standing Constraints

- [C1] Do not edit layout-version files (HEL-1525 lane) or anything under `helio-mcp/` (PR #990 parked).
- [C2] New route tests go in new spec files under 250 lines; the two oversized specs gain only the `updateSchemaInternal` call.
- [C3] Every new fingerprint coverage and the apply-once guard has a red-first proof or a recorded mutation run (`mutation-runs.md`).

### Backend

## 1. Fingerprint cascade coverage (items 1, 5)

- [x] 1.1 Extract the shared per-Output projection from `PatchSetPipelineDefinition` (D2); pipeline fingerprints unchanged (existing Widened/StaleCheck specs pass)
- [x] 1.2 Extract the step-delete removed-set rule into a pure function used by `deleteInternal` plus a read-only `removedByDeleteInternal`, and route `PatchSetPreviewRemovals.removedStepIds` through it (D3); existing step-delete/splice/preview specs pass
- [x] 1.3 Output delete fingerprint adds `panelIds`/`alertRules`; step delete adds `removedSteps`/`outputs`; allowlists extended (D1); update states unchanged (test 4.3)
- [x] 1.4 Update the `PatchSetTargetFingerprint` / `PatchSetPipelineDefinition` doc comments to state the delete cascade coverage and the upsertsource first-run exception (D8)

## 2. Pipeline-delete impact hint (item 2)

- [x] 2.0 Caller-scoped alert-rule visibility via `OutputRepository.findVisibleAlertRuleIds(ids, user)` (user context + owner filter, same scoping as `AlertRuleRepository.findAll`); no new `PatchSetApplyContext` collaborator (design.md D4 and Implementation Notes); compiles
- [x] 2.1 `PatchSetPreviewImpact` PipelineDelete arm names caller-visible bound panels and alert rules, counts the rest, skips overlay-removed panels, caps at five names (D4); verified by test 4.6

## 3. Apply-once (item 3)

- [x] 3.1 Add `V131__patch_set_applied_proposals.sql` (D5) with RLS + FORCE; migration applies on a fresh DB (`sbt` test boot)
- [x] 3.2 `PatchSet.proposalId` (protocol, absent-tolerant, lenient; UUID → 400 checked on the apply path only) and `schemas/patch-sets/patch-set.schema.json` optional `proposalId`; contract/schema tests pass
- [x] 3.3 Repository for claims (claim/release/attach application id), under `withUserContext`, wired into `PatchSetApplyService.apply` after the stale check; dedicated `ServiceError.PatchSetAlreadyApplied` + `completeError` arm + `PatchSetAlreadyAppliedResponse` + `schemas/shared/patch-set-already-applied-response.schema.json` (D5); verified by tests 4.7
- [x] 3.4 Strip model `proposalId`, mint a UUID in `RefinementService.parseAndValidate` (stored) and in `AssistantToolExecutor.executeProposePatchSet` (returned in the tool_result body) (D6); verified by test 4.8
- [x] 3.5 Add `proposalId` ("Server-assigned. Omit.") to `AssistantProposalToolSchemas`; `check-schema-drift.mjs` passes
- [x] 3.6 Claim release only when no write survived (D5 / CR2); verified by test 4.7

### Frontend

## 5. Review page

- [x] 5.0 `extractProposal` (kind `patch`) drops the model's `proposalId` and sets the one from the paired tool_result when it is a UUID (D6); unit test
- [x] 5.1 `PatchSet.proposalId?`, `stampFingerprints` keeps it, apply thunk maps 409 `PATCH_SET_ALREADY_APPLIED` to a typed rejection (D7); slice unit test
- [x] 5.2 `PatchSetReviewPage` shows the final already-applied state with no Apply/Re-preview control; component test; both themes checked against the running app by the evaluator (evaluation-1.md)

### Tests

## 4. Route and unit tests (items 1-5)

- [x] 4.1 New spec: output delete 409 after panel bound / alert rule created, edited, deleted; Output still exists
- [x] 4.2 New spec: step delete 409 after panel bound to an Output on the step and on a removed tail step, and after an alert rule created on such an Output; step still exists
- [x] 4.2a Step delete 409 after an edit to a removed tail step / a new child under a tail root, and after a sibling reorder that changes which child is promoted (makes the `removedSteps` mutation red; skeptic-design-3 note 1)
- [x] 4.3 Output update and step update fingerprints unchanged after binding a panel to the affected Output
- [x] 4.4 Pipeline update+delete 409 after: alert-rule edit, schedule `enabled` change, schedule `timezone` change, step reorder, step reparent, Output `kind` change, Output `nodeStepId` change
- [x] 4.5 Run-stability tests in both existing specs also call `outputRepo.updateSchemaInternal`; upsertsource first-run test shows a changed fingerprint and a 409 (D8)
- [x] 4.6 Impact-hint tests: names visible panel + alert rule, counts an invisible panel, omits overlay-deleted panel, no naming hint when nothing bound, cap at five
- [x] 4.7 Apply-once tests: second apply 409 and no duplicate; stale-refused and cleanly-rolled-back applies release; an unrecoverable rollback keeps the claim; concurrent applies apply once; no-`proposalId` unchanged; non-UUID 400 on apply
- [x] 4.7a Step-delete removed-set test with tied child positions: deterministic `(position, id)` promotion; `deleteInternal`, preview removals and fingerprint agree
- [x] 4.7b Wire test: the already-applied 409 body matches the shared schema exactly (`message`, `code`)
- [x] 4.8 Refinement and assistant tests: minted UUID, stored copy equal, model-supplied (incl. non-UUID) id replaced and never fails propose; frontend seam test: a reloaded stored transcript through `extractProposal` yields the server-minted id
- [x] 4.9 Mutation runs recorded in `mutation-runs.md`: drop `alertRules` from the pipeline projection, drop each new delete key, skip the claim, and drop each already-fingerprinted field newly tested in 4.4 (`enabled`, `timezone`, step `position`, `parentStepId`, Output `kind`, `nodeStepId`) — each turns its test red; restore
- [x] 4.9a Add V131's table to `RlsPolicyGuardSpec`'s allowlist; run `RlsPolicyGuardSpec` and `FlywayNonSuperuserMigrationSpec` (skeptic-design-3 note 2)
- [x] 4.10 Gates: targeted `sbt testOnly` for the patchsets/pipelines/assistant/refinement packages (foreground, split), frontend `npm test` for patchSets (3 workers), lint, typecheck, format

## 6. Follow-up (AC7, orchestrator)

- [x] 6.1 (HEL-1540) Orchestrator files a Follow-up ticket for items 6-7 (Follow-up label, relatedTo HEL-1522, incl. MCP proposalId pass-through) and records its id in the PR body
