## ADDED Requirements

### Requirement: Draft save accepts the final roots
`POST /api/pipelines/:id/draft/save` SHALL accept an optional `roots` array holding the FINAL roots of the draft. Each
item SHALL carry exactly one of `id` (a root of this pipeline) or `clientId` (a new root) and, for a new root, a
`sourceId`. When `roots` is absent the stored roots SHALL be left unchanged. A stored root the array omits SHALL be
removed together with every step under it, every Output on it or on those steps, and their node snapshots, in the same
transaction as the rest of the save. Each root's final position SHALL be its index in the array; in a public save
the surviving roots SHALL keep their stored relative order and new roots SHALL follow every survivor. Steps and
Outputs SHALL be able to name a new root by `rootClientId`. The save SHALL refuse with 400 and write nothing when: the
final roots are empty; an `id` is not a root of this pipeline (outside an undo restore); a `clientId` or `id` repeats;
an item carries both or neither of `id`/`clientId`; a new root lacks `sourceId`; the surviving roots are not in their
stored relative order; a new root precedes a survivor; or a
surviving item carries `sourceId`. A new root's source SHALL be owned by the caller, else 404
`Data source not found` with nothing written. A root add that would create a pipeline read/write cycle SHALL be a 400
naming the cycle, with nothing written.

#### Scenario: Add a root and a step on it atomically
- **WHEN** the owner saves a draft whose `roots` adds a new root on a source they own and whose steps include a step
  with `rootClientId` naming it
- **THEN** the response is 200, the pipeline has the new root last, the step is stored under it, and one journal row and
  one audit row are written

#### Scenario: Remove a root and its subtree atomically
- **WHEN** an editor saves a draft that omits one of two roots, confirms the cascade, and omits that root's steps
- **THEN** the root, its steps, the Outputs on it, and their node snapshots are gone and the remaining root is at
  position 0

#### Scenario: Replace the only root
- **WHEN** a draft on a single-root pipeline omits that root and adds a new one, confirming the cascade
- **THEN** the response is 200 and the pipeline has exactly the new root at position 0

#### Scenario: Remove the first root and add one
- **WHEN** a draft on roots `[A, B]` omits A and adds C, confirming the cascade
- **THEN** the response is 200 and the roots are `[B, C]` at positions 0 and 1

#### Scenario: Added source deleted before the save locks it
- **WHEN** an added root's source is deleted after the save's pre-transaction checks and before its source lock
- **THEN** the response is 404 `Data source not found` and nothing is written

#### Scenario: Absent roots keep today's behaviour
- **WHEN** a draft save carries no `roots` field
- **THEN** the stored roots are unchanged and the save behaves exactly as before

#### Scenario: A foreign source is refused
- **WHEN** an editor's draft adds a root on a source owned by another user
- **THEN** the response is 404 and nothing is written

#### Scenario: Removing every root is refused
- **WHEN** a draft's `roots` is empty
- **THEN** the response is 400 and nothing is written

### Requirement: Root removal is part of the confirmed cascade
The cascade confirmation and the 422 `CASCADE_CONFIRMATION_REQUIRED` impact SHALL carry `rootIds`. A public save that
removes a root not listed in `confirmCascade.rootIds`, or any step, Output, panel or alert rule the removal takes that
the confirmation does not list, SHALL answer 422 with nothing written.

#### Scenario: Unconfirmed root removal
- **WHEN** a draft omits a root but `confirmCascade` does not list it
- **THEN** the response is 422 with `impact.rootIds` naming the root, and nothing is written

### Requirement: Saved definition returns roots and the fingerprint covers them
The save response's `definition` SHALL include `roots` (id, data source id and name, in position order). The pipeline
fingerprint SHALL change when a root is added or removed, so a draft based on the pre-change fingerprint SHALL get the
409 `PATCH_SET_STALE` reply with nothing written.

#### Scenario: Stale base after another tab adds a root
- **WHEN** a root is added through `POST /api/pipelines/:id/roots` after the client read its base fingerprint
- **THEN** a draft save with that base fingerprint answers 409 `PATCH_SET_STALE` and writes nothing

### Requirement: Undo restores the prior roots
Undoing a draft save SHALL restore the roots the save replaced: a removed root SHALL come back under its original id
and source with the steps and Outputs the save removed, and a root the save added SHALL be removed. The undo SHALL be
refused with 409 and change nothing when a source a removed root used no longer exists, or when the restore would
delete a panel or alert rule.

#### Scenario: Undo a root removal
- **WHEN** a save removed the root at position 0 of two, whose Outputs had no panels or alert rules, and the user undoes it
- **THEN** the root is back at position 0, it and its steps and Outputs carry their original ids, and the fingerprint
  equals the pre-save one

#### Scenario: Undo a root add
- **WHEN** a save added a root and the user undoes it
- **THEN** the added root and the steps under it are gone

### Requirement: Draft roots are sampled through the existing owner path
`GET /api/data-sources/:id/sample?pipelineId=P` SHALL serve a caller the sample of a source they own whether or not it
is a root of P, so a draft root has preview frames; it SHALL NOT serve a source the caller neither owns nor P uses.

#### Scenario: Editor samples their own draft-root source
- **WHEN** an editor of P requests the sample of a source they own that is not yet a root of P
- **THEN** the response is 200
