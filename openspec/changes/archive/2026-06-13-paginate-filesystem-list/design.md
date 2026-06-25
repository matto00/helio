## Context

`FileSystem.list(prefix: String): Future[Seq[String]]` was introduced in HEL-41 and refined with GCS in HEL-125. Both implementations today load every matching object name into a `Seq` before returning. With v1.4 uploading PDFs, markdown, and images (HEL-246) through the same abstraction, large prefixes will materialise unbounded heaps and produce long latencies. There are currently **no call sites** of `FileSystem.list` outside the FileSystem module itself (confirmed via `grep -rn '.list(' backend/src` — only `PermissionRoutes.permissionService.list` was found, which is unrelated).

Current trait signature: `def list(prefix: String): Future[Seq[String]]`

## Goals / Non-Goals

**Goals:**
- Replace `list` on the trait with a cursor-based paginated form that returns at most `pageSize` names per call.
- GCS: use `Storage.list(...).getNextPageToken` / `page.getNextPage` to fetch one GCS page per call.
- Local: use `Files.newDirectoryStream` or a lazy `Files.walk` filtered to the first `pageSize` entries past a cursor offset.
- Test coverage: single page, multi-page, empty prefix for both implementations.

**Non-Goals:**
- Streaming Pekko `Source` API (no pipeline callers exist; deferred to a follow-on).
- Backward-compat `listAll` shim (zero external callers; no migration risk).
- HTTP pagination endpoint for clients.
- Per-user quota enforcement.

## Decisions

### D1: Option A (explicit cursor) over Option B (streaming Source)

Current callers need `Future[Result]` — a `Source` would require every call site to `.runWith(Sink.seq)`, adding complexity for zero benefit. HTTP pagination is page-oriented by nature: the client sends `?cursor=<token>` and gets one `ListPage` back. A `Source` variant can be added later without conflicting.

### D2: `ListPage` case class as the return type

```scala
case class ListPage(names: Seq[String], nextCursor: Option[String])
```

`nextCursor: None` signals last (or only) page. The cursor is opaque to callers — GCS uses the SDK's page token string; LocalFileSystem uses an integer offset encoded as a decimal string.

### D3: Default `pageSize = 1000`

Matches the GCS SDK's default page size. Callers that want a different page size pass an explicit value. 1000 names × ~100 chars avg ≈ 100 KB per page — well within Cloud Run's heap budget.

### D4: LocalFileSystem cursor is an integer offset

GCS provides a natural opaque cursor token. Local has no equivalent, so we encode the current directory-walk offset as a decimal string (e.g., `"500"`). The implementation collects the full sorted name list once per call with `Files.walk`, skips `cursor.toInt` entries, then takes `pageSize` entries. This avoids holding a long-lived stream between calls (which would require session state), at the cost of re-walking the directory each page. Acceptable because: local is dev/test only, and directory walks of realistic local dev sets (hundreds, not millions) are cheap.

An alternative (hold a lazy iterator in a `Map[cursor → position]`) was rejected: it requires session state, complicates thread safety, and provides marginal benefit for a dev-only backend.

**Edge case — prefix resolves to a file (not a directory):** The current `LocalFileSystem.list` has a branch for when `prefix` resolves directly to a file (line 53–57). Under the new design, this case SHALL be preserved: when `prefix` resolves to a regular file (not a directory), the first call (`cursor = None`) returns `ListPage(Seq(relativeName), None)` and any subsequent call with a cursor returns `ListPage(Seq.empty, None)`. This preserves existing behaviour without ambiguity and is transparent to callers (who get a single-name first page with no cursor for further pagination).

### D5: `cursor = None` means "start from beginning"

Default value `cursor: Option[String] = None` and `pageSize: Int = 1000` on the trait keep all existing call sites (none currently exist) compile-compatible if they are added in the future — they can call `list(prefix)` and get the first page.

## Risks / Trade-offs

- [LocalFileSystem re-walks on every page] → Acceptable for dev/test; local is never used in production.
- [Opaque cursor type change between backends] → Callers must treat cursor as opaque and not parse it; enforced by design (it's a `String`).
- [Test for multi-page GCS requires mocking `Page.getNextPage`] → Standard Mockito chaining; existing test helpers already use `mock(classOf[Page[Blob]])`.

## Migration Plan

No migration required: zero callers of `FileSystem.list` outside the module. The trait change is complete replacement, not augmentation.

## Planner Notes

Self-approved: this is a contained infrastructure change to a module with zero external callers. No external dependencies, no breaking API changes visible to clients, no architectural departures. The two shapes (cursor vs. Source) were evaluated; cursor was chosen by the ticket guidance and the codebase's current call-site pattern.
