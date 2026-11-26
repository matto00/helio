## Why

A REST source sends exactly one request and keeps what that returns. Against any paged API it silently ingests only page one. Nothing is truncated in the engine's sense, so `truncatedReads` stays empty and the user sees a well-formed dashboard built on a fraction of the data (HEL-1013, carrying HEL-591's `next_url` and mid-pagination-failure scope).

## What Changes

- A REST source config gains an optional `pagination` object that names one of five idioms: `link` (RFC 5988 `Link: rel="next"`), `next_url` (absolute next-page URL read from a body path), `cursor` (opaque cursor read from a body path, sent back as a query parameter), `page` (page number, with an optional page-size parameter) and `offset` (offset/limit).
- When `pagination` is set, the driver follows pages until one of these happens: the idiom says there are no more pages, or more than the effective row cap has been collected. Hitting the cap reports truncation through the existing `truncatedReads` machinery, with a new optional `pagesFetched` field so a paged truncation can be told apart from a single-request one.
- `pagination.maxRequests` bounds the loop independently: default 20, configurable per source from 1 to 100 (owner ruling b). Running out of requests while more pages remain fails the fetch with a curated error naming the bound. It never stops silently.
- Every followed URL goes through the HEL-879 SSRF egress guard, exactly as the first request does.
- A failure on any page, including a `429` (owner ruling d: no backoff; HEL-597 owns throttling), fails the whole fetch with a curated error that names the page. No partial result is ever reported as success.
- Only pipeline runs (and the run-identical sample route) page. Create, infer, preview, connection test and the inline dry run stay single-request. A total time budget of 120 s bounds a paged fetch.
- With no `pagination` config, the request, the rows and the run result are unchanged (owner ruling c). The inferred-schema object on create and infer gains an optional, non-blocking `pagingNotice` when the single response looks paged. It never guesses an idiom and never changes run results.
- Surfaces in this change (owner ruling a): backend, `schemas/sources/*` and the helio-mcp REST source zod schema. The add/edit-source UI is a follow-up.
- First commit, behaviour-preserving: move the HEL-1877 response-read helpers (`maxStrictBytes`, `countWithinLimit`, `errorText`) out of `RestApiConnectorDriver.scala`, which is past CONTRIBUTING's ~400-line guide at 578 lines.

## Capabilities

### New Capabilities
- `rest-source-pagination`: paging idioms for REST sources, with cap-bounded page following, a request bound, the per-URL egress guard, whole-fetch failure semantics and a no-config looks-paged notice.

### Modified Capabilities
(none: the truncation report gains an optional field, specified within the new capability)

## Impact

- Backend:
  - `domain/connectors/RestApiConnectorDriver.scala`
  - new `domain/connectors/RestPagination.scala` and a response-reads helper
  - `domain/model` (`RestApiConfig`, `TruncatedRead`)
  - `ConnectorDriver.FetchOutcome`
  - `InProcessPipelineEngine.SourceReadStats` and its truncation sink
  - `PipelineRunSupport` and `PipelineRunService.composeTruncationNotice`
  - `PipelineProtocol.TruncatedReadResponse`
  - `DataSourceProtocol.RestApiConfigPayload`
  - `CreateSourceEnvelope`
  - `SourceSampleService` (reads the same stats)
- Schemas:
  - `schemas/sources/data-source.schema.json` and every other source schema that carries the REST config shape
  - `schemas/pipelines/pipeline-run-record.schema.json` and any run response schema carrying `truncatedReads`
- helio-mcp:
  - the `restDataSourceSchema.ts` zod schema
  - field-by-field forwarding in `tools/write.ts`, `helioApi.ts` and `tools/pipelinesHandlers.ts`
  - relay of `pagingNotice` and `pagesFetched` (`helioApi.ts`, `types.ts`)
- No JSON schema exists for the create/infer response, and none is added: the spec plus wire tests are the contract.
- Follow-ups (not covered here): the add/edit-source UI, and `ProposalRestApiConfig` (assistant- and proposal-authored sources).
- No migration: the source config and `pipeline_runs.truncated_reads` are both JSONB, and absent fields decode as absent.
- Not touched: HEL-1587 files (`PublicPanelListResolver`, `PublicDashboardRoutes`, `PublicDashboardViewerPage`) and HEL-1882 files (`OutputRepository`, insight refresh render start).
