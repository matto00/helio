## ADDED Requirements

### Requirement: A manual refresh re-checks the requester's access when the render starts
A render started by `POST /api/outputs/:id/insight/refresh` (trigger `manual` or `pin`) SHALL, before it writes any
attempt row, charges any quota or sends anything to the model, confirm the requester is still the pipeline owner or an
`editor` grantee. When the check fails the render SHALL stop: no attempt row is written, no quota is charged and
nothing is sent. The `202` response SHALL be unchanged. A render that passed the check and reached the model keeps its
row. Renders started by a run, the daily schedule or the catch-up pass SHALL NOT be affected.

#### Scenario: Editor grant revoked between admission and render start
- **WHEN** an `editor` grantee posts a refresh, the request is admitted (`202`), and the grant is revoked or
  downgraded to `viewer` before the render starts
- **THEN** no `output_insights` row is written for that render, the pipeline owner's usage counter is unchanged, and
  the model transport records zero sends

#### Scenario: Owner and current editor are unaffected
- **WHEN** the owner, or an `editor` whose grant is unchanged, posts a refresh
- **THEN** the render proceeds and records its attempt as before
