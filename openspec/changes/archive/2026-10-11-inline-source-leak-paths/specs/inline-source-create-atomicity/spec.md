## ADDED Requirements

### Requirement: Adding an inline root leaves nothing behind on failure
`POST /api/pipelines/:id/roots` with an inline source spec SHALL leave no data source, and no implicit Connector, created by that request when the response is any 4xx or 5xx. The original error SHALL be returned unchanged.

#### Scenario: Root insert fails after the inline source was created
- **WHEN** `POST /api/pipelines/:id/roots` is called with an inline `dataset` root and the root insert fails after the inline source was created
- **THEN** the response is the same error status and message as before this change
- **THEN** the count of `data_sources` rows owned by the caller is unchanged from before the request

#### Scenario: Bare-url REST inline root fails after creation
- **WHEN** `POST /api/pipelines/:id/roots` is called with an inline `rest_api` root given as a bare `url` and a step after the source's creation fails
- **THEN** the counts of `data_sources` and `connectors` rows owned by the caller are unchanged from before the request

### Requirement: Compensating an inline REST root also removes its implicit Connector
Wherever a call deletes an inline `rest_api` source it created from a bare `url` (single-call pipeline create, add root, patch-set mid-set rollback, and pipeline-proposal apply's own failure cleanup), it SHALL also delete the implicit Connector that creation made, together with its credential row. A Connector still referenced by any other source SHALL NOT be deleted; that refusal SHALL be logged and SHALL NOT replace the original error.

#### Scenario: Single-call create fails after a bare-url REST inline root was created
- **WHEN** `POST /api/pipelines` is called with an inline bare-`url` `rest_api` root and fails after the root's source was created
- **THEN** the counts of `data_sources` and `connectors` rows owned by the caller are unchanged from before the request

#### Scenario: An explicitly-referenced Connector is never removed
- **WHEN** an inline `rest_api` root names an existing `connectorId` and the call is compensated
- **THEN** the inline source is deleted and the named Connector still exists

### Requirement: Source creation leaves no row behind when it fails after its insert
`SourceService.createSql` and `SourceService.createRest` SHALL delete the data source row they inserted, and any implicit Connector `createRest` created, when a step after the insert fails, and SHALL then surface the original failure unchanged. A bare-`url` `createRest` whose source insert fails SHALL delete the implicit Connector it created. A schema-fetch error reported as `fetchError` is a success, not a failure: the source is kept.

#### Scenario: Schema write fails after the insert via POST /api/sources
- **WHEN** `POST /api/sources` creates a SQL source, or a REST source naming a `connectorId`, and the post-insert schema write fails
- **THEN** the response is the same error as before this change
- **THEN** the count of `data_sources` rows owned by the caller is unchanged from before the request

#### Scenario: Bare-url createRest fails after its Connector was created
- **WHEN** `SourceService.createRest` is called with a bare `url` (an internal caller: `POST /api/sources` rejects a bare `url` with 400, HEL-828) and a step after `connectorRepo.create` fails
- **THEN** the original failure is surfaced and the counts of `data_sources` and `connectors` rows owned by the caller are unchanged

#### Scenario: Fetch error still keeps the source
- **WHEN** `POST /api/sources` creates a REST or SQL source whose schema fetch returns an error
- **THEN** the response is a success carrying `fetchError` and the source exists

### Requirement: Patch-set rollback reports roots it cannot line up
When patch-set mid-set rollback of a pipeline-create edit finds that the created pipeline's root count differs from the request's, it SHALL log a warning, delete no source, and report the edit `unrecoverable`. When the counts match but an inline request root's created root carries no data source id, it SHALL log a warning, delete the other inline sources, and report the edit `unrecoverable`. When the pipeline delete itself fails, no source delete SHALL be attempted and the edit SHALL be `unrecoverable`.

#### Scenario: Root counts differ during rollback
- **WHEN** a pipeline-create edit with an inline root is rolled back mid-set and the forward summary's root count differs from the request's
- **THEN** a warning is logged, no data source is deleted, and the edit is reported `unrecoverable`

#### Scenario: Pipeline delete fails during rollback
- **WHEN** a pipeline-create edit with an inline root is rolled back mid-set and the pipeline delete fails
- **THEN** the edit is reported `unrecoverable` and no source delete is attempted
