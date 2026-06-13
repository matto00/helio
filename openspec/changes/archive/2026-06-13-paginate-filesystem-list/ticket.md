# HEL-282: Paginate FileSystem.list for large prefixes

## Context

`FileSystem.list(prefix: String): Future[Seq[String]]` returns every object name under a prefix in one shot. Today this is fine — CSV uploads are sparse and per-user prefixes stay small. v1.4 expands the surface significantly: PDFs, plain text, markdown, and images all flow through the same abstraction (see HEL-246 and the project epics).

Once a user has thousands of unstructured objects under a single prefix, the current implementation will:

* For `GcsFileSystem`: page through GCS internally via `iterateAll()`, materializing the whole result set into a Scala `Seq` in memory before returning. This is wasteful in latency and heap, and risks OOM on Cloud Run for power users.
* For `LocalFileSystem`: similar — walks the directory and returns every entry.

## Proposal

Replace (or augment) the current signature with a paginated API. Two shapes worth considering — pick one in the design step:

**Option A — explicit cursor:**

```scala
case class ListPage(names: Seq[String], nextCursor: Option[String])
def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage]
```

**Option B — streaming `Source`:**

```scala
def list(prefix: String): Source[String, NotUsed]
```

(Pekko Streams; backpressure handled by consumer.)

Streaming is nicer for transformation pipelines; explicit pagination is nicer for HTTP responses where the client paginates. We may want both.

## Acceptance Bar

* `FileSystem` trait exposes a paginated/streaming list API
* `GcsFileSystem` uses `Page<Blob>.getNextPageToken` / `Page.getNextPage` instead of `iterateAll()`
* `LocalFileSystem` returns lazily (no full directory walk up front)
* Callers updated; backward-compatible shim (`listAll`) provided only if migration risk is high
* Tests cover: single page, multi-page, empty prefix
* Benchmark or sanity check: 10k objects under a prefix returns first page in < 200ms

## Related

* HEL-125 — introduced `GcsFileSystem` (this ticket addresses a known scale concern in that implementation)
* HEL-41 — original `FileSystem` trait
* HEL-246 — image upload (will be a high-volume caller)

## Out of Scope

* Per-user quota enforcement (separate ticket if needed)
* Server-side filtering beyond prefix (also a separate concern)

## Note for Evaluator

This is a **backend-only** change. There is no UI to walk through. The evaluator should NOT block on UI verification — backend tests and build are the verification gates.
