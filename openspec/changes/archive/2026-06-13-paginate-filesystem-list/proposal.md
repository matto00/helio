## Why

`FileSystem.list` today materialises every matching object name into a Scala `Seq` in one shot. As v1.4 adds PDFs, markdown, and images through the same abstraction (HEL-246), a single prefix can easily contain thousands of entries, risking OOM on Cloud Run and unacceptable first-byte latency. Pagination is the standard fix.

## What Changes

- **FileSystem trait** — replace `list(prefix): Future[Seq[String]]` with a paginated overload using an explicit cursor:
  `list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage]`
  where `ListPage(names: Seq[String], nextCursor: Option[String])` carries the page results and an opaque token for the next call.
- **GcsFileSystem** — implement `list` with `Page<Blob>.getNextPageToken` / `getNextPage` instead of `iterateAll()`, so only one page of blobs is fetched per call.
- **LocalFileSystem** — implement `list` lazily using `Files.newDirectoryStream` / `Files.walk` filtered to the first `pageSize` entries from a given cursor offset, rather than collecting the full directory tree up front.
- **Tests** — add single-page, multi-page, and empty-prefix test cases for both implementations.

### API Shape Decision: Option A (explicit cursor) over Option B (streaming Source)

There are no callers of `FileSystem.list` outside the FileSystem module (confirmed by codebase search), so migration risk is zero and no backward-compat shim is needed. The explicit cursor shape was chosen over Pekko `Source` because:
1. Current and anticipated callers are HTTP endpoints that need a `Future[Result]` — they would have to `Source.runWith(Sink.seq)` to collect a stream, adding round-trip complexity with no benefit.
2. HTTP pagination is naturally page-oriented: the client sends `?cursor=<token>&pageSize=N`, the server returns one page. Explicit cursors map directly to this protocol.
3. A streaming `Source` is a better fit for pipeline stages that process every object, but no such callers exist today. That shape can be added later (it does not conflict with the cursor API on the trait).

## Capabilities

### New Capabilities

- `filesystem-list-pagination`: Paginated list API (`ListPage` model + cursor parameters) for `FileSystem.list`, covering both the GCS and local backends.

### Modified Capabilities

- `filesystem-abstraction`: Requirement for `list(prefix): Future[Seq[String]]` changes to the cursor-based `list(prefix, cursor, pageSize): Future[ListPage]` signature.
- `gcs-filesystem`: The `list` scenario changes from using `iterateAll()` to single-page `Page<Blob>` access.

## Impact

- `FileSystem.scala` — trait signature change
- `GcsFileSystem.scala` — `list` implementation updated to page-based GCS SDK calls
- `LocalFileSystem.scala` — `list` implementation updated to lazy directory streaming
- `GcsFileSystemSpec.scala` — existing list tests updated + multi-page + empty tests added
- `LocalFileSystemSpec.scala` — existing list tests updated + multi-page + empty tests added
- No Flyway migrations needed (infrastructure only)
- No frontend changes needed

## Non-goals

- HTTP API endpoint for listing objects (not exposed to clients)
- Per-user quota enforcement
- Server-side filtering beyond prefix
- Streaming `Source` API (deferred to a follow-on if pipeline callers emerge)
