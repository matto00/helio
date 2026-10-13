## Context

See proposal.md (Why). Ground truth at d16e58d7e: `PatchSetTargetFingerprint.forEdit` hashes an `OutputDelete` as
`{name, config}` and a `PipelineStepDelete` as the step's own response fields; only `PatchSetPipelineDefinition` folds in
Outputs with `panelIds`/`alertRules` (via `panelRepo.findIdsByOutputIdsInternal`,
`outputRepo.findAlertRuleDefinitionsInternal`). `PipelineStepRepository.deleteInternal` (line ~982) removes the target
plus the tail subtrees (children after the first by position, and their descendants) and promotes the head child; the
same set is passed to `PanelRowLocks.lockForDeletion` (HEL-1498). `outputs.node_step_id` cascades (V94:209).
`PatchSetPreviewImpact` has a static `PipelineDeleteCascadeHint`. `PatchSetApplyService.apply` = resolve → stale check
→ `applyResolved` (mid-set failure returns `Right` with `failure`, after rollback). Patch sets are minted in
`RefinementService.parseAndValidate` (stored as the conversation's `latestPatchSet`) and
`AssistantToolExecutor.executeProposePatchSet` (captured into the conversation turn); both already strip model
fingerprints via `PatchSetFingerprintStamping.strip`. Latest migration V130; V131 free (re-checked against open PRs).

## Goals / Non-Goals

Goals: items 1-5 of ticket.md. Non-goals: items 6-7 (Follow-up), helio-mcp, output/step delete impact hints.

## Decisions

**D1. Delete-only cascade keys, same `v1:` scheme.** Extend `Allowlist("output")` with `panelIds`, `alertRules` and
`Allowlist("pipelineStep")` with `removedSteps`, `outputs`. Only the delete arms populate them; an update state lacks
the keys, so update fingerprints are byte-identical to today (pinned by a test). No version bump: an outstanding delete
preview issued before deploy simply 409s once (fail-safe), which the HEL-1458 contract already allows.
Alternative rejected: a new kind key (`"outputDelete"`) — needs a second allowlist entry for the same fields, no gain.

**D2. One Output projection.** Extract the per-Output JSON (`id, name, kind, nodeStepId, config, panelIds, alertRules`,
sorted) from `PatchSetPipelineDefinition` into a shared helper taking a set of Outputs, and use it for the pipeline,
output-delete and step-delete fingerprints, so the three cannot drift. For an output delete, the state is
`{name, config, panelIds, alertRules}` (keeping today's `name`/`config` values exactly).

**D3. One removed-set rule.** Extract the pure computation in `deleteInternal` (deleted step + tail-root descendants,
from `(id, parentStepId)` rows and children ordered by `(position, id)` — today `deleteInternal` orders by `position`
only, and HEL-911 permits tied positions, so the promoted head child is nondeterministic; the shared rule fixes the
order, with a tied-position test (skeptic-design-1 CR3)) into a function in `PipelineStepRepository`'s
companion, used by `deleteInternal`, by `PatchSetPreviewRemovals.removedStepIds` (a third copy, also `position`-only today,
skeptic-design-2 CR2) and by a new read-only `removedByDeleteInternal(stepId)` the fingerprint calls.
`removedSteps` = the removed steps' response JSON (StepKeys of D2's sibling, sorted by id); `outputs` = D2 over Outputs
whose `nodeStepId` is in the removed set. Alternative rejected: re-deriving the subtree in the fingerprint — a second
copy of a splice rule that already has its own history (HEL-906/913).

**D4. Pipeline-delete hint names caller-visible rows.** In `PatchSetPreviewImpact`'s `PipelineDelete` arm, read the
pipeline's Outputs, their panel ids and alert-rule definitions with the same internal reads as D2, drop panels
`overlay.isRemoved("panel", id)`. Names come only from caller-scoped reads (skeptic-design-2 CR4):
- panels: `ctx.panelRepo.findById(id, Some(user))` per bound panel id (bounded by the pipeline's bound panels; a `None`
  is counted as not visible); the title shown is `overlay.panel(p).title`, so a rename earlier in the set is reflected;
- alert rules: one `ctx.outputRepo.findVisibleAlertRuleIds(ruleIds, user)` call (user context + owner filter, the same
  scoping as `AlertRuleRepository.findAll`), intersected with the internal definitions; ids it does not return are
  counted as not visible. No new `PatchSetApplyContext` collaborator: `ApiRoutes`'s `alertRuleRepo` is nullable and
  threading it would touch ~35 construction sites for the same guarantee (see Implementation Notes).
Emit, after the existing two hints, `Removes N panel(s): "A", "B"` and `Removes M alert rule(s): "X"`, at most five
names each, `and K more` / `K you cannot see` appended. No hint when N = M = 0. Known gap (recorded, not handled): a
panel created earlier in the same set bound to one of the pipeline's Outputs is not listed (the overlay tracks created
panels per dashboard, not per Output); likewise a panel rebound by an earlier edit in the same set may be named or
omitted wrongly (skeptic-design-3 note 4).

**D5. Apply-once via a claim table (V131).** `patch_set_applied_proposals(owner_id UUID REFERENCES users ON DELETE
CASCADE, proposal_id TEXT, application_id TEXT NULL, claimed_at TIMESTAMPTZ, PRIMARY KEY(owner_id, proposal_id))`, RLS +
FORCE owner policy exactly as V79. Separate from `patch_set_applications` because that journal is pruned to 20 rows
per owner and only written on success. Flow in `apply`, after the stale check and before any write: `INSERT ... ON
CONFLICT DO NOTHING`; 0 rows → `Left(ServiceError.PatchSetAlreadyApplied(message))`, a dedicated variant mirroring
`PatchSetStale` (skeptic-design-2 CR1): its own `completeError` arm and status (409), a wire type
`PatchSetAlreadyAppliedResponse(message, code)` with `code = "PATCH_SET_ALREADY_APPLIED"` (constant beside
`PatchSetStaleCode`), a shared schema `schemas/shared/patch-set-already-applied-response.schema.json`, and a route test
asserting the exact wire body. Plain `Conflict` is not used: it renders without `code`, and the frontend distinguishes
409s only by `data.code`. Claim writes run under the caller's RLS user context (`withUserContext`, as the V79 journal
repository does), so FORCE RLS cannot silently refuse them. Then `applyResolved`. Release (delete) the claim ONLY when
no write survived: a `Left` returned before the first write, or a `Right(failure)` whose every applied edit rolled back
cleanly (the rollback's clean status; any `recreated`/`unrecoverable` outcome keeps the claim). A failed Future from
`applyOne` (rollback skipped), a `journalSuccess` failure, or any other post-write error keeps the claim — failing
toward "never double-apply" (skeptic-design-1 CR2). On success, set `application_id` when journaled. The PK makes
concurrent applies race-safe without a lock. Claim before write (not record-after) because record-after lets two
concurrent applies both write. A non-UUID `proposalId` → 400, checked ONLY on the apply path (in `PatchSetApplyService.apply`/the apply route, before
resolution) — never in the shared `patchSetFormat`, which also decodes preview, refinement and `propose_patch_set`
(skeptic-design-2 CR3).
Alternatives rejected: client-only "applied" memory (lost on reload; the assistant conversation and refinement record
are server-persisted and re-render the hand-off) and a content hash (would block a legitimately re-proposed identical
change).

**D6. Minting, where each hand-off actually reads from (skeptic-design-1 CR1, CR4).** `PatchSet` gains
`proposalId: Option[String]`, decoded leniently (any string; UUID is enforced only on apply, so a model-written value
can never fail `propose_patch_set`). Schema `patch-set.schema.json` adds an optional string; `AssistantProposalToolSchemas`
mirrors it described "Server-assigned. Omit." (schema-drift gate `check-schema-drift.mjs:717-719`).
`PatchSetFingerprintStamping.strip` also drops a model `proposalId`.
- Refinement: `parseAndValidate` sets `Some(UUID)` on the patch set it stores as `latestPatchSet` and returns; the drawer
  reloads `view.latestPatchSet`, so the id is stable across reload.
- Assistant: the review page's patch set comes from the persisted transcript (`extractProposal` → `tool_use.input`,
  `ProposalHandoff.tsx:61`), never from `capturedProposal`. So `executeProposePatchSet` mints the UUID and returns it
  in the tool_result body (`{...preview, proposalId}`), which the transcript persists. `extractProposal`, for kind
  `patch` only, deletes any `proposalId` from the model's input and sets the one read from the paired tool_result (only
  when it is a UUID). A seam test feeds a stored transcript (as `AssistantConversationRepository` serves it after a
  reload) through `extractProposal` and asserts the server-minted id wins over a model-written one.
The preview endpoint accepts and ignores `proposalId`. Undo does not release it (owner-reviewable assumption, PR body).

**D7. Frontend.** `PatchSet.proposalId?: string`; `stampFingerprints` preserves it (spread); `patchSetsSlice`'s apply
thunk maps a 409 `PATCH_SET_ALREADY_APPLIED` to a typed rejection (`isPatchSetAlreadyApplied`), the review page shows a
final "This proposal was already applied. Ask for a new proposal to change anything else." state with no Apply or
Re-preview control. DESIGN.md tokens/components only (the shared `EmptyState` component, as the page's other terminal states).

**D8. upsertsource (item 5): document, do not mask.** The first-run rewrite changes what the step writes to; hiding it
from the fingerprint would let a stale preview apply onto a different target. Spec text + a route test pinning the
stale outcome (drive the rewrite through the real run write path, `DataSourceRepository`'s new-source write that calls
`rewriteUpsertTargetAction`, not a hand-edited config).

**D9. Tests live in new files.** All new route tests go in new specs (each < 250 lines, shared fixture trait if
needed); the two oversized specs only gain the `updateSchemaInternal` call in their run-stability tests.

## Risks / Trade-offs

- [In-flight delete previews 409 once after deploy] → fail-safe by contract; re-preview.
- [Claim row left behind if the process dies mid-apply] → that proposal reads as applied; user re-proposes. Accepted:
  failing toward "do not double-apply" is the point of the item.
- [MCP applies do not carry proposalId] → unchanged behaviour; noted in the Follow-up ticket.
- [Hint reads add queries to pipeline-delete preview only] → bounded by the pipeline's Outputs; no other arm changes.

## Migration Plan

V131 additive table; rollback = drop table (no other schema touched). No backfill.

## Planner Notes

- Self-approved: D1-D9. Assumed scope call (driver-authorised, recorded in ticket.md): items 6-7 deferred to a
  Follow-up. Not a product call: "a proposal applies at most once; re-propose to change more" mirrors HEL-1458's
  existing "re-propose rather than retry" contract.
- Sibling lanes checked: HEL-1525 (layout version), #991 HEL-1516, #990 HEL-1524 touch none of these files.

## Implementation Notes (executor)

- **D4 deviation (alert-rule visibility):** instead of threading a new required `alertRuleRepo` through
  `PatchSetApplyContext`, both services and ~35 construction sites (and `ApiRoutes`'s `alertRuleRepo` is nullable by
  design), the caller-scoped read is `OutputRepository.findVisibleAlertRuleIds(ids, user)`: user context + owner
  filter, the same scoping as `AlertRuleRepository.findAll`. Same guarantee (a rule the caller cannot list is counted,
  never named), no new collaborator; task 2.0 is satisfied by that. Test: `PatchSetPipelineDeleteImpactRoutesSpec`.
- **Claim-table RLS is unproven locally:** `withUserContext` claim/release under FORCE RLS cannot be proven on the
  superuser test DB (MISTAKES.md, "RLS policies never run in dev or CI"). Only `RlsPolicyGuardSpec` (allowlist
  completeness) and `FlywayNonSuperuserMigrationSpec` ran; the policy text is V79's verbatim.
- **Known D4 residuals:** a panel created, rebound onto, or rebound away from one of the pipeline's Outputs by an
  earlier edit of the same set is not tracked per Output (may be omitted or named wrongly).
- **Undo does not release a `proposalId`** (owner-reviewable assumption).
- The refinement-drawer double apply was NOT reproduced (the drawer clears the stored conversation before navigating);
  the assistant hand-off is the confirmed path. Refinement still mints (cheap, and the stored copy keeps the id).
