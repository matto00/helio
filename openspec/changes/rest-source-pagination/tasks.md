## Standing Constraints

- [C1] With no `pagination` config, a REST fetch is byte-identical to today: one request, the same rows and the same truncation fields. Proven by a guard test against a paged stub (owner ruling c).
- [C2] Any failure on any page fails the whole fetch with a curated error naming the page. A 429 is never retried or backed off (owner ruling d). The rows collected so far are never returned.
- [C3] Every page request goes through the single guarded issuer (HEL-879 `guardedPoolSettings`). No second issuer and no unguarded follow.
- [C4] Out of scope for this PR: the add/edit-source UI (`RestApiForm`, a follow-up raised at Delivery), 429 backoff (HEL-597), and HEL-1587/HEL-1882 files.

## 1. Behaviour-preserving extraction (its own first commit)

- [x] 1.1 Move `maxStrictBytes`, `countWithinLimit` and `errorText` from `RestApiConnectorDriver.scala` into a new `RestResponseReads` object (same package), with no behaviour change and no test-file change.
- [x] 1.2 Run the full `RestApiConnectorDriverSpec`, `RestApiConnectorDriverErrorCapSpec`, `RemoteErrorBodyPrefixSpec` and `RemoteErrorTextSpec` green, then commit `HEL-1013 Move REST response-read helpers out of the driver (no behaviour change)`.

## 2. Red first

- [x] 2.1 Add `RestPagination` config ADT and validation (`RestPagination.scala`), `RestApiConfig.pagination`, and `RestApiConfigPayload.pagination` wiring. Parse it, but do NOT follow pages yet.
- [x] 2.2 Write `RestApiConnectorDriverPaginationSpec` (local stub server with a request log, injected `resolveHost`/`isBlocked`). It covers:
  - the per-idiom multi-page tests (5)
  - cap truncation with `pagesFetched`
  - the request-bound breach
  - the egress guard on page 2's blocked host
  - cross-origin refusal
  - a 500 on page 2 and a 429 on page 3
  - the repeated-cursor refusal
  - the no-config guard
- [x] 2.3 Run the spec against the parse-only implementation. Save the output as `.concertino/runs/HEL-1013/evidence/red-run.txt` in the main checkout. Commit the spec plus the red transcript (as `.txt`) in the worktree before any loop code. If the hook refuses, keep the evidence and note it for the PR.

## 3. Implementation

- [x] 3.1 Generalise `issueAndParse` into `issuePage` (returns body and headers). `issueAndParse` delegates to it, keeping the one guarded issuer (C3).
- [x] 3.2 Implement next-request derivation per style, end detection, repeat detection and the looks-paged heuristic in `RestPagination.scala`, as pure functions with unit tests.
- [x] 3.3 Implement the paging loop (design D3/D4/D6): cap+1 stop, `maxRequests` breach `Left`, guard then same-origin check, page-numbered errors from page 2 on, and page-1 errors unchanged.
- [x] 3.4 Wire paging into `fetch(config, maxRows, ...)` only, when pagination is set and no `fetchOverride` is wired (design D8). Add `fetchFirstPage`, and route `fetch(config, ctx)`, all `inferSchema*`, `previewRest`, ephemeral and `testConnection*` through single-request paths.
  - When pagination is set, inference reports `observedRowCount = None`.
  - Infer/test validate `pagination` but never follow it.
- [x] 3.4a Add the total time budget as a true deadline (`RestPagination.TotalTimeout` = 120 s, injectable for tests; race plus no-issue-after-deadline; per-page `toStrict` of `min(30 s, remaining)`) and the first-request params for `page`/`offset` (design D3).
- [x] 3.5 Add `pagesFetched` to `FetchOutcome`, `SourceReadStats`, `TruncatedRead`, `TruncatedReadResponse`, the persisted JSONB format (tolerating an absent key), `composeTruncationNotice` and `SourceSampleService` as needed.
- [x] 3.6 Add the `looksPaged` signal (`InferredSchema`, domain-only) and `InferredSchemaResponse.pagingNotice` (optional, omitted when `None`) on create and on `POST /api/sources/infer`, both connectorId and bare url (design D9). Add route-level wire tests for present and absent.

## 4. Contract surfaces

- [x] 4.1 Add `pagination` (a per-style `oneOf`, `maxRequests` 1..100) to every schema carrying the REST config: `schemas/sources/data-source.schema.json` and `schemas/pipelines/create-pipeline-request.schema.json`. Add optional `pagesFetched` to every truncated-read schema. No schema is added for the create/infer response (design D9).
- [x] 4.2 helio-mcp (design D10):
  - add `pagination` to the `restDataSourceSchema.ts` zod schema (discriminated union)
  - forward it in `tools/write.ts`, `helioApi.ts` `createRestDataSource` and `tools/pipelinesHandlers.ts`
  - relay `inferredSchema.pagingNotice` into `CreateSourceResult`
  - add `pagesFetched` to `helioApi.ts`'s and `types.ts`'s truncated-read types
  - tests: zod; a seam test that the outgoing body carries `pagination` (red when a forward is removed); the notice relay
- [x] 4.3 Run the schema-drift check green.

## 5. Mutations and verification

- [x] 5.1 Run the mutations, recording each red run as `.txt` evidence:
  - (a) disable page-following, so the multi-page tests go red and the stub log shows page 2 was served in the green run
  - (b) drop the cap stop, so the cap test goes red
  - (c) return partial rows on a bound breach, so the bound test goes red
  - (d) bypass the guard for followed URLs, so the egress test goes red on its exact guard-refusal-text assertion
  - (e) follow `Link` without config, so the no-config guard goes red
- [x] 5.2 Run in full: the new spec files plus every existing REST driver, codec, envelope, truncation, sample and run-history spec they touch (sbt `-J-Xmx3g`, shards under the timeout), helio-mcp tests, lint/format/typecheck.
- [x] 5.3 Update the `CLAUDE.md` key-endpoint/data-source notes only if a documented contract line changes (the create-source response gains `pagingNotice`).
