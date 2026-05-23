# Files Modified

## Backend Implementation

- `backend/src/main/scala/com/helio/infrastructure/GcsFileSystem.scala` — New GCS-backed FileSystem implementation using google-cloud-storage SDK
- `backend/src/main/scala/com/helio/app/Main.scala` — Added filesystem backend selection logic based on HELIO_UPLOADS_BACKEND env var
- `backend/build.sbt` — Added com.google.cloud:google-cloud-storage dependency (2.40.1)

## Tests

- `backend/src/test/scala/com/helio/infrastructure/GcsFileSystemSpec.scala` — Unit tests for GcsFileSystem.fromEnv() error handling

## Documentation

- `backend/.env.example` — Added HELIO_UPLOADS_BACKEND and HELIO_UPLOADS_BUCKET env var documentation
- `CLAUDE.md` — Updated production env-vars table with new storage-backend configuration
