## ADDED Requirements

### Requirement: Pipeline editor registers the cast op type with correct seed config
The pipeline editor's `OP_TYPES` registry SHALL include an entry for `"cast"` with a seed config of
`'{"casts":{}}'`. When a new cast step is created, the step config SHALL be initialized to
`'{"casts":{}}'`. When a cast step card is expanded, the editor SHALL render the `CastFieldsConfig`
component.

#### Scenario: New cast step is seeded with casts map config
- **WHEN** the user adds a new step with `op: "cast"`
- **THEN** the initial persisted config is `{"casts":{}}`

#### Scenario: Cast step card renders CastFieldsConfig component
- **WHEN** a pipeline step with `op: "cast"` has its card expanded
- **THEN** the `CastFieldsConfig` component is rendered in the step-card body
