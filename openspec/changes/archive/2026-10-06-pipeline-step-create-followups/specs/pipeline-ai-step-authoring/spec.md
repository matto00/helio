## ADDED Requirements

### Requirement: An in-flight draft's field picker keeps showing its chosen field

While a completed draft AI step's create request is in flight, the step still has no server-side row and no
analyze-derived schema of its own. The editor SHALL keep resolving the draft's field picker(s) from the schema flowing
into its actual anchor, exactly as before the create was sent, so a field picker whose value is already chosen shows
that value rather than its empty placeholder.

#### Scenario: The input-field select shows the chosen field during the create
- **WHEN** a user completes a draft AI step's config by choosing an input field, and the create request has been sent
  but has not yet resolved
- **THEN** the draft's input-field select shows the chosen field, not the placeholder

#### Scenario: The select still shows the chosen field after the create, before re-analysis
- **WHEN** that create request then succeeds, and the created step's own schema has not yet been analyzed
- **THEN** the step's input-field select still shows the chosen field
