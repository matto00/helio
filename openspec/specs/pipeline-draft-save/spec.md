# pipeline-draft-save Specification

## Purpose
Persist a whole client-side pipeline draft (steps, topology, order, Outputs) in one database transaction, refusing a
stale base, and optionally start a run through the unchanged HEL-505 guard.

## Requirements

### Requirement: Atomic declarative draft save
`POST /api/pipelines/:id/draft/save` SHALL accept `{baseFingerprint, steps[], outputs[], roots?, runAfterSave?,
confirmCascade?}` describing the final step tree, Outputs and (when present) roots, and SHALL apply every create, update,
delete (with its cascade), re-parent, trunk reorder, Output create/update/delete and root add/remove (see "Draft save
accepts the final roots") in a single database transaction.

#### Scenario: Whole draft commits together
- **WHEN** an owner or editor saves a draft that creates, updates, deletes and reorders steps and edits an Output
- **THEN** the response is 200 and the stored definition equals the draft, with a new `fingerprint`

#### Scenario: Fault mid-chain leaves nothing
- **WHEN** a failure is injected after some writes of the chain and before commit
- **THEN** the stored definition and its fingerprint are byte-identical to before the request and no journal row exists

#### Scenario: Validation failure rolls back
- **WHEN** a step fails `rawConfigProblem`, a cross-owner secondary ref, the upsert target check, a lane cycle or a
  pipeline cycle
- **THEN** the response is 400 naming the step and nothing is written

### Requirement: Stale base is refused without an overwrite path
The save SHALL recompute the `pipeline` fingerprint inside its transaction, after taking the verified locks, and SHALL
return 409 with the `PATCH_SET_STALE` body (`stale[0].kind = "pipeline"`) and write nothing when it differs from
`baseFingerprint`. No request field SHALL bypass this check.

#### Scenario: Concurrent change makes the base stale
- **WHEN** another writer changes any fingerprinted state after the client read its fingerprint
- **THEN** the save returns 409 `PATCH_SET_STALE` and the other writer's change is intact

### Requirement: Pipeline read exposes the fingerprint
`GET /api/pipelines/:id` SHALL return `fingerprint`, computed by the same implementation the save and patch-set
preview use.

#### Scenario: Read-then-save round trip
- **WHEN** a client reads the pipeline and saves an unchanged definition with that fingerprint
- **THEN** the save succeeds

### Requirement: Cascade confirmation
A save that removes steps, Outputs, bound panels or targeting alert rules SHALL return 422 listing that impact unless
`confirmCascade` covers every item, with the impact computed under the save's locks.

#### Scenario: Unconfirmed cascade
- **WHEN** the draft drops a step whose Output has a bound panel and `confirmCascade` omits that panel
- **THEN** the response is 422 listing the panel and nothing is written

### Requirement: Access control
The save SHALL require owner or editor access (viewer 403, invisible 404), stamp created rows with the pipeline owner,
write one audit row and one journal row owned by the acting user.

#### Scenario: Editor saves a shared pipeline
- **WHEN** an editor grantee saves on a role without BYPASSRLS
- **THEN** created steps and Outputs are owned by the pipeline owner and the journal row is visible only to the editor

### Requirement: Run after save never rolls the save back
With `runAfterSave` set, the server SHALL commit the save first and then call `PipelineRunService.submit` unchanged;
a guard rejection SHALL return 200 with `run: {started: false, code: 429, retryAfterSeconds, reason}`.

#### Scenario: Rate-limited run after a save
- **WHEN** the owner's run rate limit is exhausted and a save requests `runAfterSave: "run"`
- **THEN** the response is 200, `run.started` is false with `retryAfterSeconds`, and the saved definition persists

### Requirement: A draft Output edit is validated like an Output PATCH
`POST /api/pipelines/:id/draft/save` SHALL validate an edited Output's config as a change against its stored config, with the same tolerance rule as `PATCH /api/outputs/:id`: a key re-sent with the value already stored SHALL be accepted, including a stored legacy key, and only what the draft introduces or changes SHALL be judged. A restore of a journaled definition (undo) SHALL validate a restored or recreated Output's config with the restore policy patch-set rollback uses. A created Output in a public save SHALL be validated as today.

#### Scenario: Rename an Output carrying a legacy key
- **WHEN** a draft renames an Output whose stored config holds the legacy key `metricLabel`, and keeps its config
- **THEN** the save succeeds and the Output has the new name and its stored config

#### Scenario: A new unknown key is still refused
- **WHEN** a draft edit adds an unknown key to that Output's config
- **THEN** the response is 400 naming the key and nothing is written

#### Scenario: Undo recreates an Output carrying a legacy key
- **WHEN** a draft save removed an Output (with no bound panel or alert rule) whose stored config held a legacy key, and the user undoes it
- **THEN** the Output is recreated under its id with that config

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

### Requirement: A draft-save refusal names steps by the keys the client sent
Every `400` message from `POST /api/pipelines/:id/draft/save` that names a step SHALL name it by its draft key: the
`clientId` the request gave a step the save creates, and the stored id of an existing step. This applies to the
subject step and to any other named step, such as a lane target. No such message SHALL contain an id the server
generated during that save.

#### Scenario: Lane cycle introduced by a created step
- **WHEN** a draft creates a step with clientId `draft-new` whose lane reference names an existing step that would be
  its descendant, and the draft is saved
- **THEN** the response is `400`, and its message names the created step as `draft-new` and the target by its stored
  id
- **THEN** the message contains no other step id, and nothing is written

#### Scenario: Dangling lane target with a created subject
- **WHEN** a draft creates a step with clientId `draft-new` whose lane reference names a stored step that the same
  draft removes, and the draft is saved
- **THEN** the response is `400` naming the created step as `draft-new` and the target by the id the client sent,
  and nothing is written

#### Scenario: Lane cycle between existing steps
- **WHEN** a draft's structural edit leaves an existing step's lane reference naming its own descendant
- **THEN** the response is `400` naming both steps by their stored ids, and nothing is written
