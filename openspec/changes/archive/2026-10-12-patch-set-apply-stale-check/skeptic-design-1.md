## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `e4ef70c31f7c16d9687a199feae997dce0217455` (= origin/main; the planning artifacts are untracked in the
worktree). cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/patch-set-apply-stale-check/HEL-1458`.

### What I verified (with evidence)

- **Apply/preview share one read pass.** `PatchSetApplyService.apply` = `resolveAll` then `applyResolved`.
  `PatchSetPreviewService.preview` = `resolveAll` then projection. Both build their context through
  `PatchSetApplyContext.build`. So a check placed after `resolveAll` and before `applyResolved` (D3) runs before any
  write, sees every target's pre-write state, and comes after authorization. **Sound.**
- **Preview entries match edits by index.** `EditPreview(index, kind, op, before, after, impact)` has no target id, so
  stamping by index (D5/D6) is the only option. That works because preview returns one entry per edit, in order.
- **The reader ignores unknown keys.** `editTargetFormat.read` reads `kind`/`id`/`parentId` by name
  (PatchSetProtocol.scala). A `fingerprint` sent to today's server is silently ignored, which is the rollback claim in
  the Migration Plan. It also means a JSON-level red test (1.1) gets a 200 and an overwrite on main, so it is a real
  red.
- **Refinement previews exactly the patch set it returns.** `RefinementService.parseAndValidate` runs
  `parsePatchSet(text)`, then `patchSetPreviewService.preview(patchSet, user)`, then `case Right(_) => Right(patchSet)`.
  The preview result is currently thrown away, and that same `patchSet` is what `RefinementResponse` returns and what
  `persistNew`/`persistContinuation` store. D5 is implementable there. **Confirmed.**
- **helio-mcp drops unknown keys.** `editTargetSchema` is a plain `z.object({kind, id?, parentId?})`. zod's default
  strips unknown keys, and the HEL-914 header comment in `refinementSchemas.ts` records exactly this happening with
  `parentId`. **D7 is correct and necessary.**
- **The review page flow can support D6.** The patch set comes from `location.state.patchSet`. A preview `useEffect`
  keyed on `[patchSet, dispatch]` stores it in local state. `handleAccept` calls `applyPatchSet(patchSet)` and then
  `navigate("/")`, a push, which confirms the ticket's Back variant. The page is entered by
  `navigate("/patch-sets/review", {state})` from `RefinementChatDrawer.tsx:198` and `ProposalHandoff.tsx:61`. With
  `replace: true` the review entry leaves history, so Back lands on the originating page. Re-preview needs a trigger
  such as a nonce, because the effect is keyed on the patch set object. That is an implementation detail and is
  feasible.
- **Precedent for a structured 409.** `ServiceError.StepConfigInvalid` → `StepConfigErrorResponse` in
  `ServiceResponse.completeError` (line 80). It has a schema at `schemas/shared/step-config-error-response.schema.json`.
  D4 follows an existing pattern.
- **Per-kind prior objects, as read by the resolvers:**
  - panel: `panelRepo.findById` row, read raw. `metricDeprecated` now appears only in `PatchSetUndoConflictCheck`, and no
    server-side panel-config writer exists outside `PanelPatchApplier`.
  - dashboard: domain `Dashboard`.
  - dataSource: `findByIdOwned`.
  - pipeline: `PipelineSummary`, which carries `lastRun*` and `updatedAt`.
  - pipelineStep: `findByIdInternal`.
  - output update: `Output` plus `findConfigById`.
  - **output delete: `Output` only, with no config read.**
- **Update request fields:**
  - `UpdatePanelRequest(title, appearance, type, config)`
  - `UpdateDashboardRequest(name, appearance, layout)`
  - `UpdateDataSourceRequest(name)`
  - `UpdatePipelineRequest(name)`
  - `UpdatePipelineStepRequest(type, config, position, enabled)`
  - `UpdateOutputRequest(name, config)`
- **HEL-1457 lane** (uncommitted diff in its worktree): it adds `Dashboard.layoutVersion`,
  `DashboardResponse.layoutVersion`, **`UpdateDashboardRequest.expectedLayoutVersion`**, and
  `ServiceError.LayoutConflict` plus a `ServiceResponse` case. It does not touch the patch-set resolvers.
- **HEL-1515 lane:** no changes to patch-set main code. It does modify `PatchSetUndoServiceFixture.scala` and the undo
  lane specs, which are test-only and could conflict with new patch-set fixtures.
- **Schema drift gate:** `scripts/check-schema-drift.mjs:727-730` requires strict property-name parity between
  `AssistantProposalToolSchemas.EditTargetSchema` and `patch-set.schema.json $defs.EditTarget`. Missing names fail in
  both directions, and `KNOWN_PRE_EXISTING_DRIFT` is empty under a stated zero-exception policy. The JSON schema's
  `EditTarget` is `additionalProperties: false`.
- **MCP error text:** `HttpClient.describeError` (httpClient.ts:398) puts only `body.message` (plus the tier codes) into
  the `HelioApiError` text that `guarded()` returns. Any other 409 body field never reaches the MCP caller.

### Verdict: REFUTE

The approach is sound: an optional per-target content fingerprint, checked after resolution and before any write,
all-or-nothing, with refinement stamping and replace-navigation. Four specific gaps would make the executor either fail
a gate or make an unplanned contract or product decision mid-execution. Each is cheap to fix in the artifacts.

### Change Requests

1. **Missing contract surface: the in-app assistant's tool schema.** Task 2.7 adds `fingerprint` to
   `patch-set.schema.json $defs.EditTarget`. The schema-drift check (`scripts/check-schema-drift.mjs:727-730`, strict,
   zero exceptions) will then fail unless `AssistantProposalToolSchemas.EditTargetSchema`
   (`backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala:368`) also gains
   `fingerprint`. That would advertise a server-stamped field to the assistant model's `propose_patch_set` tool. If the
   model then emits a fingerprint on a `create` edit, the new 400 (D3) fails the assistant's tool call through
   `AssistantToolExecutor.executeProposePatchSet` → `preview`. Neither the design nor the tasks mention this file or the
   assistant producer at all. Decide it in design.md and add a task. For example: add `fingerprint` to
   `EditTargetSchema` with a description saying it is server-stamped and must never be set by the model, and keep the
   `AssistantProposalToolSchemasSpec` decode pins green. Or state an alternative and accept its consequences. Do not
   leave it to be discovered when the gate fails.
2. **D2 contradicts the code for `output` delete.** D2 says the fingerprint is "computed from the SAME prior object the
   resolvers already read (no second read, no new query)" and that the delete allowlist is "the same set". For output
   that set is `name` plus `config`. But `resolveOutputDelete` (PatchSetOutputResolvers.scala:63-84) reads only the
   `Output` domain object, which has no config. It deliberately writes `JsObject.empty` as `priorState` config (the
   HEL-946 comment), and `ResolvedAction.OutputDelete` carries no config. As written, D2 can only produce a name-only
   fingerprint for output delete. That violates the spec's "SHALL change when any field that the target kind's update
   request can write changes". Pick one and record it:
   - (a) Add a `findConfigById` read to output delete for the fingerprint only, leaving `priorStateJson` unchanged, and
     revise the no-extra-read claim.
   - (b) Explicitly scope the output delete fingerprint to `name` and soften the spec sentence for deletes.
3. **Fill in the per-kind field table now instead of deferring it to the executor.** It is the core contract of this
   change, and the deferral already hides inconsistencies:
   - D2 lists panel as "title, appearance, raw config". By D2's own rule `type` belongs in the set too, because
     `UpdatePanelRequest.type` exists.
   - Once HEL-1457 lands, `UpdateDashboardRequest` will carry `expectedLayoutVersion`. That is a precondition, not a
     writable field, so "exactly the fields the Update request can write" needs wording that excludes it.
   - The proposal and spec purpose say "user-editable state". D2 says "fields the `Update*Request` can write". These
     differ for `dataSource` (schema via `PATCH /:id/schema`, rows, config and refresh are user-editable but not in
     `UpdateDataSourceRequest(name)`) and for `pipeline` (`UpdatePipelineRequest(name)` only). So a dataSource or
     pipeline **delete** is fingerprinted by name alone, and a dataset whose schema was changed after preview is still
     deleted without warning. That may be acceptable, but it is an owner-visible limitation of the ticket's "a delete
     can remove a resource someone edited after the preview" AC. Write it into the table and the OWNER REVIEW note
     explicitly, and make the proposal/spec wording match D2.
4. **Say how stale targets reach the MCP caller.** The spec scenario requires the MCP error result to report "status
   409 and the stale targets". helio-mcp's `describeError` forwards only `body.message`, so `staleTargets` in the JSON
   body is dropped. State the mechanism in D4/D7 and task 4.1, for example:
   - the server's `message` names every stale `(index, kind, id)`, so it works for every client; or
   - `describeError` is extended for `code: "PATCH_SET_STALE"`.

   Add an MCP test that asserts the stale ids appear in the tool's error text.

### Non-blocking notes

- **Creates can still apply twice.** Fingerprints do not cover `create` edits. A create-only patch set can still be
  applied twice by re-entering the review page from the refinement drawer's Review button (`latestPatchSet` is kept)
  or from the assistant's `ProposalHandoff`. The ticket's AC covers only Back, which replace-navigation fixes. Consider
  recording this residual risk in Non-goals.
- **Red test must compile on main.** Task 1.1 should drive the red tests through the JSON route or service with a raw
  `fingerprint` key. A Scala `EditTarget(..., fingerprint = ...)` constructor call does not compile on main, so it
  cannot show a red.
- **Stamped vs persisted patch set.** D5 stamps the returned patch set. Say whether the persisted
  `latestPatchSet`/conversation turn stores the stamped or the unstamped copy, so a later turn or the drawer's Review
  button is predictable. Either is fine, since the review page re-stamps from its own preview.
- **Merge overlap with HEL-1457.** Both lanes add a `ServiceError` variant and a `ServiceResponse.completeError` /
  `statusCodeFor` case. The textual conflict is trivial, but the second lane to merge must keep both cases. HEL-1515
  touches `PatchSetUndoServiceFixture.scala`.
- **Pipeline step `position`.** Including `position` in the pipelineStep fingerprint means inserting or deleting a
  sibling trunk step elsewhere (a splice that renumbers positions) marks a pending step edit stale. This is consistent
  with the accepted "conservative" risk, but mention it next to the dashboard/layout example.
