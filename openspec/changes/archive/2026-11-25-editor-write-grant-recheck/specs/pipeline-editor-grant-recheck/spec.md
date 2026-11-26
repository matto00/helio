## ADDED Requirements

### Requirement: Output create and the Output backfill re-check access inside the write
`POST /api/pipelines/:id/outputs` SHALL, inside the transaction that inserts the Output and after the pipeline row is
locked, confirm the caller is still the pipeline owner or holds an `editor` grant. When the check fails nothing SHALL
be written and the response SHALL be the one the route's own access check gives: `403` for a remaining `viewer` grant,
`404` with the unknown-pipeline body for no grant. The backfill that follows an Output create or update SHALL confirm the
same access for the acting user before it evaluates the pipeline and again inside the transaction that writes the node
snapshot; a refused backfill SHALL write no snapshot rows and no Output schema. When the checks pass, behaviour SHALL
be unchanged.

#### Scenario: Editor grant revoked between the create check and the insert
- **WHEN** user B, an `editor` of user A's pipeline P, creates an Output, and B's grant is deleted after the request's
  access check passed but before the insert transaction locked P
- **THEN** the response is the `404` an absent pipeline gets, and no Output row exists for the request

#### Scenario: Editor downgraded to viewer between the create check and the insert
- **WHEN** B's grant is changed to `viewer` in the same window
- **THEN** the response is `403` and no Output row exists for the request

#### Scenario: Grant revoked before the backfill writes
- **WHEN** B creates an Output on a pipeline that has a successful run, and B's grant is revoked or downgraded to
  `viewer` after the create succeeded but before the backfill writes the node snapshot
- **THEN** no snapshot rows and no Output schema are written by that backfill

#### Scenario: Owner and current editor are unaffected
- **WHEN** the owner, or an `editor` whose grant is unchanged, creates an Output
- **THEN** the Output is created and backfilled as before
