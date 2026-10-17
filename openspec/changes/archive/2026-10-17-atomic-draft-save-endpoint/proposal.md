## Why

Save & run in the live draft editor (HEL-1631) needs one call that persists a whole draft atomically and refuses to
overwrite concurrent changes. Today's step writes are separate transactions, patch-set apply compensates instead of
rolling back, and the stale-base lock protocol in `docs/live-draft-preview.md` §8.3 has never been verified.

## What Changes

- New `POST /api/pipelines/:id/draft/save`: declarative final step tree and Outputs, diffed and applied in ONE
  transaction (creates, updates, deletes with cascade, re-parenting, trunk reorder, Output create/edit/delete).
- Stale-base check: `GET /api/pipelines/:id` gains `fingerprint`; the save recomputes it in-transaction under the
  verified lock protocol and returns 409 `PATCH_SET_STALE` on mismatch. No overwrite path.
- A verified pipeline-definition lock protocol (G1-G3), applied to the save and to every writer of fingerprinted state
  that the race specs prove needs it, documented with its evidence.
- `DBIO` variants of step update/delete/reorder; the `Future` methods wrap them.
- One `pipelineDefinition` journal row per save; `/api/patch-sets/:id/undo` dispatches on it and re-applies the prior
  definition through the same transaction, refusing per the `refuse-dependent-restore-rest` ruling.
- Optional run after save through the unchanged HEL-505 guard; a rejection is `200` with `run.started: false`.
- Schemas, frontend types and a seam test.

## Capabilities

### New Capabilities
- `pipeline-draft-save`: the atomic bulk save endpoint, its contract, validation, cascade confirmation, run-after-save.
- `pipeline-definition-lock-protocol`: the verified lock order and stale-base guarantee G1-G3.

### Modified Capabilities
- `patch-set-undo`: undo dispatches on a `pipelineDefinition` journal row.

## Impact

Backend pipelines/patchsets services and repositories, `PanelRowLocks` callers, schemas, frontend pipeline types.
A migration only if the protocol needs one.

## Non-goals

- Draft UI, Discard, removal of per-edit PATCH (HEL-1631); draft Output render (HEL-1632); draft-preview endpoint (d).
- Any force-overwrite on a stale base. Root, name, tag or schedule edits through the save.
- Restoring panels/alert rules on undo (refused by ruling). Changing HEL-505 guard semantics.
