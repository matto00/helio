## ADDED Requirements

### Requirement: POST /api/pipelines/:id/run executes a rest_api or sql base source
The backend SHALL execute a pipeline whose resolved base `sourceDataSourceId` is a `rest_api` or
`sql` `DataSource` using the in-process execution engine, the same way it already executes `static`/
`csv`/`text`/`pdf`/`image` sources — fetching rows via the source kind's existing connector
(`RestApiConnector`/`SqlConnector`) up to a bounded row count, then applying pipeline steps in
sequence. This SHALL NOT be rejected as an unsupported source type. A connector-level fetch failure
(unreachable endpoint, auth failure, query error) SHALL surface as the existing generic execution
failure (`422 Unprocessable Entity`, `last_run_status = "failed"`) — the same outcome any other
source-kind read failure already produces.

#### Scenario: A healthy rest_api source completes a real run
- **WHEN** `POST /api/pipelines/:id/run` is called on a pipeline whose base source is a reachable
  `rest_api` source
- **THEN** the response is `200 OK` with rows fetched from the REST endpoint, `last_run_status` is
  `"succeeded"`, and the output DataType is populated with those rows

#### Scenario: A healthy sql source completes a real run
- **WHEN** `POST /api/pipelines/:id/run` is called on a pipeline whose base source is a reachable
  `sql` source
- **THEN** the response is `200 OK` with rows fetched from the SQL query, `last_run_status` is
  `"succeeded"`, and the output DataType is populated with those rows

#### Scenario: An unreachable rest_api source fails the run, not silently
- **WHEN** `POST /api/pipelines/:id/run` is called on a pipeline whose base `rest_api` source cannot
  be reached
- **THEN** the response is `422 Unprocessable Entity` and `last_run_status` is `"failed"` — the same
  outcome as any other source-kind read failure, not the categorical rejection this source kind
  previously always received

### Requirement: previewStep supports a rest_api or sql base source
`PipelineRunService.previewStep` SHALL support previewing a prefix of steps ending at a given step
id when the pipeline's base source is `rest_api` or `sql`, loading source rows the same way a full
run does (bounded, via the connector) before applying the requested step prefix. This SHALL NOT be
rejected as an unsupported source type.

#### Scenario: Previewing a step on a rest_api-sourced pipeline
- **WHEN** a step preview is requested for a pipeline whose base source is a reachable `rest_api`
  source
- **THEN** the response contains up to 10 preview rows reflecting the executed step prefix, not a
  422 "unsupported source type" error
