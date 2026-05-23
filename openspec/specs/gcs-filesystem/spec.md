# gcs-filesystem Specification

## Purpose
TBD - created by archiving change gcs-filesystem-backend. Update Purpose after archive.
## Requirements
### Requirement: GcsFileSystem implements FileSystem using GCS Java SDK
The backend SHALL provide a `GcsFileSystem` class in `com.helio.infrastructure` that implements the `FileSystem` trait, storing and retrieving files as objects in a GCS bucket. All operations SHALL be async (`Future`-wrapped) and SHALL use the `com.google.cloud:google-cloud-storage` Java SDK with Application Default Credentials.

#### Scenario: Write stores object in GCS bucket
- **WHEN** `write("datasources/abc/data.csv", bytes)` is called on a `GcsFileSystem`
- **THEN** the bytes are stored as GCS object `datasources/abc/data.csv` in the configured bucket

#### Scenario: Read retrieves object bytes from GCS bucket
- **WHEN** `read("datasources/abc/data.csv")` is called and the object exists
- **THEN** the bytes of the object are returned

#### Scenario: Read fails if object does not exist
- **WHEN** `read("datasources/abc/missing.csv")` is called and no such object exists
- **THEN** the `Future` fails with a `java.nio.file.NoSuchFileException` (or equivalent)

#### Scenario: Exists returns true when object is present
- **WHEN** an object has been written and `exists("datasources/abc/data.csv")` is called
- **THEN** it returns `true`

#### Scenario: Exists returns false when object is absent
- **WHEN** no object at a given path has been written and `exists` is called
- **THEN** it returns `false`

#### Scenario: Delete removes object from GCS
- **WHEN** an object exists and `delete("datasources/abc/data.csv")` is called
- **THEN** `exists("datasources/abc/data.csv")` returns `false`

#### Scenario: Delete is idempotent when object is absent
- **WHEN** `delete` is called for an object that does not exist
- **THEN** the `Future` completes successfully without error

#### Scenario: List returns object names matching a prefix
- **WHEN** objects `"datasources/abc/data.csv"` and `"datasources/abc/schema.json"` exist and `list("datasources/abc/")` is called
- **THEN** both relative object names are returned

### Requirement: GcsFileSystem.fromEnv selects bucket from HELIO_UPLOADS_BUCKET
`GcsFileSystem` SHALL expose a companion method `fromEnv()` that reads `HELIO_UPLOADS_BUCKET` from the environment. If the variable is absent or empty, the method SHALL throw `IllegalStateException` with a descriptive message and log an error.

#### Scenario: Bucket env var present
- **WHEN** `HELIO_UPLOADS_BUCKET=helio-uploads-prod` is set and `GcsFileSystem.fromEnv()` is called
- **THEN** a `GcsFileSystem` configured for `helio-uploads-prod` is returned

#### Scenario: Bucket env var absent
- **WHEN** `HELIO_UPLOADS_BUCKET` is not set and `GcsFileSystem.fromEnv()` is called
- **THEN** an `IllegalStateException` is thrown with a message indicating the missing variable

### Requirement: GcsFileSystem selected by HELIO_UPLOADS_BACKEND=gcs at startup
`Main.scala` SHALL read `HELIO_UPLOADS_BACKEND` at startup and construct `GcsFileSystem.fromEnv()` when the value is `gcs`. When the value is `local` or unset, `LocalFileSystem.fromEnv()` SHALL be constructed instead. The selected instance SHALL be injected into `ApiRoutes` as the `FileSystem` dependency.

#### Scenario: Cloud Run production config selects GCS
- **WHEN** `HELIO_UPLOADS_BACKEND=gcs` and `HELIO_UPLOADS_BUCKET=helio-uploads-prod` are set at startup
- **THEN** file writes and reads are routed through `GcsFileSystem`

#### Scenario: Local dev without backend env var uses LocalFileSystem
- **WHEN** `HELIO_UPLOADS_BACKEND` is not set
- **THEN** file writes and reads are routed through `LocalFileSystem`

#### Scenario: Unknown backend value fails fast
- **WHEN** `HELIO_UPLOADS_BACKEND=s3` (unsupported value) is set
- **THEN** the application exits at startup with an error message identifying the unsupported backend value

