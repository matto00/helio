## ADDED Requirements

### Requirement: Analyze judges a pipeline by its definition for every admitted caller

For every caller `GET /api/pipelines/:id/analyze` admits (owner, editor grantee, viewer grantee), the response's `costVerdict` and each step's `validationError` SHALL be computed from the pipeline's root data sources as the pipeline owner sees them (real source kind, the owner's root schema), not from the caller's own ownership. A root the caller does not own SHALL NOT be reported as `unclassified-source`, and a step valid for the owner SHALL NOT carry a `validationError` or a `step-config-invalid` reason for a grantee. `costVerdict.reasons` codes and `autoRunnable` SHALL equal the owner's for the same pipeline; for a non-owner, `estimatedRows` SHALL be the pipeline's last-run row count, or absent when there is no last run; `canRun` keeps its permission semantics (false for a viewer, otherwise equal to the owner's). A caller with no access SHALL still receive `404`.

#### Scenario: Editor on a pipeline whose CSV root they do not own
- **WHEN** an editor grantee requests analyze for a pipeline whose root is a CSV source owned by the pipeline owner
- **THEN** `costVerdict.reasons` contains no `unclassified-source` entry, and the reason codes, `autoRunnable` and `canRun` equal the owner's

#### Scenario: Grantee on a never-run dataset pipeline gets no row estimate
- **WHEN** an editor or viewer grantee requests analyze for a never-run pipeline whose root is a dataset with rows
- **THEN** `costVerdict.estimatedRows` is absent, while the owner's equals the dataset's row count

#### Scenario: Grantee on a valid pipeline with a compute step that names a root column
- **WHEN** an editor or viewer grantee requests analyze for a pipeline whose compute step references a column of a root they do not own, and the step is valid for the owner
- **THEN** no step carries a `validationError`, there is no `step-config-invalid` reason, and an editor's `canRun` is true

#### Scenario: Viewer gets the owner's reason codes with canRun false
- **WHEN** a viewer grantee requests analyze for the same pipeline
- **THEN** the reason codes and `autoRunnable` equal the owner's and `canRun` is false

#### Scenario: Stranger still gets 404
- **WHEN** a signed-in user with no grant requests analyze for the pipeline
- **THEN** the response is `404`

### Requirement: Analyze sends a grantee no new source detail

The change SHALL NOT add data about a source to a non-owner's analyze response. `sourceSchemas`, every step's input and output schema, and `warnings` SHALL be computed exactly as before (from the caller's own view). For a non-owner caller, every cost reason produced by the cost estimator SHALL carry a fixed neutral `detail` per code that names no source kind, URL-backedness or count; owners SHALL receive the existing `detail` unchanged. A `step-config-invalid` reason's `detail` and a step's `validationError` SHALL name nothing (column, type, source) the non-owner does not already receive from the step's own configuration. The response's wire shape SHALL be unchanged.

#### Scenario: Grantee response fields outside the verdict are unchanged
- **WHEN** a grantee's analyze response is compared with the response the same grantee received before this change
- **THEN** `sourceSchemas`, step schemas and `warnings` are identical

#### Scenario: Grantee reason detail is neutral
- **WHEN** a viewer grantee requests analyze for a pipeline with a SQL or URL-backed root, or a dataset root above the row threshold
- **THEN** each estimator reason's `detail` contains no source kind, no URL wording and no digits, while the owner's `detail` is unchanged

### Requirement: Analyze and the auto-run trigger agree for a grantee

For an editor grantee, the auto-run trigger's evaluation of a dataset write SHALL reach the same eligibility as analyze reports to that editor, for every pipeline whose steps are valid for the owner and for every pipeline the trigger's schema-independent config gate rejects. Where analyze's schema-aware validation is stricter than the trigger's config gate, the difference SHALL be the same for owner and grantee.

#### Scenario: Editor dataset write on a valid compute pipeline
- **WHEN** an editor writes to a dataset feeding a valid pipeline with a compute step over a root they do not own
- **THEN** the trigger evaluates the pipeline as eligible with the same estimator reason codes analyze reports to that editor
