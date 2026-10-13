## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `279872b6853bb0e4bf86e9c84a629f497fa91257` (commits 0d44ada14, 279872b68). Diff base resolved live by
`resolve-review-base.sh` (exit 0): `d16e58d7e9d3e08a43a0483d06b1dd29fe1e6fbc` = merge-base with `origin/main`.
`origin/main` has since moved to `fe63a2518` (HEL-1525: panel/layout files only, no migration).
`git merge-tree --write-tree HEAD origin/main` merges cleanly, and V131 does not collide.

### What I verified (with evidence)

**AC1, output delete cascade.**
- `PatchSetTargetFingerprint.scala`: the `OutputDelete` arm adds `panelIds` (`findIdsByOutputIdsInternal`) and `alertRules` (`findAlertRuleDefinitionsInternal`).
- `Allowlist("output")` gains both keys. `OutputUpdate` still builds `{name, config}` only.
- `of()` projects only the keys present in the state, and `canonical()` sorts keys. An update edit's hashed bytes are therefore identical to main.
- Tests: `PatchSetStaleCascadeRoutesSpec` covers bind, rule create, edit and delete, each giving 409 with the Output still present. It also checks that the update fingerprint ignores a panel bind and a rule create.

**AC2, step delete cascade.**
- `stepDeleteFingerprint` adds `removedSteps` and `outputs`. The removed set comes from `removedByDeleteInternal`, which uses the same `PipelineStepRepository.removalOf` as `deleteInternal` and `PatchSetPreviewRemovals`.
- `PipelineStepUpdate` is unchanged (`stepState(prior)` only).
- Tests: bound panel on the step's Output and on a tail-step Output, alert rule, tail edit, new child under the tail, and a reorder that changes the promoted child. Each asserts that the step still exists.

**Byte-identity of the pipeline fingerprint after the refactor.**
- `stepsJson` and `outputsJson` are a line-for-line extraction of the old inline code: the same `pick`, the same `JsArray(map JsString)` and `JsArray(map alertRuleJson)`, and the same `sortBy(id)`. I compared both versions in the diff.
- Delete fingerprints for output and step DO change from main. A delete preview taken before the deploy and applied after it gets a fail-safe 409, once. That is expected.

**Tie-break change in `deleteInternal`.**
- Old: SQL `sortBy(position)` with no secondary key. On HEL-911 tied positions the order was unspecified by Postgres, so the old choice was arbitrary.
- New: `(position, id)`. The rest is the same: subtree walk, `PanelRowLocks.lockForDeletion` set, promotion UPDATE and returned count.
- Without ties the behaviour is identical. With ties it becomes deterministic, and nothing stored depends on the old arbitrary pick. Safe.
- Ran `PipelineStepRepositorySpliceSpec`, `PipelineCascadeLockOrderRaceSpec`, `OutputDeleteRacesPanelCreateSpec` (all of `com.helio.infrastructure.persistence.pipelines.*`) and the step-delete route specs. All green (see below).

**AC3, pipeline-delete hint privacy.**
- Panel titles come only from `panelRepo.findById(PanelId, Some(user))`, which is caller-scoped.
- Alert rule names come only from `findVisibleAlertRuleIds`: user context plus an `ownerId === user` filter.
- Anything else is counted as "N you cannot see". Panels the overlay marks removed are skipped.
- FK check: `panels.output_id` and `alert_rules.target_output_id` are both `ON DELETE CASCADE` (V94:344, V94:391), so "Removes N panel(s)" is literally true.
- `PatchSetPipelineDeleteImpactRoutesSpec`: 6 cases, green.

**AC4, apply-once.** Traced `PatchSetApplyService.apply` and `PatchSetApplyOnce.run`:
- The UUID check returns 400 before resolve.
- The claim is taken after authorization and after the stale check, so a stale 409 does not consume it. That is tested.
- `INSERT ... ON CONFLICT DO NOTHING` on PK `(owner_id, proposal_id)` makes concurrent applies race-safe. Tested with 4 concurrent applies: exactly 1 succeeds.
- The claim is released when every edit is `rolledBack`, including the empty-edits case where the first edit failed. That is tested.
- The claim is kept on `unrecoverable`/`recreated`. That is tested.
- Bookkeeping failures are swallowed so the apply result is kept (`PatchSetApplyOnceBookkeepingSpec`).
- **Live probe on the running app (port 9861), throwaway user:**
  - The first `POST /api/patch-sets/apply` with a proposalId returned `200` with an applicationId.
  - The identical second POST returned `409 {"code":"PATCH_SET_ALREADY_APPLIED","message":"This proposal was already applied. Nothing was changed; ..."}`.

**AC4, assistant hand-off after reload.**
- `ProposalHandoff` gets its patch set from `extractProposal(transcript)`, where `transcript` is the fetched (persisted) conversation. That is the only patch hand-off path (`grep patch-sets/review`), so a live render and a reload use the same code.
- `withMintedProposalId` throws away any model-written id. It takes the id from the paired persisted `tool_result` content, and only when that id is a UUID.
- `AssistantToolExecutor` mints the id into both the `tool_result` JSON and `capturedProposal`.
- The producer-side shape is pinned through the repository's own `claudeContentBlockFormat` (`AssistantToolExecutorSpec`). The consumer side is pinned by `proposalExtraction.test.ts`.
- No truncation of tool results exists in assistant persistence (grep).
- Refinement: `RefinementService` stamps a UUID onto the stored or returned set, and `RefinementChatDrawer` navigates with `result.patchSet` unmodified.
- `stampFingerprints` spreads `...patchSet`, so the id survives (tested).

**AC4, UI.**
- Viewed in the running app: a patch set whose proposalId was already applied, opened on `/patch-sets/review`, then Accept & Apply.
- Result: the shared `EmptyState` titled "This proposal was already applied", with no Apply or Re-preview action. The only console error is the expected 409 resource line.
- Screenshots:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1522/evidence/.concertino/runs/HEL-1522/skeptic-final-already-applied-light.png` (375 wide)
  - `/home/matt/Development/helio/.concertino/runs/HEL-1522/evidence/.concertino/runs/HEL-1522/skeptic-final-already-applied-light-1440.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1522/evidence/.concertino/runs/HEL-1522/skeptic-final-already-applied-dark-1440.png`
- Light/dark parity is good. Same component and layout as the sibling "Nothing to review" and "No patch set to review" states (`PatchSetReviewPage.tsx`). No hard-coded values; this is token-only reuse.

**AC5.**
- `PatchSetStaleDefinitionGapsRoutesSpec`: alert-rule edit, schedule `enabled` and `timezone`, reorder, position, reparent, Output `kind`, `nodeStepId`. Each runs for both pipeline update and pipeline delete.
- Cascade spec: alert-rule create, edit and delete for the output-delete target.
- The run-stability tests in both older specs now call `outputRepo.updateSchemaInternal`.
- `mutation-runs.md` records 13 mutations, all RED. I did not re-run them. The evaluator independently re-ran 2 of them in cycle 2.

**AC6.**
- The spec delta states the upsertsource first-run exception and adds a scenario for it.
- The test "change when the first run of an upsertsource step ..." drives the real `applyWriteBacks` path and asserts 409 `PATCH_SET_STALE`, with `renamed(...) shouldBe false`.

**AC7.**
- Linear HEL-1540 exists ("Patch-set stale-check UX + spec-size follow-ups (HEL-1522 items 6-7)"), labelled Follow-up and relatedTo HEL-1522.

**Gates, run fresh by me** (`nice -n 19`, `-J-Xmx3g`, foreground):
- `sbt testOnly com.helio.api.routes.patchsets.* com.helio.services.patchsets.* com.helio.domain.patchsets.* …PipelineStepRemovalRuleSpec …RlsPolicyGuardSpec …AssistantToolExecutorSpec`: `Tests: succeeded 602, failed 0`.
- `sbt testOnly com.helio.infrastructure.persistence.pipelines.* com.helio.services.assistant.* com.helio.services.refinement.* com.helio.api.routes.assistant.*`: `succeeded 356, failed 0`.
- `sbt testOnly …DuplicateStepReferenceChecksSpec …PipelineStepRoutesSpec …PipelineAclSpec`: `succeeded 130, failed 0`.
- jest, 3 workers, proposalExtraction and `features/patchSets`: 8 suites, 86 tests, all passed.
- `npm run typecheck`, `lint`, `format:check`, `check:schemas`, `check:scala-quality`, `check:openspec`: all exit 0.
- Full `sbt testFull` was not run (600 s budget).

**Cleanup.**
- The throwaway user was deleted by exact `(id, email)` through `buildUserDeleteSql`. Post-checks: user count 0, claim rows 0.
- Servers were stopped with `stop-servers.sh` (`STOPPED ports=6954,9861`).

### Verdict: CONFIRM

### Owner product calls

None blocking. Two policy choices are recorded in design.md and are safe by default. The owner may want to know about them:
- A thrown (failed-Future) apply keeps the claim, even when nothing was written. That proposal can then never be applied, and the user must ask for a new one. This deliberately narrows AC4's "a failed apply does not consume the id" toward "never apply twice".
- The pipeline-delete hint reveals a count of panels and alert rules the caller cannot see. The AC requires this ("counted instead").

### Non-blocking notes
- `patch_set_applied_proposals` is never pruned: one row per applied proposal per user, removed only by the user-delete cascade. It is small, but it grows without bound.
- V131's FORCE-RLS policy is unproven on the superuser dev/test DB (known parity gap). Keep it on the release owner-verification list.
- A re-opened, already-applied proposal still renders a full preview. The user learns it is already applied only on Accept. This is acceptable under AC4's wording.
- An output-update fingerprint is tested against a panel bind plus a rule create, but not against a rule edit or delete. The allowlist covers those by construction.
- The evaluator's carried polish suggestions still apply: show the server's "Nothing was changed" wording, and use `replace: true` on the CTA.
