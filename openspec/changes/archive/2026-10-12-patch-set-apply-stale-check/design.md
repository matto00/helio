## Context

See proposal.md (Why). Preview and apply share one read pass: `PatchSetApplyResolvers.resolveAll` (per-kind resolvers in
`PatchSetPanelResolvers`/`PatchSetPipelineResolvers`/`PatchSetPipelineStepResolvers`/`PatchSetOutputResolvers`/
`PatchSetDataSourceResolvers`) authorizes every edit and reads each update/delete target's prior domain object into
`ResolvedAction.*(…, prior)` and `ResolvedEdit.priorStateJson`. Preview projects from that; apply forward-applies from it.
`PatchSetUndoConflictCheck` already solves the sibling problem for undo by comparing only the fields an edit could
restore, never a whole-JSON diff, because pipelines carry run-updated fields (`lastRunStatus`/`lastRunAt`/
`lastRunRowCount`) and panels carry server-materialized config (`metricDeprecated`, metric-derived fields).
Concurrent lane HEL-1457 adds a server-maintained `layoutVersion` to every dashboard response.

## Goals / Non-Goals

**Goals:** apply never writes onto a target whose editable state differs from what the caller's preview showed, when
the caller supplies fingerprints; all-or-nothing on conflict; existing callers unchanged; MCP protected by default.

**Non-Goals:** row locks across check and write; required fingerprints; conflict on vanished targets (unchanged
loud failure); per-field merge/rebase of a stale edit.

## Decisions

**D1 Carrier: optional `target.fingerprint` (opaque string) on update/delete edits; preview echoes it per entry.**
Alternatives: `updatedAt` per target (not uniform across six kinds, and dashboards' `lastUpdated` moves for reasons
unrelated to editable state); a server-issued preview token stored in a table (needs a migration, TTL and cleanup,
and MCP has no preview tool to obtain one); a required field (breaks every existing caller). Per-target placement
travels with the patch set itself, so refinement output carries it to MCP with no new tool. Reversible: removing the
optional field restores today's behaviour.

**D2 Fingerprint = `"v1:" + sha256hex(canonical JSON of a per-kind allowlisted projection of the prior state)`.**
Computed from the prior object the resolvers already read (one exception: output delete, see table), by ONE helper
(`PatchSetTargetFingerprint`) used by both preview and apply so they cannot drift. Canonical JSON sorts object keys
recursively (spray `JsObject.fields` is an unordered `Map`). The allowlist per kind is exactly the fields that kind's
`Update*Request` can write (for delete, the same set), reusing `PatchSetUndoConflictCheck`'s choices where it has them
(panel: `title`, `appearance`, raw config with `metricDeprecated` stripped). Server-maintained fields (timestamps,
`lastRun*`, `layoutVersion`, ownership, ids) are excluded by construction — an allowlist, not a denylist, so a field
added later (e.g. HEL-1457's `layoutVersion`) cannot cause false conflicts. Request-only preconditions (HEL-1457's
`expectedLayoutVersion`) are not writable state and are excluded. Version prefix lets the algorithm change later; an
unknown prefix is stale. Per-kind field table (update and delete use the same set):

| kind | fields (source) |
| --- | --- |
| panel | `title`, `appearance`, `type`, raw config minus `metricDeprecated` (`UpdatePanelRequest`; from the object the panel resolver already read — no new read) |
| dashboard | `name`, `appearance`, `layout` (`UpdateDashboardRequest`) |
| dataSource | `name`, `type`, `config` (secrets redacted by `DataSourceResponse.fromDomain` before hashing), `tag`, `inferredSchema` (the declared schema of a dataset) — what the resolver reads and what delete removes (owner revise, HEL-1458) |
| pipeline | `name`, `tag`, `roots` (id, dataSourceId), and the definition of what is deleted with it: `steps` (id, type, config, position, enabled, parentStepId, rootId), `outputs` (id, name, kind, nodeStepId, config), `schedule` (kind, expression, enabled, timezone) — `PatchSetPipelineDefinition` (owner revise, HEL-1458) |
| pipelineStep | `type`, `config`, `position`, `enabled` (`UpdatePipelineStepRequest`) |
| output | `name`, stored config (`UpdateOutputRequest`); delete reads config with the same read the update resolver uses, used only for the fingerprint |

**Owner revise (HEL-1458, PR #976): dataSource and pipeline fingerprints cover what apply reads or overwrites.** Derived
from the code, not from the update request. Update (`PatchSetDataSourceResolvers`/`PatchSetPipelineResolvers`) reads the
whole `DataSource` / `PipelineSummary` (the preview `before` and the journaled `priorState` are those projections) and
writes only `name`; delete (`DataSourceService.delete`, `PipelineService.delete` -> `pipelineRepo.delete`) removes the
row and everything the Flyway FKs cascade from it (pipeline: steps V23, outputs V94, roots V98, schedule V62, runs V24,
auto-run debounce V110, payload history V116, binary refs V94). The set therefore includes each cascaded child's
*definition*. Update and delete share one set per kind (the existing convention, and one fingerprint per target is what
preview issues); the cost is that a pipeline rename goes stale when its steps change, which is one Re-preview.

- Not covered, deliberately: dataset **row contents** and stored **file bytes** (data, not definition: including them
  would make deleting an actively written dataset unappliable), pipeline **run history, payload history and snapshots**,
  and tick/run-maintained fields (`lastRun*`, timestamps, `next_run_at`). A delete still removes them unnoticed.
- **Secrets:** the dataSource config is hashed from the same redacted projection the API returns, so no credential feeds a
  client-visible hash. Consequence: a change to a secret alone (REST token, SQL password) is not noticed.
- `tag` and `type` are immutable after create (no write path), so they are covered but cannot be exercised by a
  change-then-409 test; a stored dataSource `config` has no service write after create other than refresh, so its test
  uses `DataSourceRepository.update`, the real write path.
- A pipeline's children are read with the privileged `*Internal` repository methods (plus `findScheduleDefinitionInternal`):
  the pipeline was already resolved as the caller's own, so no id is caller-supplied.
- Step, Output and panel/dashboard edits remain separate targets with their own fingerprints.

**D3 Check placement: in `PatchSetApplyService.apply`, after `resolveAll` succeeds and before `applyResolved`.**
Every edit with a supplied fingerprint is compared; ALL mismatches are collected (not first-only) so the 409 names
every stale target. Authorization failures keep precedence (a 403/404 from resolution is returned before any
fingerprint is compared, so fingerprints never leak existence). A fingerprint on a `create` edit is a 400 at
resolution time in both preview and apply.

**D4 Error shape: new `ServiceError.PatchSetStale(staleTargets, message)` → 409 with
`{message, code: "PATCH_SET_STALE", staleTargets: [{index, kind, id}]}`**. `message` itself names every stale target
(`edit <index> (<kind> <id>)`, comma-separated) and says to re-preview, because helio-mcp's `describeError` forwards
only `body.message` — this is how stale targets reach MCP callers without a client change. Rendered in `ServiceResponse.completeError`
following the `StepConfigInvalid` precedent (structured body + `code`). A plain `Conflict(message)` was rejected:
clients would have to parse prose to find the stale targets.

**D5 Refinement stamping; model output never carries fingerprints.** `RefinementService.parseAndValidate` already
previews exactly the patch set it returns (result currently discarded). It first STRIPS any model-emitted
`fingerprint` from every target (so a model-invented value on a create can never trigger the new 400), previews, then
copies each preview entry's fingerprint onto the matching edit's target by index. The stamped set is what is returned
and what is stored as the conversation's `latestPatchSet`. MCP `propose_patch_set` therefore returns a stamped set.
`AssistantToolExecutor`'s preview path likewise strips model-emitted fingerprints before previewing (its patch sets go
to the review page, which stamps its own). `AssistantProposalToolSchemas.EditTargetSchema` gains `fingerprint`
(required by the strict schema-drift check, `scripts/check-schema-drift.mjs`) described as server-assigned:
"omit; any value sent is discarded".

**D6 Frontend.** `PatchSetReviewPage` keeps the preview response it renders; Apply sends the patch set with each
update/delete target's `fingerprint` set from that preview (the state the user saw), overriding any incoming one.
The slice's apply thunk rejects with a typed value carrying `code` + `staleTargets` on 409. The page renders a conflict
notice naming the stale targets and a Re-preview button (re-dispatches preview; the new response's fingerprints are
then used). Apply is disabled while a preview is loading. Successful apply calls `navigate("/", { replace: true })`.
Copy and components follow DESIGN.md (existing inline error/notice patterns, no new tokens).

**D7 helio-mcp.** `editTargetSchema` gains `fingerprint: z.string().min(1).optional()` (zod strips unknown keys, so
without this the stamped fingerprint would be silently dropped and MCP left unprotected); `types.ts` mirrors it; the
tool description documents the 409 and "re-propose, do not retry"; the error result includes the stale targets.

## Risks / Trade-offs

- [Check-then-write window: a write landing between the check and forward-apply is still overwritten] → the window
  shrinks from minutes (human review) to the duration of one request; locking across six services is out of scope.
- [Allowlist misses an editable field → false negative] → per-kind test mutates each allowlisted field through the real
  route/service and asserts the fingerprint changes; the Planner Notes table is checked against each `Update*Request`.
- [Allowlist includes a server-maintained field → spurious 409s] → test that a pipeline run, and an unrelated panel's
  edit, leave the fingerprint unchanged.
- [Whole-editable-state fingerprint is conservative: a dashboard rename-only edit goes stale when a panel is moved on
  that dashboard] → accepted; the cost is one Re-preview, the alternative risk is a silent overwrite.
- [Concurrent HEL-1457/HEL-1515 touch dashboard update and step update paths] → fingerprints read prior state only and
  call no update path; re-sync with origin/main before PR and re-run the patch-set suites. HEL-1457 also adds a
  `ServiceError` variant and a `ServiceResponse` case — whichever lane merges second keeps both. HEL-1515 edits
  `PatchSetUndoServiceFixture.scala`; avoid unrelated edits there.
- [`position` in the step fingerprint: a sibling splice elsewhere marks a pending step edit stale] → accepted
  (conservative); one Re-preview.
- [Create-only patch sets re-entered from the refinement drawer or assistant hand-off can still be applied twice —
  replace-navigation closes only the Back path] → out of scope; listed as a follow-up.

## Migration Plan

No schema migration. Deploy is backwards compatible (field optional). Rollback = revert; stamped patch sets sent to an
old server are rejected only if the server's JSON reader rejects unknown target keys — the executor verifies the
current `editTargetFormat` reader ignores unknown keys (it reads by name) and the JSON schema is updated in lockstep.

## Planner Notes

- Self-approved: content hash over `updatedAt`; optional over required; conservative whole-editable-state scope.
- OWNER REVIEW (assumed product call): new 409 `PATCH_SET_STALE` reachable by MCP callers via refinement stamping, and
  the optional `target.fingerprint` contract field. PR must be parked for the owner.
- Per-kind field table: fixed in D2 (design-gate round 1, CR3).
- Design gate round 2 notes: the create+fingerprint 400 lives at resolution (never in `editFormat.read`, or
  refinement's parse fails before the strip); `AssistantToolExecutor`'s captured `AssistantProposal.Patch` must hold
  the STRIPPED patch set; add a 409 body schema under `schemas/shared/` mirroring `step-config-error-response`.
- Red test on main sends `target.fingerprint` as raw JSON (the Scala field does not exist yet).
