## Why

CSV uploads and other user file storage need a place to land. Hardcoding local paths makes future migration to cloud blob storage (GCS, S3, Azure Blob) a codebase-wide refactor; wrapping I/O behind a trait from the start reduces that to a config change.

## What Changes

- Introduce a `FileSystem` trait in `com.helio.infrastructure` with five async operations: `write`, `read`, `delete`, `exists`, `list`
- Add `LocalFileSystem` implementing the trait against a configurable base directory on disk
- Wire `LocalFileSystem` into `Main` so downstream connectors (starting with HEL-45 CSV upload) receive it via constructor injection
- Base directory is read from the `HELIO_UPLOADS_DIR` environment variable (default `./data/uploads`)

## Capabilities

### New Capabilities

- `filesystem-abstraction`: `FileSystem` trait + `LocalFileSystem` implementation; configurable base path; unit-tested against a temp directory

### Modified Capabilities

<!-- none — no existing specs change behavior -->

## Impact

- **New files**: `backend/src/main/scala/com/helio/infrastructure/FileSystem.scala`, `LocalFileSystem.scala`
- **New test**: `backend/src/test/scala/com/helio/infrastructure/LocalFileSystemSpec.scala`
- **Modified**: `backend/src/main/scala/com/helio/app/Main.scala` — instantiate and hold `LocalFileSystem`
- **No API changes**, no frontend changes, no DB migrations
