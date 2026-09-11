## MODIFIED Requirements

### Requirement: Structural pre-validation creates nothing on a bad proposal
Before any resource is created, the service SHALL validate **every element of `roots`
independently**, rejecting: a root that sets both `sourceId` and an inline `type`; a root that sets
neither; an inline `type` outside `csv`/`rest_api`/`sql`/`static`/`dataset` (`static` and `dataset`
are accepted as equivalent — HEL-1073's write-side alias); an inline root whose `name` is absent or
blank; an inline root whose type-matched `config` field is absent; an inline `sql` root whose query
is not read-only; an empty `roots` array; and any step whose `type` is not a recognized pipeline step
kind or whose `config` does not decode for that kind. A rejection SHALL name the offending root by
its request position, so a fault in the second root is not reported against the first. Every
rejection SHALL create no source, pipeline, root, step, or Output row.

#### Scenario: Non-SELECT SQL is rejected creating nothing
- **WHEN** a caller POSTs a proposal with an inline `sql` root whose query contains a DDL/DML keyword
- **THEN** the response is a `4xx` error, the SQL guardrail message is surfaced verbatim, and no source,
  pipeline, or Output exists that did not exist before the call

#### Scenario: Both sourceId and inline type set is rejected
- **WHEN** a caller POSTs a proposal whose root sets both `sourceId` and `type`
- **THEN** the response is a `400 Bad Request` and nothing is created

#### Scenario: Inline csv is rejected with a clear error, not a 500
- **WHEN** a caller POSTs a proposal with an inline `csv` root
- **THEN** the response is a structured `4xx` error stating inline CSV is not yet supported, and
  nothing is created

#### Scenario: Inline source missing a name is rejected creating nothing
- **WHEN** a caller POSTs a proposal whose root sets an inline `type` (e.g. `sql` or `rest_api`) but
  omits `name`
- **THEN** the response is a `400 Bad Request` and nothing is created

#### Scenario: Inline source missing its type-matched config is rejected creating nothing
- **WHEN** a caller POSTs a proposal whose root sets an inline `type` of `sql` or `rest_api` but
  omits the matching `config` object
- **THEN** the response is a `400 Bad Request` and nothing is created — no unhandled server error and no
  source row is created

#### Scenario: An empty roots array is rejected creating nothing
- **WHEN** a caller POSTs a proposal whose `roots` array is empty
- **THEN** the response is a `400 Bad Request` and nothing is created

#### Scenario: A fault in the second root is reported against that root
- **WHEN** a caller POSTs a proposal whose first root is valid and whose second root sets neither
  `sourceId` nor `type`
- **THEN** the response is a `400 Bad Request` naming the second root's request position, and nothing
  is created

#### Scenario: Inline dataset root is accepted via either discriminator
- **WHEN** a caller POSTs a proposal with an inline root whose `type` is `"static"`, and separately
  one whose `type` is `"dataset"`, both with a valid `name` and `config`
- **THEN** both are accepted identically and neither is rejected as an unrecognized inline `type`
