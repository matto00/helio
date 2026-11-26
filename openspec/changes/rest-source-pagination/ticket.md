# HEL-1013: REST sources cannot follow pagination, so any paged API is silently limited to its first page

## Description

`RestApiConnectorDriver` has no pagination support of any kind. A REST source issues exactly one request and keeps whatever that returns. For any paged API the source is permanently limited to page one, and nothing in the product says so: nothing is truncated in the engine's sense, so `truncatedReads` is legitimately empty, and the user sees a plausible dashboard built on a fraction of the data.

## Scope

1. Let a REST source describe its paging idiom: page/per_page, offset/limit, opaque cursor in the response body, RFC 5988 `Link: rel="next"` headers, and (from HEL-591) `next_url`: the absolute URL of the next page read from a path in the response body.
2. Follow pages up to the effective row cap, then stop and report truncation through the existing `truncatedReads` mechanism (HEL-861/890/873). Pagination must not bypass the cap.
3. Bound the page-follow loop independently (max requests). The SSRF egress guard (HEL-879/952) applies to every followed URL.
4. When a source has no paging config and the response looks paged, decide deliberately whether to surface that; do not guess an idiom.

## Acceptance criteria

- A REST source against a paged fixture retrieves rows from more than one page.
- A source with no paging configured behaves exactly as today (verified, not assumed).
- Paging stops at the effective row cap and reports truncation through `truncatedReads`, distinguishable from a single-request truncation.
- The request-count bound is enforced and its breach is loud, not a silent stop.
- Every followed URL passes the SSRF egress guard, proven by a test where page 2's `next` points at a blocked host and the fetch is refused.
- Mutation-proven, red arm confirmed reachable first: disable page-following and show the multi-page test goes red.
- (HEL-591) A failure partway through pagination yields a curated `fetchError` (HEL-468 envelope), not a partial result reported as success.

## Notes

- Distinct from HEL-1012 (per-source row cap). Does not fix the Sleeper single-document case.
- Related: HEL-597 (429 backoff), HEL-879/HEL-952 (SSRF), HEL-1877 (bounded body reads, merged).
