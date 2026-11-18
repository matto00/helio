## Why

Adding or removing a pipeline source (a root) is blocked while a draft is open ("Save or discard your draft first",
HEL-1631). The atomic draft save (HEL-1629) took root edits out of scope, so a user who wants a second source must throw
their draft away first. HEL-1684 split this out (owner ruling split-as-proposed); the backend half gets its own gate.

## What Changes

- `POST /api/pipelines/:id/draft/save` accepts an optional `roots` list: the FINAL roots of the draft. A root keeps
  its `id`, or is new with a `clientId` and a `sourceId` the caller owns. A stored root the list omits is removed, with
  its steps, Outputs and node snapshots, in the same transaction. Steps and Outputs may name a new root by
  `rootClientId`. Absent `roots` keeps today's behaviour exactly.
- The save's cascade confirmation and 422 impact gain `rootIds`.
- The save response's `definition` gains `roots`, so the client sees the saved roots without a refetch.
- The verified lock protocol (order O*) covers root writes made by the save: the added sources' rows `FOR KEY SHARE`
  first, the cycle advisory lock when a root is added, then the existing order.
- The undo journal restores the prior roots under their original ids (and removes roots the save added).
- The roots are already part of the pipeline fingerprint; this change pins that with tests and keeps the post-save
  fingerprint covering the new roots. Draft-root sample access needs no new grant: a draft root is always a source the
  caller owns, which the sample endpoint already serves; this change pins that with a test.
- Client: the draft model records root add and remove as ops; Save & run sends them; Discard drops them; the kept
  draft and the stale-base path carry them; the draft preview samples and evaluates draft roots. Desktop and phone.

## Non-goals

- Reordering roots (no endpoint does it today).
- Drafting source creation: a source created from the add-source modal is created at once and stays in the library on
  Discard, as it does today outside a draft.
- Inline (type-carrying) root specs in the save body. The body takes an existing `sourceId` only.
- Widening who may read a source sample.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pipeline-draft-save`: the save accepts final roots, confirms root removal, returns roots, and undo restores roots.
- `pipeline-definition-lock-protocol`: root writes inside the save follow order O*.
- `pipeline-draft-mode-ui`: add source and remove source are draft actions instead of blocked ones.

## Impact

Backend `services/pipelines/draft/*`, `PipelineDraftWrites`, `DraftSaveProtocol`, `schemas/pipelines/draft-save-*`.
Frontend `state/draftOps.ts`, `state/pipelineDraft.ts`, `state/keptDraft.ts`, `types/draftSave.ts`, the draft save and
frames hooks, spine and mobile source cards. No migration expected (if one is needed it is V143).
