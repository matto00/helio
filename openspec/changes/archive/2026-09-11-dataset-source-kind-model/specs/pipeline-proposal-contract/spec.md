## MODIFIED Requirements

### Requirement: Roots are existing references or inline specs
The schema SHALL define `roots` as a non-empty ordered array. Each element SHALL support two forms:
a reference to an existing data source via `sourceId`, or an inline new-source spec via `type` (one
of `csv`, `rest_api`, `sql`, `static`, `dataset`), `name`, and a per-type `config` object — the same
element shape the singular `source` object used, so a root is not a second source vocabulary.
`"static"` and `"dataset"` SHALL be accepted as equivalent inline-source discriminators (HEL-1073's
write-side alias). The schema SHALL NOT require that exactly one form is used per element; resolving
which branch wins when both are present is an apply-time concern outside this contract. Each element
MAY carry a request-scoped `clientId` that a parentless step's `rootClientId` names.

#### Scenario: Existing-source form validates
- **WHEN** a `roots` element supplies only `sourceId`
- **THEN** the document validates

#### Scenario: Inline-source form validates
- **WHEN** a `roots` element supplies `type: "sql"`, a `name`, and a `config` object
- **THEN** the document validates

#### Scenario: Inline dataset source validates via either discriminator
- **WHEN** a `roots` element supplies `type: "static"` or `type: "dataset"`, a `name`, and a `config`
  object
- **THEN** the document validates in both cases

#### Scenario: A two-root proposal validates
- **WHEN** a proposal carries one existing-source root and one inline-source root
- **THEN** the document validates and no root is treated as primary

#### Scenario: An empty roots array is rejected
- **WHEN** a proposal carries `roots: []`
- **THEN** the document fails validation
