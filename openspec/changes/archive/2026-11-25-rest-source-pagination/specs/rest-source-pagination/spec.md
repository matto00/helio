## Purpose

Lets a REST source declare how its API pages, so the source can follow pages up to the row cap. Truncation, request-bound breaches and mid-pagination failures are each reported loudly, never as a silent first-page result.

## ADDED Requirements

### Requirement: A REST source may declare one paging idiom

A REST source config SHALL accept an optional `pagination` object whose `style` is one of `link`, `next_url`, `cursor`, `page` or `offset`, plus the parameters that style needs:

- `next_url` requires `nextUrlPath`, a dot path into the response body.
- `cursor` requires `cursorPath` (a body dot path) and `cursorParam` (the query parameter the cursor is sent back in).
- `page` takes optional `pageParam` (default `page`), `startPage` (default 1), `pageSizeParam` and `pageSize`.
- `offset` takes optional `offsetParam` (default `offset`), `limitParam` (default `limit`), and requires `limit`.

`maxRequests` is optional, an integer from 1 to 100, with a default of 20. A config with an unknown style, a missing required parameter, an out-of-range integer or an unknown key inside the `pagination` object SHALL be rejected (the rest of the REST config keeps its existing unknown-key tolerance) with `400` on REST source create, infer and test, and on an inline pipeline REST root. There is no REST config update route.

#### Scenario: Valid paging config is stored and echoed back
- **WHEN** a REST source is created with `pagination: {style: "cursor", cursorPath: "meta.next", cursorParam: "after"}`
- **THEN** the create succeeds and the source's config carries the same `pagination` object on read

#### Scenario: Invalid paging config is rejected
- **WHEN** a REST source is created with `pagination: {style: "offset"}` (no `limit`) or with `maxRequests: 0` or `101`
- **THEN** the request is rejected with `400` and a message naming the offending field

### Requirement: A source with no paging config is unchanged

A REST source without `pagination` SHALL issue exactly one request, identical to the request issued before this change. It SHALL produce identical rows and identical truncation fields. It SHALL never follow a `Link` header or a `next` field.

#### Scenario: No-config source against a paged server
- **WHEN** a source with no `pagination` is fetched from a server whose response carries `Link: <...>; rel="next"` and a body `next` field
- **THEN** exactly one request is made, and the rows are page one's rows with the same truncation fields as before this change

### Requirement: A configured source follows pages up to the effective row cap

During a pipeline run, a source with `pagination` SHALL keep requesting the next page, derived per its style, until one of the following:

- (a) the style signals the end:
  - `link`: no `rel="next"` link
  - `next_url`: the path is absent, null or empty
  - `cursor`: the path is absent, null or empty
  - `page` and `offset`: a page with zero rows, or fewer rows than the configured page size or limit
- (b) it holds more rows than the effective row cap.

Rows from every fetched page SHALL be concatenated in page order. The effective row cap is the cap the caller applies (today 1000).

#### Scenario: Multi-page fetch for each idiom
- **WHEN** a source of each style reads a local paged fixture of three pages of 2 rows each, under the cap
- **THEN** all 6 rows are returned in page order
- **AND** `link`, `next_url` and `cursor` make three requests, the last page signalling the end
- **AND** `page` and `offset` end only on a short or empty page, so when every page is full the fixture needs one further request that returns an empty page (here 6 rows at a page size or limit of 3 are two full pages plus an empty third, three requests; at a page size of 2 they would take four)

### Requirement: Stopping at the cap is reported as paged truncation

When paging stops because more rows than the cap were collected, the fetch SHALL report `truncated = true` with `rowsRead` equal to the cap. It SHALL report the number of pages fetched as `pagesFetched`, carried on that source's `truncatedReads` entry in the run result and in persisted run history. `availableRowCount` SHALL be absent unless the true total is known. A single-request truncation SHALL carry no `pagesFetched`. Pagination SHALL never deliver more rows than the cap.

#### Scenario: Paged fixture larger than the cap
- **WHEN** a paged source's fixture holds more rows than the cap
- **THEN** the run's `truncatedReads` entry for that source has `rowsRead` equal to the cap and a `pagesFetched` value, and no further pages are requested after the cap is exceeded

#### Scenario: Single-request truncation is distinguishable
- **WHEN** a no-config source returns more rows than the cap in one response
- **THEN** its `truncatedReads` entry has no `pagesFetched`

### Requirement: The request bound is enforced loudly

If `maxRequests` responses have been fetched, the cap has not been exceeded, and the last response still signals a next page, the fetch SHALL fail with a curated error naming the `maxRequests` value. It SHALL NOT return the rows collected so far.

#### Scenario: Endless next links
- **WHEN** a `link`-style source with `maxRequests: 3` reads a server that always returns a next link and fewer rows than the cap
- **THEN** exactly 3 requests are made and the fetch fails with an error naming the bound of 3

### Requirement: Every followed URL passes the egress guard

Each page request, including URLs taken from a `Link` header or a body path, SHALL be checked by the same SSRF egress guard as the first request before any connection is opened. Each request SHALL be pinned to its own validated address. A followed URL on a different origin (scheme, host or port) from the first request SHALL be refused, so credentials are never sent to another host.

#### Scenario: Page 2 next points at a blocked host
- **WHEN** page 1 is served from an allowed host and its next link points at a blocked address
- **THEN** the fetch fails with the egress guard's refusal, and no request reaches the blocked address

#### Scenario: Next link to another origin
- **WHEN** a next link points at a different, allowed origin
- **THEN** the fetch fails with a curated cross-origin error and no request is sent to that origin

### Requirement: A failure partway through pagination fails the whole fetch

A non-2xx response (including `429`), an unparseable body, an oversize body, a missing root selector, a transport failure or a repeated cursor/next URL on any page after the first SHALL fail the whole fetch. The curated error SHALL name the page number and follow the existing curated error conventions (no credentials). It SHALL surface as the source's `fetchError`, never as a partial result reported as success. No backoff or retry is performed.

#### Scenario: 500 on page 2
- **WHEN** page 2 of a paged source returns `500`
- **THEN** the fetch fails with an error naming page 2 and the status, and no rows from page 1 are returned

#### Scenario: 429 on page 3
- **WHEN** page 3 returns `429`
- **THEN** the fetch fails with an error naming page 3, and no retry is made

### Requirement: Each page response keeps the existing per-response size limit

Each page's 2xx body SHALL be read under the existing per-response limit (Pekko `max-to-strict-bytes`, 8 MiB by default), applied per page. Total ingestion is bounded by the row cap and `maxRequests`.

#### Scenario: Oversize second page
- **WHEN** page 2's body exceeds the per-response limit
- **THEN** the fetch fails with a curated error naming page 2

### Requirement: Only pipeline runs page; create, infer, preview and test read one page

Schema inference on create, `POST /api/sources/infer`, source preview, connection test and the inline pipeline root-schema dry run (not a dry pipeline run, which pages like any run) SHALL each issue exactly one request, whether or not `pagination` is set. A `pagination` object on an infer or test request SHALL be validated (malformed gives `400`) but not followed. For a source with `pagination`, create SHALL NOT state a row count measured from that single page as the source's size, so no row-cap notice is derived from page one.

#### Scenario: Create a paged source
- **WHEN** a source with `pagination` is created against a three-page fixture
- **THEN** exactly one request is made, the schema is inferred from page one, and no row-cap notice is returned

#### Scenario: First page request shape for page and offset styles
- **WHEN** a pipeline run reads a `page`-style source with `pageSize: 2`, and separately an `offset`-style source with `limit: 2`
- **THEN** request one carries the page parameter set to `startPage` and the page-size parameter set to 2 (for offset: `offset=0` and `limit=2`), and each next request increments the page by one (for offset: increases the offset by `limit`)

### Requirement: Paging has a total time budget

A paged fetch SHALL fail with a curated error naming the budget, and return no rows, if all of its pages have not completed within 120 seconds of the first request. This includes the case where the deadline passes during the last page. No page request SHALL be started after the deadline.

#### Scenario: Slow pages exceed the budget
- **WHEN** pages arrive slowly enough that the total budget elapses before the last page
- **THEN** the fetch fails with an error naming the time budget, no rows are returned, and no further page is requested

#### Scenario: Deadline passes during the final page
- **WHEN** the last page completes after the deadline
- **THEN** the fetch fails with the time-budget error, not success

### Requirement: Create and infer warn when an unconfigured response looks paged

When a REST source with no `pagination` is created or inferred, and its single response carries a `Link` header with `rel="next"` or a top-level body field commonly used for paging, the inferred-schema object in the create response and the infer response SHALL carry a non-blocking `pagingNotice` string. Such fields are `next`, `next_url`, `nextUrl`, `next_page`, `nextPage`, `cursor`, `next_cursor`, `nextCursor`, `has_more`, `hasMore`, or a `links` object holding `next`. The notice says the source may be limited to its first page and that paging can be configured. This applies to both connector-based and bare-URL infer requests. Rows, schema, stored config and run results SHALL be unaffected, and no idiom SHALL be chosen automatically.

#### Scenario: Unconfigured source with a Link next header
- **WHEN** a REST source without `pagination` is created against a response carrying `Link: <...>; rel="next"`
- **THEN** the create response's `inferredSchema.pagingNotice` is present, and the stored config has no `pagination`

#### Scenario: Unconfigured infer with a next field
- **WHEN** `POST /api/sources/infer` reads a response whose top-level object has `has_more: true`
- **THEN** the response's `pagingNotice` is present

#### Scenario: Configured or unpaged source gets no notice
- **WHEN** a source is created with `pagination` set, or its response carries no paging signal
- **THEN** no `pagingNotice` is returned, and the response body is byte-identical to today's shape

### Requirement: The agent surface carries paging config and signals

The agent tool surface SHALL forward a REST source's `pagination` unchanged on source creation and on inline pipeline REST roots. It SHALL relay `pagingNotice` and `pagesFetched` to the agent.

#### Scenario: Agent creates a paged source
- **WHEN** the agent's create-REST-source tool is called with a `pagination` object
- **THEN** the backend create request carries the same `pagination` object
