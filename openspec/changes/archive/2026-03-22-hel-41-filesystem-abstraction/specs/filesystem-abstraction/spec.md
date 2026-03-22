## ADDED Requirements

### Requirement: FileSystem trait defines async storage operations
The backend SHALL expose a `FileSystem` trait in `com.helio.infrastructure` with the following methods, all returning `Future`:
- `write(path: String, bytes: Array[Byte]): Future[Unit]`
- `read(path: String): Future[Array[Byte]]`
- `delete(path: String): Future[Unit]`
- `exists(path: String): Future[Boolean]`
- `list(prefix: String): Future[Seq[String]]`

#### Scenario: Trait is defined with correct signatures
- **WHEN** a developer creates a new `FileSystem` implementation
- **THEN** the compiler enforces all five method signatures

### Requirement: LocalFileSystem stores files under a configurable base directory
The `LocalFileSystem` implementation SHALL store all files relative to a base directory resolved from the `HELIO_UPLOADS_DIR` environment variable, defaulting to `./data/uploads` if the variable is not set. The base directory SHALL be created on construction if it does not exist.

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

#### Scenario: Base directory is configurable via environment variable
- **WHEN** `HELIO_UPLOADS_DIR` is set to a custom path
- **THEN** `LocalFileSystem` stores all files under that path

### Requirement: LocalFileSystem is wired into Main
The application entry point SHALL construct a `LocalFileSystem` and hold it for injection into future connectors. No call site outside `Main` SHALL hardcode a local file path.

#### Scenario: Application starts with LocalFileSystem available
- **WHEN** the backend starts
- **THEN** a `LocalFileSystem` instance is constructed using `HELIO_UPLOADS_DIR` and is accessible for dependency injection
