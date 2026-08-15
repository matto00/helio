# HEL-413: Undo of an applied agent patch set

## Description

Conversational refinement mutates live resources. Even with a diff-preview, users need a safety net:
"undo that." The patch-set apply path (HEL-343 apply ticket, HEL-406) already captures each edited
resource's prior state to power its rollback-on-failure; this ticket persists that prior-state
snapshot per successfully-applied patch set and exposes an undo that restores it.

Touches: a persisted patch-set-application journal (see Flyway note), the `PatchSetApplyService`
(persist prior-state on success), an undo endpoint, the MCP + in-app surfaces, and the existing
per-resource services used to restore state.

## Scope

- Persistence: on a successful patch-set apply, persist an application record
  `{ id, user, appliedAt, edits, priorState }` (the prior-state capture the apply ticket already
  produces). **Flyway migration: next available VNN, assigned at scheduling time** (main at V78 as of
  HEL-411; multiple v1.6 lanes may contend). Owner-scoped, RLS.
- Backend Scala: `POST /api/patch-sets/:id/undo` that reconstructs and applies the inverse edits
  (restore prior state) via the existing per-resource services, atomically (reuse the apply ticket's
  atomic primitive). Handle conflicts: if a resource was changed again since the patch set was
  applied, either refuse with a clear conflict error or restore-with-warning — pick one and document
  it. No fully-qualified names inline.
- Bound retention (e.g. last N application records per user, or a TTL) so the journal doesn't grow
  unbounded.
- Surfaces: an undo affordance in the in-app chat/refinement flow (undo the last applied patch set)
  and an MCP `undo_patch_set` tool.
- Tests: ScalaTest that undo restores every touched resource to its pre-apply state; the conflict
  case behaves as documented; RLS (can't undo another user's patch set); retention bound honored. MCP
  + Jest/RTL for the surfaces.

## Acceptance Criteria

- [ ] A successfully-applied patch set is journaled with its prior-state snapshot (owner-scoped,
      RLS); new Flyway migration uses the next available VNN (not hardcoded).
- [ ] `POST /api/patch-sets/:id/undo` atomically restores the pre-apply state via existing services.
- [ ] The changed-since-apply conflict case behaves as documented (refuse-with-error or
      restore-with-warning), verified by test.
- [ ] Journal retention is bounded.
- [ ] In-app undo affordance + MCP `undo_patch_set` tool exposed.
- [ ] `sbt test` + MCP tests + `npm test` + lint/format green.
- [ ] Backward-compat: additive; existing apply path unchanged (it just also journals on success).

## Out of Scope

- Multi-level / redo history (single-level undo of the last applied patch set is sufficient here).
- Undo of non-patch-set mutations (manual edits, create-only proposals).

## Dependencies

- Depends on the HEL-343 patch-set apply ticket (prior-state capture, HEL-406, shipped) and schema
  ticket (HEL-403, shipped). Blocked by HEL-328 (shipped). Bears a Flyway migration.
