## ADDED Requirements

### Requirement: DELETE /api/outputs/:id requires current pipeline edit access
`DELETE /api/outputs/:id` SHALL, in addition to the existing creator-only rule, require the caller to be the parent
pipeline's owner or a current `editor` grantee at the time of the delete. A caller failing either rule SHALL get
`404 Output not found` and nothing SHALL be deleted. `PATCH /api/outputs/:id` is unchanged.

#### Scenario: Creator who lost edit access gets 404
- **WHEN** the Output's creator holds only a `viewer` grant on the pipeline, or none, and calls `DELETE`
- **THEN** the response is `404 Output not found` and the Output and its placements remain

#### Scenario: Non-owner grantee still gets 404
- **WHEN** an `editor` grantee who did not create the Output calls `DELETE /api/outputs/:id`
- **THEN** the response is `404 Output not found`, as before
