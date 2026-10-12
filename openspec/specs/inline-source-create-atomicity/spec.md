# inline-source-create-atomicity Specification

## Purpose
Calls that create a data source, directly or as an inline pipeline root, leave no data source or implicit "Auto:" Connector behind when they fail after creating it.

## Requirements

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
- **WHEN** an inline `rest_api` root names an existing user-created (or adopted) `connectorId` and the call is compensated
- **THEN** the inline source is deleted and the named Connector still exists

#### Scenario: An explicitly-referenced unadopted auto-created Connector follows the source-delete rule
- **WHEN** an inline `rest_api` root names an existing auto-created `Auto: `-named `connectorId` that no other source references, and the call is compensated
- **THEN** the inline source is deleted and the Connector is removed exactly as a user source delete would remove it

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

### Requirement: Every implicit-Connector cleanup applies the single auto-created rule
Every path that removes the implicit Connector of a bare-`url` REST source it created or is deleting (source-create failure cleanup, inline-root compensation, and patch-set undo of a pipeline create) SHALL apply the same rule as a user source delete: the Connector is removed if and only if its server-owned `implicit` flag is `true`, its name still starts with `Auto: `, no data source references it, and it is owned by the acting user. A failure SHALL be logged with identifiers, the exception class and the SQLSTATE only, never with an exception message, Connector config or credential value, and SHALL NOT replace the original outcome.

#### Scenario: A renamed inline source's Auto Connector is still removed on compensation
- **WHEN** a bare-`url` REST inline source was renamed and is then compensated or removed by undo
- **THEN** its still-`Auto: `-named implicit Connector and credential row no longer exist

#### Scenario: An adopted Connector survives undo
- **WHEN** the implicit Connector was renamed so its name no longer starts with `Auto: `, and the pipeline create is undone
- **THEN** the inline source is removed and the Connector and its credential still exist

#### Scenario: A shared Auto Connector survives until its last source is gone
- **WHEN** another source references the implicit Connector and the pipeline create is undone
- **THEN** the inline source is removed and the Connector and its credential still exist

#### Scenario: Cleanup failure logs carry no exception message
- **WHEN** a cleanup step fails with an exception whose message contains a secret value
- **THEN** no log line contains that value, and the original outcome is unchanged

### Requirement: File-backed data source creation leaves no row or stored file behind on failure
Creating a csv, text, pdf or image data source, by upload or by URL, SHALL leave no data source row and no stored file
created by that request when any step after the file write fails (the row insert or the inferred-schema write), and
SHALL surface the original failure unchanged. The cleanup SHALL remove only the stored object this request wrote and the
row this request inserted; it SHALL NOT remove any other object or row. A cleanup failure SHALL be logged and SHALL NOT
replace the original failure. A successful create SHALL be unchanged.

#### Scenario: Schema write fails after a CSV upload insert
- **WHEN** `POST /api/data-sources` uploads a CSV and the inferred-schema write fails after the row insert
- **THEN** the response is the same error status as before this change
- **THEN** the count of `data_sources` rows owned by the caller is unchanged from before the request
- **THEN** no stored file exists at the path the request wrote

#### Scenario: Row insert fails after the file was written
- **WHEN** a csv, text, pdf or image create (upload or URL) writes its file and the row insert then fails
- **THEN** no stored file exists at the path the request wrote, and the caller's `data_sources` count is unchanged

#### Scenario: Schema write fails for each other file-backed kind
- **WHEN** a csv URL, text, pdf or image create (upload or URL) fails at the inferred-schema write
- **THEN** the caller's `data_sources` count is unchanged and no stored file exists at the path the request wrote

#### Scenario: Cleanup never touches another object
- **WHEN** a create fails after its file write while other stored files and rows of the same user exist
- **THEN** those other files and rows still exist afterwards

#### Scenario: Cleanup works on the GCS storage backend
- **WHEN** storage is the GCS backend and a create fails after its file write
- **THEN** a delete is issued for exactly the object path the request created, in the configured bucket

#### Scenario: A failing cleanup does not mask the original error
- **WHEN** a create fails after its file write and the cleanup's own delete also fails
- **THEN** the original failure is surfaced unchanged
