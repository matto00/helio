## MODIFIED Requirements

### Requirement: Panel kind discriminates placement from content
The system SHALL persist `panels.kind` as one of `output | text | markdown |
image | divider | form`, non-null.

`form` joins the set in the form-panel change. It is neither a placement of an Output nor
purely dashboard-native content: it binds to a `dataset` data source and writes to it. The
prior placement-versus-content dichotomy therefore gains a third category, and a consumer
MUST NOT infer "carries no binding" from "is not `output`" — `form` carries a source binding.
The database CHECK constraint on `panels.kind` SHALL admit `form`; without that widening a
`form` panel cannot be inserted at all.

#### Scenario: Existing panels are backfilled from their prior type
- **WHEN** the migration backfills `panels.kind` for every existing panel from
  its prior `type` column
- **THEN** every panel ends up with a valid, non-null `kind`

#### Scenario: A form panel persists its kind
- **WHEN** a `form` panel is created
- **THEN** its row persists `kind = 'form'` and the kind CHECK constraint admits it
