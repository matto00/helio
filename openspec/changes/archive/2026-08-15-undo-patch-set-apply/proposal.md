## Why

Conversational refinement mutates live resources. Even with a diff-preview (HEL-408) before Accept,
users need a safety net for after: "undo that." HEL-406's apply path already captures each edited
resource's full prior state to power its own rollback-on-failure — this ticket persists that
snapshot per successfully-applied patch set and exposes an undo that restores it.

## What Changes

- `PatchSetApplyService.apply` journals a successful (no `failure`) patch set to a new
  `patch_set_applications` table — owner-scoped, last N rows per user. `PatchSetApplyResponse` gains
  an additive `applicationId: Option[String]`.
- New `POST /api/patch-sets/:id/undo`: atomically restores every edit's pre-apply state via the SAME
  per-resource services, reverse-walking the journaled edits — the mutation-restoring mirror of
  `PatchSetApplyRollback`'s compensation walk, built from persisted response JSON rather than
  in-memory domain objects.
- Conflict handling: current live state is compared against captured post-apply state first; any
  mismatch refuses the WHOLE undo with `409` (see design.md for the rejected restore-with-warning
  alternative).
- New MCP `undo_patch_set` tool, joining the existing `mcp-patch-set-tools` capability.
- New in-app affordance: `PatchSetReviewPage`'s Accept flow shows an "Undo" action on the existing
  `Toast` component's action button, using the fresh `applicationId`.

## Capabilities

### New Capabilities

- `patch-set-undo`: the backend journal, the undo endpoint, conflict detection, and retention.

### Modified Capabilities

- `patch-set-apply`: `apply` additionally journals a successful application and returns an additive
  `applicationId`.
- `patch-set-preview`: `PatchSetReviewPage`'s Accept flow additionally surfaces an "Undo" toast action.
- `mcp-patch-set-tools`: gains the `undo_patch_set` tool alongside the existing propose/apply pair.

## Impact

Backend: new migration + table, new `PatchSetUndoService`, additive changes to `PatchSetApplyService`/
`PatchSetApplyProtocol`, new route. Frontend: additive `PatchSetReviewPage.tsx` toast dispatch, new
`undoPatchSet` thunk. `helio-mcp`: one new tool. No behavior change for existing callers.

## Non-Goals

- Multi-level / redo history (single-level undo only, per ticket.md).
- Undo of non-patch-set mutations — out of scope per ticket.md.
- Undoing a partially-rolled-back apply (`failure` present) — nothing is journaled for those.
