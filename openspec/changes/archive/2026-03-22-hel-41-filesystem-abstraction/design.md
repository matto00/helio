## Context

The backend currently has no abstraction for file I/O — any connector that persists user-uploaded files (e.g., CSV) would have to hardcode paths. Introducing a `FileSystem` trait now gives the infrastructure layer a clean seam for storage operations and avoids a future scatter-shot refactor when migrating to cloud blob storage.

The app already uses manual dependency injection (constructor args passed from `Main`), so the trait fits naturally into the existing pattern without introducing a DI framework.

## Goals / Non-Goals

**Goals:**
- Define a `FileSystem` trait in `com.helio.infrastructure` covering the five core operations needed by connectors
- Ship a `LocalFileSystem` implementation backed by a configurable on-disk base directory
- Read the base directory from `HELIO_UPLOADS_DIR` env var (fallback: `./data/uploads`)
- Provide a unit test suite using a temp directory — no real filesystem side-effects in CI
- Expose the instance from `Main` so future connectors can receive it via constructor

**Non-Goals:**
- Cloud implementations (GCS, S3, Azure) — trait only; implementations in future tickets
- Content-addressable or versioned storage
- Access control / signed URLs
- Integration with Akka Streams or multipart HTTP body parsing (HEL-45)

## Decisions

**Package: `com.helio.infrastructure`**
All I/O adapters live here (Database, DashboardRepository, PanelRepository). FileSystem fits the same layer. Alternative — a separate `com.helio.storage` package — would be premature until there are multiple storage concerns.

**Scala `Future`-based API (not `IO` / `ZIO`)**
The rest of the codebase uses `Future` throughout (Akka HTTP, Slick). Introducing an effect system for one abstraction would create inconsistency. `Future` wraps blocking `java.nio.file` calls inside `blocking { }` on the ExecutionContext so the Akka dispatcher is not starved.

**`blocking {}` for disk I/O**
`scala.concurrent.blocking` signals to the thread pool that the enclosed code may block, allowing the pool to spawn extra threads. This keeps Akka's default dispatcher healthy for `Future`-based code without needing a dedicated thread pool wired in at this stage.

**`list(prefix)` returns relative paths**
Returning paths relative to the base directory avoids leaking the base path into call sites and keeps semantics stable when the base changes.

## Risks / Trade-offs

- **Blocking I/O on the global EC** → Mitigated by `blocking {}` wrapper; acceptable for low-volume file ops at this stage. Future work: wire a dedicated IO thread pool if needed.
- **Base dir not created at startup** → `LocalFileSystem` creates the base directory on construction; `write` creates parent directories before writing. Reduces runtime errors.
- **No atomicity on write** → Files are written directly; no temp-file-then-rename. Acceptable for current usage (CSV ingestion, not high-concurrency writes).
