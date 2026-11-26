## MODIFIED Requirements

### Requirement: DELETE /api/outputs/:id requires current pipeline edit access
`DELETE /api/outputs/:id` SHALL, in addition to the existing creator-only rule, require the caller to be the parent
pipeline's owner or a current `editor` grantee at the time of the delete. A caller failing either rule SHALL get
`404 Output not found` and nothing SHALL be deleted. `PATCH /api/outputs/:id` applies the same rule (see "PATCH
/api/outputs/:id requires current pipeline edit access").

#### Scenario: Creator who lost edit access gets 404
- **WHEN** the Output's creator holds only a `viewer` grant on the pipeline, or none, and calls `DELETE`
- **THEN** the response is `404 Output not found` and the Output and its placements remain

#### Scenario: Non-owner grantee still gets 404
- **WHEN** an `editor` grantee who did not create the Output calls `DELETE /api/outputs/:id`
- **THEN** the response is `404 Output not found`, as before

## ADDED Requirements

### Requirement: PATCH /api/outputs/:id requires current pipeline edit access
`PATCH /api/outputs/:id` (including an empty body) SHALL write only when the caller created the Output AND is, inside
the write's transaction, the parent pipeline's owner or a current `editor` grantee. A caller failing either rule SHALL
get `404 Output not found` and nothing SHALL be written. A patch-set edit that updates an Output, and the rollback of such
an edit, SHALL apply the same rule. No caller SHALL gain the right to edit an Output they did not create.

#### Scenario: Creator downgraded to viewer cannot edit their Output
- **WHEN** user B created Output O on A's pipeline P as an editor, B's grant is now `viewer`, and B calls
  `PATCH /api/outputs/O` with a new name
- **THEN** the response is `404 Output not found` and O's name and config are unchanged

#### Scenario: Grant revoked or downgraded between the read and the write
- **WHEN** B, the creator and a current `editor`, sends a PATCH and B's grant is revoked or downgraded to `viewer`
  after the request's read of the Output but before its update
- **THEN** the response is `404 Output not found` and nothing is written

#### Scenario: Owner and current editor still edit their own Output
- **WHEN** the pipeline owner, or a current `editor`, patches an Output they created
- **THEN** the response is `200` with the updated Output, as before
