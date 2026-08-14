## Why

HEL-403 defined the `PatchSet` artifact (schema + protocol) but nothing applies it. Conversational
refinement needs an atomic apply path: N targeted edits across resources either all succeed or none
do, mirroring `DashboardProposalService`'s existing compose-then-rollback shape but for edits to
*existing* resources (update/delete/create), not just creates.

## What Changes

- New `PatchSetApplyService.apply(patchSet, user)`: pre-validates every edit (target
  exists/owned/shape decodes) before any mutation, then applies edits in the caller's given order
  via EXISTING per-resource services only. On any failure, walks already-applied edits backward,
  compensating each: undo a `create` by deleting it (mirrors `PipelineProposalService.rollback`);
  undo an `update` by reapplying its captured full prior state as an inverse update (new pattern,
  reuses the same `Update*Request` shapes/services the forward edit used).
- `op: create` and `op: delete` are supported per-kind where a symmetric, non-duplicative
  compensating action exists via the EXISTING services; where one doesn't, that op is either
  rejected at pre-validation (no viable path at all) or executed with an explicitly-reported,
  non-silent rollback limitation. Full per-kind support matrix in design.md — grounded in real
  constraints (no direct `DataType` create API; heterogeneous/live-I/O `DataSource` create variants;
  cascading deletes on dashboard/dataSource/pipeline; no parent-pipeline reference field for a
  not-yet-existing `pipelineStep` create), not an arbitrary scope cut.
- New `POST /api/patch-sets/apply` route, RLS-enforced (via the SAME access rule each target
  kind's real update/delete path enforces, not a same-named-but-different repo lookup — see
  design.md D2), returning per-edit outcomes.
- **Modifies `PatchSetProtocol.scala`** (HEL-403, already merged/archived): `Edit.read` currently
  discards a `delete`-op edit's `"patch"` field entirely before constructing `Edit`, so nothing
  downstream could ever detect and reject it — the exact carried-over follow-up this ticket was
  asked to resolve. Fixed at the layer that actually has the signal: `Edit.read` now raises a
  `deserializationError` for a populated `patch` on a `delete` edit, mirroring its existing
  `target.id` enforcement (design.md D6). A `Modified Capability` on `patch-set-contract` below.
- Tests: a mixed patch set (panel update + panel delete + dashboard update) applying cleanly; a
  mid-set failure rolling back every prior edit in that same fully-recoverable combination; an
  invalid/unauthorized edit rejected pre-apply with nothing changed; a `delete` edit with a
  populated `patch` rejected pre-apply; an unrecoverable-delete case reported honestly, not
  silently swallowed.

## Non-Goals

- Diff/impact preview and undo (sibling tickets) — this ships the apply + rollback primitive only.
- Authoring the patch set from NL.
- Cross-edit references (one edit's `patch` referencing another edit's about-to-be-minted id) —
  `PatchSet`'s schema (HEL-403) has no sentinel/reference mechanism for this, unlike
  `CombinedProposal`'s `$pipelineOutput`; each edit is independent.
- Full, identity-preserving delete-rollback for every kind (see per-kind matrix, design.md D1) —
  a documented, real limit, not an oversight. Panel/pipelineStep delete-rollback restores content
  under a NEW id (design.md D3a), never the original.
- Idempotent get-or-create (`ifExists: "return"`) for a dashboard create-op edit — rejected at
  pre-validation (design.md D3a); this ticket never needs it and it breaks rollback symmetry.

## Capabilities

### New Capabilities
- `patch-set-apply`: the atomic apply-with-rollback path consuming the `patch-set-contract`
  (HEL-403).

### Modified Capabilities
- `patch-set-contract`: `Edit.read`'s handling of a `delete`-op edit's `patch` field changes from
  silently discarding it to rejecting it with a `deserializationError` (design.md D6).

## Impact

- `backend/src/main/scala/com/helio/services/PatchSetApplyService.scala` (new).
- `backend/src/main/scala/com/helio/api/protocols/PatchSetApplyProtocol.scala` (new — response
  shapes).
- `backend/src/main/scala/com/helio/api/routes/PatchSetRoutes.scala` (new) + `ApiRoutes.scala`
  wiring.
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` (add new protocol trait).
- `schemas/patch-set-apply-response.schema.json` (new).
- `backend/src/main/scala/com/helio/api/protocols/PatchSetProtocol.scala` (modified — `Edit.read`'s
  delete-op `patch` rejection, design.md D6; HEL-403's own carried-over follow-up).
- `backend/src/test/scala/com/helio/services/PatchSetApplyServiceSpec.scala` (new).
- `backend/src/test/scala/com/helio/api/protocols/PatchSetProtocolSpec.scala` (extended — new
  rejection test case).
- No changes to existing PATCH endpoints or request shapes.
