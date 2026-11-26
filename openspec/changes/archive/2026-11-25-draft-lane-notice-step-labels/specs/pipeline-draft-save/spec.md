## ADDED Requirements

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
