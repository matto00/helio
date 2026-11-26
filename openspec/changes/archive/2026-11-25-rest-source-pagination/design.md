## Context

`RestApiConnectorDriver` (578 lines at 5613ea63f) has two issuers, `issueAndParse` and `issueTest`. Both funnel every request through `guardedPoolSettings`, the HEL-879 SSRF choke point that resolves, validates and pins one address per request. `fetch(config, maxRows, ...)` materialises every row of the single response and then applies `take(maxRows)`, reporting `FetchOutcome(rows, truncated, availableRowCount)`. That outcome flows through `SourceReadStats` and `TruncatedRead` to `TruncatedReadResponse`, which ends up in the run result, `pipeline_runs.truncated_reads` (JSONB, V104), the MCP surface and `SourceSampleService`. The source config is JSONB (`data_sources.config`), decoded by `DataSourceConfigCodec.decodeRest` through `RestApiConfigPayload`.

Owner rulings (escalation answered 1795642525752):

- (a) Backend, `schemas/sources` and the helio-mcp REST zod schema are in this PR; the UI is a follow-up.
- (b) `maxRequests` defaults to 20 and is configurable per source from 1 to 100. A breach is a curated fetchError naming the bound.
- (c) No config means the fetch is unchanged, with a non-blocking notice on create/infer only.
- (d) No backoff; a 429 is a curated mid-pagination fetchError.
- (e) One PR covering all five idioms.

## Goals / Non-Goals

**Goals:**

- Five idioms in one paging loop.
- Cap-bounded following, with truncation reported through the existing machinery and made distinguishable.
- A loud request bound.
- The egress guard on every followed URL.
- Whole-fetch failure semantics.
- The no-config path byte-identical.
- The looks-paged notice.

**Non-Goals:**

- The add/edit-source UI (follow-up).
- 429 backoff or throttling (HEL-597).
- A per-source row cap (HEL-1012).
- Paging on the ephemeral bare-URL path: `/api/sources/infer|test` with `EphemeralRestConfig` and `testConnection*` stay single-request, and a connection test checks reachability only.
- Auto-detecting an idiom.
- A `total` field read from the body.

## Decisions

### D1. Behaviour-preserving extraction first

The first commit, with no behaviour change, moves `maxStrictBytes`, `countWithinLimit` and `errorText` into a new `RestResponseReads` object in the same package. `readBodyPrefix` already lives in `RemoteErrorText`. The helpers take what they need (`ActorSystem`/`Materializer`) as parameters.

The existing `RestApiConnectorDriverErrorCapSpec`, `RemoteErrorBodyPrefixSpec` and `RestApiConnectorDriverSpec` must pass unchanged. That commit touches no test file.

Why: the paging loop adds roughly 200 lines. The pagination logic itself goes in a new `RestPagination.scala`, which covers config validation, next-request derivation per style, end detection and the looks-paged heuristic, all as pure functions over `(Uri, headers, JsValue)`. The driver keeps only the loop.

### D2. Config shape

`RestApiConfig` gains `pagination: Option[RestPagination] = None`, a sealed ADT with one case per style. `RestApiConfigPayload` gains `pagination: Option[JsValue]`; `toDomain` validates it and `fromDomain` writes it back. Validation is total and returns `Left` with the field named, never a thrown exception.

Every JSON schema carrying the REST config object gets the same `pagination` definition (`schemas/sources/data-source.schema.json` and `schemas/pipelines/create-pipeline-request.schema.json`, located by the shared `rootSelector` property). `additionalProperties: false` is kept, and the per-style requirements are encoded with `oneOf` on `style`. The helio-mcp `restDataSourceSchema.ts` zod schema mirrors it with a discriminated union.

### D3. The loop and request shapes

`fetchPaged(firstRequest, pagination, cap)` works as follows:

1. Issue a request through one issuer, `issuePage(request): Future[Either[String, PageResponse(json, headers)]]`. This is `issueAndParse` generalised to also return response headers, so the guard, the 2xx check, the capped error text and the per-response size limit are all literally shared. The existing `issueAndParse` becomes `issuePage(...).map(_.map(_.json))`.
2. Extract rows with `toRowsEither(json, rootSelector)`. The selector is applied PER PAGE, before concatenation.
3. Append the rows. Stop with `truncated = true` once the row count exceeds `cap`. This is cap+1 rows, so "exactly cap rows" is not truncated, matching HEL-861.
4. Otherwise derive the next request from the style. If there is none, stop with `truncated = false`.
5. If `requestsMade == maxRequests` and a next request exists, return `Left`, naming the bound.
6. If the deadline flag is set, stop issuing (the race below has already produced the `Left`).
7. Otherwise loop.

The loop is a tail-recursive `Future` chain with no blocking.

The **total time budget** is a true deadline of 120 s, held in `RestPagination.TotalTimeout` (injectable for tests). The whole `fetchPaged` future is raced against `org.apache.pekko.pattern.after(TotalTimeout)`. If the deadline fires first, the result is a curated `Left` ("Pagination exceeded its 120 s total time budget after N pages"), with no rows. Any page still in flight has its result discarded, and the loop checks a shared `deadlineHit` flag before issuing another page, so no further request starts after the deadline.

Each page's 2xx body read additionally uses `max(1 ms floor, min(30 s, remaining))` as its `toStrict` timeout (never zero or negative). A page whose response arrives after the deadline has its entity discarded (`discardEntityBytes`) instead of being read. The 30 s is today's body-read ceiling; time-to-headers is governed by the client pool settings.

A fetch therefore never succeeds after 120 s. If the deadline elapses during the last page, the result is the `Left`, not success. Only the run path pages (D8), so no create/infer/preview request is extended.

**First request** (`page`/`offset`; the other styles send the configured request unchanged):

- `page`: set `pageParam = startPage`, and, when `pageSize` is set, `pageSizeParam = pageSize`. Each set replaces every existing pair of that name and keeps the other pairs in order.
- `offset`: set `offsetParam = 0` and `limitParam = limit`.

**Next request:**

- `page`: `pageParam = previous + 1`.
- `offset`: `offsetParam = previous offset + limit`. This uses `limit`, not the received row count.
- `cursor`: `cursorParam = <value at cursorPath>`. A value that is not a JSON string or number is a curated error.
- `link`:
  - Parse every `Link` header, splitting comma-separated link-values (commas inside `<...>` are respected).
  - Take the first link whose `rel` parameter is `next`. Match `rel` quoted or unquoted, split on whitespace, and match tokens case-insensitively (so `rel="next last"` matches).
  - Resolve the target against the current request URI (relative targets are legal per RFC 8288).
- `next_url`: a string at `nextUrlPath`, resolved the same way.

For `link` and `next_url`, keep the method, rebuild headers from the first request, and re-apply the auth query parameter through `injectAuthQueryParam`, so a server-echoed key never shadows the credential. For `cursor`, `page` and `offset`, rewrite only the named query parameter on the first request's URI and re-apply the auth parameter. A body (POST) is resent unchanged on every page.

**End detection:**

- `link`: no next link.
- `next_url` and `cursor`: the value is absent, null or an empty string.
- `page`: zero rows, or fewer than `pageSize` when it is set.
- `offset`: zero rows, or fewer than `limit`.

A repeated next URL or cursor (equal to any earlier one) is an immediate curated error.

### D4. Egress guard and same-origin

Every page goes through `issuePage`, and so through `guardedPoolSettings`. The guard runs first on the followed URL; the same-origin check (scheme, host and effective port equal to the first request's) runs second.

This ordering is deliberate. A followed blocked host is necessarily cross-origin: `isBlocked` is keyed on `(host, addr)` and page 1's host must be admitted. So only guard-first lets the AC's blocked-host test reach the guard's own refusal. The test asserts the guard's exact refusal text, not merely `Left`. Under the guard-bypass mutation the origin check still refuses, but with a different message, so that test goes red.

A cross-origin URL to an allowed host is refused by the origin check, so credentials (auth header, auth query parameter, source headers) are never sent to a different origin. Guard-first does mean a body-supplied cross-origin hostname is DNS-resolved before it is refused. This is accepted: resolution opens no connection, and the guard already resolves every first-request host.

Rejected alternative: follow cross-origin with credentials stripped. That is more permissive, harder to reason about, and not needed by any idiom the ticket names.

### D5. Truncation is distinguishable

`FetchOutcome`, `SourceReadStats`, `TruncatedRead` and `TruncatedReadResponse` gain `pagesFetched: Option[Int] = None`:

- `Some(n)` only when a paged fetch stopped at the cap.
- `availableRowCount = None` for a paged truncation (the total is unknown; no body `total` is read).
- A single-request truncation keeps `availableRowCount = Some(n)` and `pagesFetched = None`.

`composeTruncationNotice` mentions the pages for a paged read. The persisted JSONB gains the key when present. Old rows decode without it, and the format must tolerate absence, so no migration is needed.

`schemas/pipelines/pipeline-run-record.schema.json` (and any other schema carrying a truncated-read item) adds an optional integer `pagesFetched`. helio-mcp `types.ts` adds it as optional.

### D6. Failure semantics

Any `Left` on page n > 1 maps to `s"Page $n: $err"` and fails the whole fetch. The causes are: guard refusal, origin refusal, a non-2xx response (including 429, with the already-capped `HTTP <code>: <prefix>`), JSON parse failure, an oversize body, a root selector miss, transport failure, a repeated cursor or next URL, or a missing required cursor or next value of the wrong JSON type.

On page 1, the error text is unchanged from today. This keeps today's curated messages intact for a first-page failure and for the no-config path.

A repeated cursor or URL (equal to any previously requested one) is an immediate curated error instead of burning the request budget. The error flows out as the `Left` the engine and envelope already surface as `fetchError` (HEL-468). There is no retry and no backoff.

### D7. The per-response size limit applies per page

HEL-1877's explicit `toStrict(30s, maxStrictBytes)` applies to each page's 2xx body unchanged. A total-bytes budget is not added:

- Retained rows are bounded by cap+1, plus at most one page's parsed JSON in flight.
- The request count is bounded by `maxRequests` (at most 100).

Worst-case transfer is 100 × 8 MiB, the same per-request exposure as today multiplied by an owner-chosen bound. Each page also keeps its own 30 s ceiling.

### D8. Which callers page, and the internal API

**Only the run path pages.** `fetch(config, maxRows, resolveContext, ...)` returns `FetchOutcome`. It is used by `InProcessPipelineEngine` and therefore by the source sample route (`SourceSampleService` reads the engine's stats).

- **When `config.pagination` is `None`:** this method is unchanged. It still calls `fetch(config, ctx)` (so `fetchOverride` fixtures behave exactly as today) and reports `availableRowCount = Some(all.size)`, `pagesFetched = None`.
- **When `config.pagination` is `Some` and `fetchOverride` is `None`:** it calls `fetchPaged`, which returns `FetchOutcome(rows.take(cap), truncated, availableRowCount = if (truncated) None else Some(rows.size), pagesFetched = if (truncated) Some(n) else None)`.
- **When `fetchOverride` is wired:** pagination is ignored (the single override call, today's path). The override hook has no notion of a page, so paging is tested only against stub HTTP servers. This is stated in the method's scaladoc.

**First page only:** `fetch(config, ctx): JsValue` (the public raw-body method used by `previewRest`), `inferSchema`, `inferSchemaForConnector`/`inferSchemaForResolvedConnector`, `inferSchemaEphemeral`, `testConnection*` and the HEL-1638 dry run all keep issuing exactly one request, for configured and unconfigured sources alike. The selector and row semantics are unchanged. This keeps every synchronous create/infer/preview request at today's latency and request count.

These paths go through a new internal `fetchFirstPage(config, ctx): Future[Either[String, PageResponse]]`, which `fetch(config, ctx)` maps to `.json`. The inference methods use the headers for D9.

**Row-cap notice for a configured source (CR3).** Inference reads page 1 only, so its row count is page 1's count, not the source's. When `config.pagination` is `Some`, the inference result sets `observedRowCount = None`. `rowCapNotice` is then never computed from a single page, so no false "held N rows" count is ever stated. The run path still reports real paged truncation through `truncatedReads`.

**Dry pipeline runs** (`submit(isDry = true)`) go through the engine and DO page, like any run. Only the HEL-1638 inline root-schema dry run (`dryRunRestSchema`) is single-request.

**`pagination` on infer/test requests** (both the `connectorId` and bare-`url` paths) is validated (a malformed shape is a `400`, as on create) but never followed, consistent with the rule above. `toEphemeral` therefore validates and then drops it, explicitly.

### D9. The looks-paged notice

Inference computes `looksPaged` from page 1, using the headers from `fetchFirstPage`/`issuePage`. That covers the persisted-connector infer, the HEL-1638 dry run and the bare-`url` ephemeral infer, which is routed through `issuePage` too. `looksPaged` is true when:

- page 1 has a `Link` next link (D3's parser), or
- the top-level body is an object carrying any key in the fixed list from the spec (`links.next` meaning a `links` object holding `next`).

The signal travels on `InferredSchema.looksPaged: Boolean = false`, which is domain-only and not serialized.

**Wire placement (CR4/CR5).** `InferredSchemaResponse` gains `pagingNotice: Option[String] = None`. It moves to `jsonFormat2`, and `None` is omitted, so existing bodies are byte-identical. It is set only when `looksPaged` is true and the REQUEST PAYLOAD (or stored config) has no `pagination`. For the bare-`url` path this is evaluated on the payload before `toEphemeral` drops the key, so a configured request never gets a notice. `InferredSchemaResponse` is both:

- the body of `POST /api/sources/infer`, and
- the `inferredSchema` member of the create response (`POST /api/sources` (REST create)).

So one field covers create and infer (owner ruling c), and there is no second top-level field. It never alters rows, schema or the stored config.

**No JSON schema contract.** `CreateSourceResponse` and `InferredSchemaResponse` have no JSON schema in `schemas/` today (`rowCapNotice`/`fetchError` appear in none). This change does not invent one. The contract is the spec, plus Scala route-level wire tests (the field present and absent) and the helio-mcp types.

### D10. helio-mcp forwarding (CR2)

Adding `pagination` to the `.strict()` zod schema is not enough, because three sites forward REST config field by field:

- `tools/write.ts` (`create_rest_data_source` handler, around l.330-340)
- `helioApi.ts` `createRestDataSource` (around l.709-733)
- `tools/pipelinesHandlers.ts` (the inline `rest_api` pipeline root, around l.85-95)

Each must forward `pagination`. A seam test asserts that the outgoing `POST` body carries `pagination` for the create tool and the inline pipeline root. It goes red when either forward is removed.

helio-mcp must also relay:

- `inferredSchema.pagingNotice` through `RawCreateSourceResponse` → `CreateSourceResult` (`helioApi.ts` around l.100-106 and l.737, `types.ts`), with a test.
- `pagesFetched` in both `helioApi.ts`'s own truncated-read interface (around l.130-135) and `types.ts`'s.

**Out of scope (listed with the UI follow-up):** `ProposalRestApiConfig` (`PipelineProposalProtocol.scala:50`) and `toRestApiConfigPayload` carry no `pagination`, so assistant- and proposal-authored sources cannot page yet.

## Risks / Trade-offs

- **Same-origin refusal blocks APIs whose next page lives on a CDN host.** Mitigation: a curated error says so. Relaxing it is a follow-up decision, not silent behaviour.
- **Cursor APIs that legitimately repeat a cursor value would be refused.** None of the named idioms do this. The error is loud.
- **`page` style end detection relies on a short or empty page.** An API that always returns a full page forever is caught by `maxRequests`, loudly.
- **The total time budget (120 s) exceeds the default Pekko server request timeout (20 s).** This matters only for the synchronous sample route over a paged source, where the HTTP request may time out while the fetch completes in the background. Runs are asynchronous and unaffected. This is accepted: the alternative of a sample-specific lower budget would make sample and run disagree.
- **Adding a field to `TruncatedReadResponse` changes a persisted JSONB shape.** The field is optional on read and write; a decode spec covers an old row with no key.

## Migration Plan

No DB migration: the config and `truncated_reads` are both JSONB. Rollback means removing the code. A stored `pagination` key on a source would then be ignored by the old decoder, which reads by field and has no strictness on unknown keys. The executor verifies this against `RestApiConfigPayload`'s format before claiming it.

## Test plan (red first, mutation-proven)

All of these are backend ScalaTest using local stub servers: a new `RestApiConnectorDriverPaginationSpec`, plus focused additions to the codec, envelope and truncation specs.

- **Per idiom (5):** a three-page fixture returns all rows.
  - Red first: commit the run against an implementation where `pagination` is parsed but never followed.
  - Mutation: disable page-following, then show the test red with the second page's rows missing. Prove the red arm is reachable by asserting the fixture actually served page 2 in the green run (stub request log).
- **Cap:** a fixture larger than the cap gives `truncated`, `rowsRead == cap` and `pagesFetched` set, and the stub log shows no request after the cap was exceeded. Mutation: drop the cap stop, and the test goes red.
- **Request bound:** endless next links with `maxRequests: 3` gives exactly 3 requests and a `Left` naming 3. Mutation: return the partial rows instead, and the test goes red.
- **Egress guard:** page 2's next points at a blocked host (the guard's `isBlocked` is keyed on the second hostname, which resolves to the stub address). The test asserts the guard's exact refusal text, and the stub log shows no page 2 request. Mutation: bypass the guard for followed URLs. The origin check then refuses with a different message, so the text assertion goes red.
- **Cross-origin:** refused, with no request sent.
- **Mid-pagination:** 500 on page 2 and 429 on page 3 each give a `Left` naming the page, and no rows.
- **Guard test, no config:** against the paged stub, a no-config source makes exactly one request and returns the same rows and `FetchOutcome` as the unchanged driver. This is labelled a guard (failable by a mutation that follows `Link` without config).
- **Codec/validation:** round-trip, every invalid shape gives `400`, and an old config with no key decodes unchanged.
- **Envelope and wire:** `inferredSchema.pagingNotice` is present for an unconfigured looks-paged source on both `POST /api/sources` and `POST /api/sources/infer` (connectorId and bare url), and absent when configured or not paged. A configured source's create has no `rowCapNotice` from page 1 (CR3).
- **Time budget:** the budget is lowered for the test (the constant is injectable). Two cases:
  - A stub delays page 2 past the deadline: the result is a curated `Left` naming the budget, and no page 3 request is made.
  - A stub whose LAST page completes after the deadline: the result is the `Left`, not success.
- **First request:** the stub log shows `page`/`offset` params on request 1 and the `offset + limit` progression.
- **Link parsing:** a multi-link header, `rel="next last"`, unquoted `rel=next` and a relative target (unit tests).
- **Truncation wire:** `pagesFetched` round-trips through the persisted JSONB, and an old row without it decodes.
- **helio-mcp:** a zod schema test for a valid config and each invalid one; the D10 forwarding seam tests; and the `pagingNotice` relay test.
- **Run the full spec files**, plus the existing REST driver specs and the schema-drift check.
