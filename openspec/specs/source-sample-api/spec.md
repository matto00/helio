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

### Requirement: Sample requests are limited as source fetches, never as runs

Every sample request, owner or pipeline-scoped, successful or `404`, SHALL be charged against the caller's own
per-user source-fetch limiter bucket (the same bucket as the source preview routes, `SOURCE_FETCH_RATE_LIMIT_PER_WINDOW`,
default 30 per window; never the pipeline or source owner's bucket) and SHALL NOT be charged against, admitted by, or
recorded in the pipeline-run guard (rate window, concurrency cap, run history) of any user.

#### Scenario: Thirty-first request in a window
- **WHEN** a user makes 31 sample requests within one window at the default limit
- **THEN** the first 30 succeed and the 31st is `429` with `Retry-After`

#### Scenario: Run guard untouched
- **WHEN** a user makes sample requests
- **THEN** no pipeline-run rate-window row, pipeline run, or run-guard admission is created for that user

#### Scenario: Grantee exhausts only their own bucket
- **WHEN** editor B makes 30 pipeline-scoped sample requests for P's source within one window at the default limit
- **THEN** B's next sample or preview request is `429` with `Retry-After`, while owner A's own sample request still
  succeeds, and no pipeline-run rate-window row or pipeline run exists for A or B

### Requirement: Committed response contract

The response SHALL validate against `schemas/sources/source-sample-response.schema.json`, and both the server and the
client test suites SHALL validate against that committed file.

#### Scenario: Both sides validate the same schema
- **WHEN** the server's serialized sample and the client's parsed fixture are validated
- **THEN** both pass the committed schema, including a truncated sample whose `sourceRowCount` is `null`, and a
  response missing `capturedAt` or omitting `sourceRowCount` fails it

### Requirement: Sample access is owner or pipeline-scoped grantee

The sample endpoint SHALL serve a source's sample to its owner exactly as before. It SHALL also accept an optional
`pipelineId` query parameter, and SHALL serve the sample to a caller who does not own the source only when all of the
following hold at the time of the request: the caller is that pipeline's owner or holds an `editor` grant on it (a
`viewer` grant does not qualify), and that pipeline currently uses the source as one of its roots or as the source input of one of its
`join`, `union` or `lookup` steps. Any other caller SHALL receive `404` with a body byte-identical to the response for
an unknown source id, with no rows, whether the pipeline id is unknown, malformed, not shared with the caller, shared
at a non-qualifying level, revoked, or does not use the source. The source SHALL be read only after this check
succeeds. This SHALL hold for the production database role that does not bypass row-level security.

#### Scenario: Editor grantee samples a root of the shared pipeline
- **WHEN** user B, holding an `editor` grant on user A's pipeline P whose root is A's source S, requests the sample of
  S with `pipelineId` P
- **THEN** the response is `200` with S's sample, identical in shape to the owner's

#### Scenario: Editor grantee samples a secondary input
- **WHEN** P has a `join`, `union` or `lookup` step whose source input is A's source S2, and editor B requests S2's
  sample with `pipelineId` P
- **THEN** the response is `200`

#### Scenario: Pipeline owner samples a collaborator's secondary
- **WHEN** an editor attached their own source S3 as the source input of a `lookup` step of A's pipeline P, and A
  requests S3's sample with `pipelineId` P
- **THEN** the response is `200`; without `pipelineId` it is `404`

#### Scenario: Source the pipeline does not use
- **WHEN** editor B requests the sample of A's source U, which P does not use, with `pipelineId` P
- **THEN** the response is `404`, byte-identical to an unknown id's

#### Scenario: Revoked grant
- **WHEN** A revokes B's grant on P and B then requests S's sample with `pipelineId` P
- **THEN** the response is `404`, byte-identical to an unknown id's

#### Scenario: Source removed from the pipeline
- **WHEN** S is no longer a root or secondary input of P and editor B requests S's sample with `pipelineId` P
- **THEN** the response is `404`, byte-identical to an unknown id's

#### Scenario: Viewer grantee
- **WHEN** user B holds only a `viewer` grant on P and requests S's sample with `pipelineId` P
- **THEN** the response is `404`, byte-identical to an unknown id's

#### Scenario: Stranger and no scope
- **WHEN** user C, with no grant on P, requests S's sample with `pipelineId` P, or B requests it without `pipelineId`
- **THEN** the response is `404`, byte-identical to an unknown id's
