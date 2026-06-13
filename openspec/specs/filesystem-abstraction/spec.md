# filesystem-abstraction Specification

## Purpose
Defines the `FileSystem` trait and its implementations (`LocalFileSystem`, `GcsFileSystem`) that abstract file storage operations in the backend. Enables swapping storage backends (local disk, GCS, etc.) without changing call sites.
## Requirements
### Requirement: FileSystem trait defines async storage operations
The backend SHALL expose a `FileSystem` trait in `com.helio.infrastructure` with the following methods, all returning `Future`:
- `write(path: String, bytes: Array[Byte]): Future[Unit]`
- `read(path: String): Future[Array[Byte]]`
- `delete(path: String): Future[Unit]`
- `exists(path: String): Future[Boolean]`
- `list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage]`

where `ListPage` is a case class defined in `com.helio.infrastructure` with fields `names: Seq[String]` and `nextCursor: Option[String]`.

#### Scenario: Trait is defined with correct signatures
- **WHEN** a developer creates a new `FileSystem` implementation
- **THEN** the compiler enforces all five method signatures including the paginated `list` overload

### Requirement: LocalFileSystem stores files under a configurable base directory
The `LocalFileSystem` implementation SHALL store all files relative to a base directory resolved in the following order:
1. `HELIO_UPLOADS_ROOT` environment variable (primary)
2. `HELIO_UPLOADS_DIR` environment variable (backward-compat alias)
3. `~/.helio/uploads` (home-rooted default)

The base directory SHALL be created on construction if it does not exist. The resolved path SHALL be absolute; a non-absolute result SHALL throw `IllegalStateException`. The directory SHALL be validated as writable at startup; an unwritable directory SHALL throw `IllegalStateException`.

#### Scenario: Write then read round-trips correctly
- **WHEN** `write("foo/bar.csv", bytes)` is called
- **THEN** the bytes are persisted and `read("foo/bar.csv")` returns the same bytes

#### Scenario: Exists returns true after write, false before
- **WHEN** `exists("some/path.csv")` is called before any write
- **THEN** it returns `false`
- **WHEN** `write("some/path.csv", bytes)` succeeds and `exists` is called again
- **THEN** it returns `true`

#### Scenario: Delete removes the file
- **WHEN** a file has been written and `delete("some/path.csv")` is called
- **THEN** `exists("some/path.csv")` returns `false`

#### Scenario: List returns paths matching a prefix
- **WHEN** files `"uploads/a.csv"` and `"uploads/b.csv"` have been written and `list("uploads/")` is called
- **THEN** both relative paths are returned

#### Scenario: Base directory is configurable via HELIO_UPLOADS_ROOT
- **WHEN** `HELIO_UPLOADS_ROOT` is set to a custom absolute path
- **THEN** `LocalFileSystem` stores all files under that path

#### Scenario: HELIO_UPLOADS_DIR used when HELIO_UPLOADS_ROOT is absent
- **WHEN** `HELIO_UPLOADS_ROOT` is not set and `HELIO_UPLOADS_DIR` is set to a custom path
- **THEN** `LocalFileSystem` stores all files under the `HELIO_UPLOADS_DIR` path

#### Scenario: Defaults to home-rooted path when no env var is set
- **WHEN** neither `HELIO_UPLOADS_ROOT` nor `HELIO_UPLOADS_DIR` is set
- **THEN** `LocalFileSystem` uses `~/.helio/uploads` as the base directory

### Requirement: LocalFileSystem is wired into Main
The application entry point SHALL construct a `LocalFileSystem` via `LocalFileSystem.fromEnv()` when `HELIO_UPLOADS_BACKEND` is `local` or not set, and inject it as the `FileSystem` dependency. When `HELIO_UPLOADS_BACKEND=gcs`, `GcsFileSystem.fromEnv()` is used instead.

#### Scenario: Application starts with LocalFileSystem when backend unset
- **WHEN** `HELIO_UPLOADS_BACKEND` is not set
- **THEN** a `LocalFileSystem` instance is constructed using `HELIO_UPLOADS_ROOT` resolution and is injected as `FileSystem`

#### Scenario: Application starts with GcsFileSystem when backend=gcs
- **WHEN** `HELIO_UPLOADS_BACKEND=gcs` and `HELIO_UPLOADS_BUCKET` are set
- **THEN** a `GcsFileSystem` instance is constructed and injected as `FileSystem`

