# source-sample-api Specification

## Purpose
Serve a bounded, engine-loaded head sample of one data source's rows so the client can recompute a draft pipeline
locally, without re-reading the live source on every edit and without counting as a pipeline run.

## Requirements

### Requirement: Engine-loaded head sample endpoint

The system SHALL expose `GET /api/data-sources/:id/sample`, which loads the source's rows exactly as a pipeline run
loads them (including REST/SQL flattening and the engine's value typing) and returns at most the first 1,000 of them,
in engine order, with `capturedAt` (ISO-8601 server time of the read), `sourceRowCount`, `truncated` and `live`.
It SHALL support `dataset`, `csv` (uploaded or URL-backed), `rest_api`, `sql`, `text` and `pdf` sources, and SHALL
respond `400` for `image` sources. It SHALL NOT write to the source or persist anything.

#### Scenario: Static source under the cap
- **WHEN** the owner requests the sample of an uploaded CSV with 412 rows
- **THEN** the response is `200` with 412 rows, `sourceRowCount` 412, `truncated` false and `live` false

#### Scenario: Static source over the cap
- **WHEN** the owner requests the sample of an uploaded CSV with 12,431 rows
- **THEN** the response carries the first 1,000 rows in file order, `sourceRowCount` 12,431 and `truncated` true

#### Scenario: Live source whose total is unknown
- **WHEN** a `sql` or `rest_api` read is truncated at 1,000 rows and the driver did not observe a total
- **THEN** `truncated` is true, `sourceRowCount` is present with the value `null`, and `live` is true

#### Scenario: Engine row shape
- **WHEN** a `rest_api` source returns nested JSON objects
- **THEN** the sample rows equal the rows a pipeline run loads for that source (flattened the same way), not the
  raw response JSON

#### Scenario: Lossless value classes
- **WHEN** a sampled cell is a JVM integral or a non-finite double
- **THEN** it is encoded as `{"$int": n}`, `{"$long": "n"}` or `{"$double": "NaN" | "Infinity" | "-Infinity" | "-0.0"}`,
  and every other number is a plain JSON number meaning a double

#### Scenario: URL-backed read applies the run's URL checks
- **WHEN** a URL-backed CSV source's URL resolves to a blocked (private) host
- **THEN** the sample fails with `502` exactly as a run's read of that source fails, and no request reaches the host

#### Scenario: Source read fails
- **WHEN** the live source cannot be read
- **THEN** the response is `502` with a curated message that contains no row contents and no credentials

### Requirement: Sample access is owner-only

The sample endpoint SHALL authorize exactly like the existing source preview routes: only the source's owner may read
it, under the caller's row-level-security context, and any other caller SHALL receive `404`, indistinguishable from an
unknown id. This SHALL hold for the production database role that does not bypass row-level security.

#### Scenario: Another user's source
- **WHEN** user B requests the sample of user A's source
- **THEN** the response is `404` and contains no rows

### Requirement: Sample requests are limited as source fetches, never as runs

Every sample request SHALL be charged against the per-user source-fetch limiter (the same bucket as the source preview
routes, `SOURCE_FETCH_RATE_LIMIT_PER_WINDOW`, default 30 per window) and SHALL NOT be charged against, admitted by, or
recorded in the pipeline-run guard (rate window, concurrency cap, run history).

#### Scenario: Thirty-first request in a window
- **WHEN** a user makes 31 sample requests within one window at the default limit
- **THEN** the first 30 succeed and the 31st is `429` with `Retry-After`

#### Scenario: Run guard untouched
- **WHEN** a user makes sample requests
- **THEN** no pipeline-run rate-window row, pipeline run, or run-guard admission is created for that user

### Requirement: Committed response contract

The response SHALL validate against `schemas/sources/source-sample-response.schema.json`, and both the server and the
client test suites SHALL validate against that committed file.

#### Scenario: Both sides validate the same schema
- **WHEN** the server's serialized sample and the client's parsed fixture are validated
- **THEN** both pass the committed schema, including a truncated sample whose `sourceRowCount` is `null`, and a
  response missing `capturedAt` or omitting `sourceRowCount` fails it
