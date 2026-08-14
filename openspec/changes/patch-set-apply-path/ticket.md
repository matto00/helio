# HEL-406: Patch-set apply path (atomic N targeted edits with rollback)

## Description

Given a reviewed patch set (HEL-403 patch-set schema ticket), this ticket applies its N targeted
edits **atomically**: all edits succeed or none do. It is the mutation analogue of
`DashboardProposalService` (which composes existing services + rolls back a partially-created
dashboard on failure) — but here edits are updates/deletes/creates across existing resources,
applied via the existing per-resource services (`PanelService.update`, `DashboardService.update`,
and the HEL-328 source/type/pipeline/step PATCH services).

Touches: new `backend/src/main/scala/com/helio/services/PatchSetApplyService.scala`, a route
(e.g. `POST /api/patch-sets/apply`) wired in `api/ApiRoutes.scala`, the `PatchSet` protocol, and
the existing per-resource update services + `PanelPatchApplier`.

## Scope

* Backend Scala: `PatchSetApplyService.apply(patchSet, user)` that pre-validates every edit
  (target resolves + owned under RLS + patch shape valid) up front so an invalid patch set
  changes nothing, then applies each edit in order via the EXISTING per-resource services. No
  direct DB writes; no fully-qualified names inline.
* Atomicity + rollback: capture each edited resource's prior state before mutating; on any
  failure, restore the prior states (inverse edits) so the workspace is left exactly as before.
  Document the rollback approach (prior-state capture vs a DB transaction spanning the services)
  and its limits.
* Backend Scala: `POST /api/patch-sets/apply` returning the per-edit outcome + the resulting
  resource states. RLS enforced; a cross-owner edit is rejected pre-apply.
* Emit the captured prior-state set so the undo ticket can consume it (shared shape).
* Tests: ScalaTest for a mixed patch set applying cleanly; a mid-set failure rolling back ALL
  prior edits (assert every touched resource is back to its original state); pre-apply rejection
  of an invalid/unauthorized edit changing nothing.

## Acceptance Criteria

- [ ] `POST /api/patch-sets/apply` applies all edits atomically; a failure rolls back every
      already-applied edit (verified by test asserting original states restored).
- [ ] All edits pre-validated (target + ownership + shape) before any mutation; an invalid set
      changes nothing.
- [ ] Applies via existing per-resource services (`PanelService`/`DashboardService`/HEL-328
      services) — no duplicated mutation logic; RLS enforced.
- [ ] Prior-state capture is emitted in a shape the undo ticket can consume.
- [ ] `sbt test` green.
- [ ] Backward-compat: additive endpoint/service; existing PATCH endpoints unchanged.

## Out of Scope

* Diff/impact preview (sibling ticket) and undo (sibling ticket) — this provides the apply +
  rollback primitive they build on.
* Authoring the patch set from NL (that is the multi-turn refinement ticket + Claude wiring).

## Dependencies

* Depends on the HEL-343 patch-set schema/protocol ticket (HEL-403, merged — `PatchSetProtocol`,
  `PatchSet`/`Edit`/`EditTarget`). Blocked by HEL-328 (per-resource PATCH services/shapes,
  merged). Consumed by the diff-preview and undo tickets.

## Carried-over follow-up from HEL-403 (see Linear comment on this ticket)

No test currently covers a `delete`-op `Edit` whose wire JSON carries a populated `patch` field —
`PatchSetProtocol.scala`'s `Edit` reader silently drops it today. This ticket's design MUST
explicitly decide the intended semantics for a `delete` edit with a non-empty `patch` (reject as
malformed vs. ignore vs. something else) and add test coverage for whatever is decided, rather
than carrying the silent-drop forward unexamined.
