## ADDED Requirements

### Requirement: A proposed patch set carries a server-minted proposalId

A patch set returned by refinement (`POST /api/refinements` and its continuation turns) and by the assistant's `propose_patch_set` tool
SHALL carry an optional top-level `proposalId`: a fresh UUID minted by the server for that proposal and stored with it
(refinement: the stored working patch set; assistant: the persisted `propose_patch_set` tool result, which the review
hand-off reads in place of any model-written value), so re-opening the same proposal (the refinement drawer, a reloaded
assistant conversation) yields the same id. A `proposalId` supplied by the model SHALL be discarded and replaced, and
SHALL never cause `propose_patch_set` to fail. The patch-set schema SHALL accept `proposalId` as an
optional string; a patch set without it SHALL remain valid.

#### Scenario: Refinement and the assistant mint a proposalId
- **WHEN** refinement returns a patch set, or the assistant's `propose_patch_set` captures one
- **THEN** that patch set carries a UUID `proposalId`, and the stored copy carries the same id

#### Scenario: The assistant hand-off uses the server-minted id after a reload
- **WHEN** an assistant conversation whose `propose_patch_set` call wrote its own `proposalId` is reloaded and its
  proposal is handed off to the review page
- **THEN** the handed-off patch set carries the server-minted `proposalId` from the stored tool result

#### Scenario: A model-supplied proposalId is replaced
- **WHEN** the model emits a patch set that already contains a `proposalId`
- **THEN** the returned patch set carries a different, server-minted `proposalId`

### Requirement: Apply refuses a proposal the caller already applied

When `POST /api/patch-sets/apply` receives a patch set with a `proposalId`, the server SHALL claim that id for the caller
before the first write, and SHALL refuse a later apply of a patch set with the same `proposalId` by
the same caller with HTTP 409, code `PATCH_SET_ALREADY_APPLIED`, applying and journaling nothing. Two concurrent applies
of the same `proposalId` SHALL result in at most one applied. An apply refused before any write (400/403/404/409 stale) or
whose every applied edit rolled back cleanly SHALL release the id; an apply that left any write in place (an
unrecoverable or recreated rollback, an error after a write) SHALL keep it. A `proposalId` that is not a UUID SHALL be rejected with 400. A patch set without a
`proposalId` SHALL be applied exactly as before. Undoing an application SHALL NOT release its `proposalId`: re-applying
requires a new proposal.

#### Scenario: A create-only proposal cannot be applied twice
- **WHEN** a create-only patch set with a `proposalId` is applied successfully and then applied again by the same user
- **THEN** the second apply answers 409 `PATCH_SET_ALREADY_APPLIED` and no second resource is created

#### Scenario: A failed apply does not consume the proposalId
- **WHEN** an apply of a patch set with a `proposalId` is refused as stale or rolls back, and the corrected state is
  applied again with the same `proposalId`
- **THEN** that apply succeeds

#### Scenario: Concurrent applies of one proposal apply once
- **WHEN** two applies of the same create-only patch set with one `proposalId` run concurrently for the same user
- **THEN** exactly one creates its resources and the other answers 409 `PATCH_SET_ALREADY_APPLIED`

#### Scenario: A patch set without proposalId is unaffected
- **WHEN** the same create-only patch set without a `proposalId` is applied twice
- **THEN** both applies succeed exactly as before this change

### Requirement: Review page shows an already-applied proposal as final

The patch-set review page SHALL keep a patch set's `proposalId` when it stamps fingerprints and applies, and on a 409
`PATCH_SET_ALREADY_APPLIED` SHALL show that the proposal was already applied, with no apply or re-preview action that
could submit it again.

#### Scenario: Re-entering an applied proposal
- **WHEN** a user re-enters an already-applied proposal from the refinement drawer or the assistant hand-off and accepts
- **THEN** the page states the proposal was already applied and offers no further apply
