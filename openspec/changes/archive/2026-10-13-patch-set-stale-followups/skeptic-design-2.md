## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD d16e58d7e9d3e08a43a0483d06b1dd29fe1e6fbc. The change dir is untracked. The spawn-cwd guard returned
`READY ambient=/home/matt/Development/helio branch=task/patch-set-stale-check-followups/HEL-1522`. I judged the artifacts
as they stand now against the live tree, not against the round-1 narrative.

### What I verified (with evidence)

**Round-1 change requests: how the revision handled each**

- **CR1 (assistant id path): resolved in principle.**
  - D6 and task 5.0 now carry the id in the `propose_patch_set` tool_result body, and `extractProposal` overwrites the
    model's value with it.
  - Confirmed: `proposalExtraction.ts:37-60` reads `tool_use.input` and has the paired `tool_result` in hand
    (`resultsByToolUseId`).
  - Confirmed: `ClaudeToolResultBlockDto.content` is a persisted `string` (`assistant/types.ts:45`).
  - Confirmed: `executeProposePatchSet` returns `preview.toJson.compactPrint` as that body (`AssistantToolExecutor.scala:332`).
  - Seam test planned (4.8).
- **CR2 (release rule): resolved.**
  - D5 now releases only when no write survived.
  - I checked this against `PatchSetApplyRollback.scala`. The outcomes are `rolledBack`, `recreated` and
    `unrecoverable`, and `.recover` maps an exception to `unrecoverable` (line 58-60). `applyResolved` only ever
    returns `Right` (`PatchSetApplyService.scala:142-151`). The rule is therefore implementable as written.
  - Test 4.7 includes the unrecoverable case.
- **CR3 (tie-break): partially resolved.** `deleteInternal` sorting by `position` only is confirmed
  (`PipelineStepRepository.scala:990`). See new CR3 below for the part still missing.
- **CR4 (tool schema): resolved.** Task 3.5 is added.
- **CR5 (AC7): resolved.** Task 6.1 is added.

**Premises re-checked at HEAD**

- `PatchSetTargetFingerprint.scala:55-62`: OutputDelete hashes `{name, config}`; PipelineStepDelete hashes `stepState`.
- `Allowlist` is at lines 32-39. `of` projects only the keys present (line 93), so D1's "update fingerprints
  byte-identical" holds by construction.
- V94:209: `node_step_id ... ON DELETE CASCADE`. V94:344 and :391 cascade panels and alert_rules from outputs.
- The latest migration is V130.
- Open PRs #991, #990 and #986 touch no migration, patchsets, assistant, ServiceResponse or PipelineStepRepository file
  (checked with `gh pr diff --name-only`). V131 is free.
- `rewriteUpsertTargetAction` has one caller (`DataSourceRepository.scala:501`), so D8's real write path exists.
- `OutputRepository.updateSchemaInternal` exists (line 262).

**Other checks**

- `openspec validate patch-set-stale-followups --strict` reports: `Change 'patch-set-stale-followups' is valid`.
- The MODIFIED stale-check requirement keeps all five base scenarios and adds four. The patch-set-preview MODIFIED
  requirement keeps both base scenarios.
- Every AC (AC1-AC7) maps to at least one task.

**New findings from ground truth**

- **The 409 `PATCH_SET_ALREADY_APPLIED` cannot be rendered as D5 specifies.**
  - `ServiceError.Conflict(message)` renders through the default arm of `ServiceResponse.completeError` as
    `ErrorResponse(message)`, which has no `code` field (`ResourceProtocol.scala:9`, `ServiceResponse.scala:~90`).
  - The frontend detects a 409 kind only by `err.response.data?.code` (`patchSetsSlice.ts:258`).
  - The existing analogue, the stale 409, uses a dedicated variant (`ServiceError.PatchSetStale`), its own
    `completeError` arm, its own wire type, and a shared JSON schema (`schemas/shared/patch-set-stale-response.schema.json`)
    pinned by `PatchSetFingerprintWireSpec`.
  - None of that is planned for the new 409.
- **A third copy of the splice rule exists that D3 does not mention.**
  - `PatchSetPreviewRemovals.removedStepIds` (`PatchSetPreviewRemovals.scala:47-52`, HEL-1498) re-derives "deleted step
    + every child but the lowest-positioned, with subtrees".
  - It sorts by `position` only (`.sortBy(_.position)`, a stable sort over `listByPipelineInternal`'s row order).
  - D3 claims "one removed-set rule" and fixes the tie-break only in `deleteInternal` and the new
    `removedByDeleteInternal`. With ties, this overlay copy would then disagree with the delete it models.
- **The UUID-validation site contradicts itself across D5, D6 and task 3.2.**
  - One `patchSetFormat` (`PatchSetProtocol.scala:215`, `jsonFormat2`) is shared by the apply route, the preview route,
    `RefinementParsing.parsePatchSet`, and `AssistantToolExecutor.decode[PatchSet]`.
  - D5 says "non-UUID → 400 at decode", and task 3.2 says "protocol ... UUID-validated → 400".
  - D6 says "decoded leniently ... UUID enforced only on apply".
  - Following task 3.2 literally would put the UUID check in the shared format. That makes a model-written non-UUID fail
    `propose_patch_set` and trigger a refinement repair round, which is exactly what round-1 CR1 asked to avoid.
- **D4's caller-scoped alert-rule read has no route into the preview.**
  - `PatchSetApplyContext` (`PatchSetApplyTypes.scala:98-110`) carries no `AlertRuleRepository`.
  - `OutputRepository.findAlertRuleDefinitionsInternal` (line 170) returns no `owner_id`.
  - `PanelRepository` has no batched caller-scoped read, only `findById(id, Some(user))` (line 141).
  - So D4 needs either a new collaborator on the context or a new read. Its "ONE construction path" note says adding a
    collaborator is a compile-enforced change to both services' construction sites, and the design and Impact name
    neither.

### Verdict: REFUTE

### Change Requests

1. **D5 / task 3.3 / proposal Impact: specify the 409 contract properly.** Replace "`Left(ServiceError.Conflict)`
   rendered as 409 `PATCH_SET_ALREADY_APPLIED`" with a concrete mechanism that emits `{message, code}`. Mirror the stale
   409:
   - a dedicated `ServiceError` variant, for example `PatchSetAlreadyApplied(message)`, mapped to 409 in `statusCodeFor`;
   - a `completeError` arm that emits a response type carrying `code = "PATCH_SET_ALREADY_APPLIED"`.

   A plain `Conflict` body has no `code` (`ResourceProtocol.scala:9`), so the frontend check in D7 could never match.

   Add the contract delta as well:
   - a `schemas/shared/patch-set-already-applied-response.schema.json`, or a generalisation of the stale schema;
   - a wire test pinning the body against it, alongside `PatchSetFingerprintWireSpec`;
   - the schema listed in proposal Impact.

   The message must stand on its own, because MCP forwards only `message`.
2. **D3 / task 1.2: route every copy of the splice rule through the shared function.**
   `PatchSetPreviewRemovals.removedStepIds` (`PatchSetPreviewRemovals.scala:47-52`) is a third derivation of the removed
   set, and it sorts by `position` only.
   - Name it in D3 and replace it with the shared pure function, which already has the rows in memory.
   - Extend test 4.7a so the overlay's removed set agrees with the fingerprint's set and with `deleteInternal` under tied
     positions.

   Otherwise D3's tie-break fix creates exactly the preview-vs-delete drift D3 exists to prevent.
3. **Task 3.2 vs D5 vs D6: put UUID validation in one unambiguous place.** State that `patchSetFormat` decodes
   `proposalId` as any optional string, and that the UUID check (→ 400) runs only on the apply path, in the apply route
   or at the top of `PatchSetApplyService.apply`. It must never run in the shared format used by preview, refinement
   parsing and `propose_patch_set`. Reword D5's "at decode" and task 3.2's "protocol ... UUID-validated" to match. Test
   4.7's "non-UUID 400 on apply" plus 4.8's "never fails propose" then pin both sides.
4. **D4 / task 2.1: name the reads the hint uses.** Say how caller-visible alert rules are determined. Either:
   - add `AlertRuleRepository` to `PatchSetApplyContext` (both services' construction sites and the parity test change,
     so list them in Impact), or
   - add an owner-returning variant of the internal alert-rule read and filter on `owner == caller`.

   Also say how panel names are resolved without one query per panel, for example a batched caller-scoped
   `findByIds(ids, user)`, or the internal `findByOutputIdInternal` rows filtered through one batched dashboard-access
   check. Never name from a privileged row without that check.

### Non-blocking notes

- **AC5 / task 4.9: add mutation runs for the newly tested fields.** The new tests for already-covered fields
  (schedule `enabled`/`timezone`, step `position`/`parentStepId`, Output `kind`/`nodeStepId`, alert-rule edits) cannot
  be red-first, because the coverage already exists. A mutation run per field (drop it from `StepKeys`/`OutputKeys`/the
  schedule object, confirm red, restore) is the only evidence those tests exercise the field. Task 4.9 currently lists
  only `alertRules` and the new keys.
- **D4 and the overlay.** A panel an earlier edit renamed should be named by its overlay title (`overlay.panel(prior)`).
  A panel an earlier edit created against one of the pipeline's Outputs is not in the stored read. Either handle both
  cases or record them as residuals.
- **Undo does not release `proposalId`.** Keep this listed in the PR body as an owner-reviewable assumption, as round 1
  noted.
- **D5 RLS.** The claim insert and delete must run under `withUserContext(owner)`, because FORCE RLS refuses them
  silently otherwise. Prefer a test on the RLS-enforcing path (see MISTAKES.md's RLS parity entry).
