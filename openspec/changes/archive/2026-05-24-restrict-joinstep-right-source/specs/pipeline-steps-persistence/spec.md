## MODIFIED Requirements

### Requirement: POST /api/pipelines/:id/steps appends a new step

The backend SHALL expose `POST /api/pipelines/:id/steps` that accepts `{ type, config }` in the
request body (where `config` is a typed object whose shape is determined by `type`), assigns the
next available position (MAX(position)+1 or 0 if no steps exist), persists the step, and returns
the created step object with `201 Created`. When `type` is `"join"`, the backend SHALL additionally
verify that `config.rightDataSourceId` is owned by the authenticated caller; if the source is
inaccessible, the response SHALL be `404 Not Found` and the step SHALL NOT be persisted.

#### Scenario: First step gets position 0

- **WHEN** `POST /api/pipelines/:id/steps` is called and the pipeline has no existing steps
- **THEN** the created step has `position: 0` and the response is `201 Created`

#### Scenario: Subsequent steps get incrementing positions

- **WHEN** `POST /api/pipelines/:id/steps` is called and the pipeline already has steps
- **THEN** the created step has `position` equal to the current maximum position plus one

#### Scenario: Returns 404 for unknown pipeline

- **WHEN** `POST /api/pipelines/:id/steps` is called with a pipeline id that does not exist
- **THEN** the response is `404 Not Found`

#### Scenario: Returns 400 for invalid type discriminator

- **WHEN** `POST /api/pipelines/:id/steps` is called with a `type` value not in the allowed set
- **THEN** the response is `400 Bad Request`

#### Scenario: Returns 400 for malformed config payload

- **WHEN** `POST /api/pipelines/:id/steps` is called with a `type` whose `config` shape does not parse against the per-subtype schema
- **THEN** the response is `400 Bad Request` with a message identifying the offending subtype

#### Scenario: Returns 404 when join right-source is not caller-owned

- **WHEN** `POST /api/pipelines/:id/steps` is called with `type: "join"` and
  `config.rightDataSourceId` referring to a data source the caller does not own
- **THEN** the response is `404 Not Found`
- **THEN** no step row is inserted
