## MODIFIED Requirements

### Requirement: GcsFileSystem implements FileSystem using GCS Java SDK
The backend SHALL provide a `GcsFileSystem` class in `com.helio.infrastructure` that implements the `FileSystem` trait, storing and retrieving files as objects in a GCS bucket. All operations SHALL be async (`Future`-wrapped) and SHALL use the `com.google.cloud:google-cloud-storage` Java SDK with Application Default Credentials.

The `list` method SHALL use the GCS SDK's page-based API (`Storage.list` returns a `Page<Blob>`). For the first call (`cursor = None`), `storage.list(bucketName, BlobListOption.prefix(prefix), BlobListOption.pageSize(pageSize))` SHALL be used. For subsequent calls (`cursor = Some(token)`), `BlobListOption.pageToken(token)` SHALL be added to the options, AND `BlobListOption.pageSize(pageSize)` SHALL also be included. The `nextCursor` SHALL be `Option(page.getNextPageToken).filter(_.nonEmpty)`.

The implementation SHALL NOT call `iterateAll()` on any `Page<Blob>` instance.

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

#### Scenario: List single page returns object names and no cursor
- **WHEN** two objects match the prefix and `list("datasources/abc/", pageSize = 100)` is called
- **THEN** both names are returned and `nextCursor` is `None`

#### Scenario: List with more objects than pageSize returns cursor
- **WHEN** the GCS page has a non-empty next-page token
- **THEN** `nextCursor` is `Some(token)` where `token` matches the SDK's `getNextPageToken`

#### Scenario: List with cursor fetches next page
- **WHEN** `list(prefix, cursor = Some(token), pageSize = N)` is called
- **THEN** `BlobListOption.pageToken(token)` and `BlobListOption.pageSize(N)` are passed to `Storage.list`

#### Scenario: List returns empty page for unmatched prefix
- **WHEN** no objects match the given prefix
- **THEN** `names` is empty and `nextCursor` is `None`
