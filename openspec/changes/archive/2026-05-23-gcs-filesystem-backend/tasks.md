## 1. Backend — Dependency

- [x] 1.1 Add `"com.google.cloud" % "google-cloud-storage" % "2.40.1"` to `libraryDependencies` in `backend/build.sbt`

## 2. Backend — GcsFileSystem Implementation

- [x] 2.1 Create `backend/src/main/scala/com/helio/infrastructure/GcsFileSystem.scala` implementing `FileSystem` with `write`, `read`, `delete`, `exists`, and `list` using the GCS Java SDK
- [x] 2.2 Implement `GcsFileSystem.fromEnv()` companion method that reads `HELIO_UPLOADS_BUCKET`; throws `IllegalStateException` with descriptive message if absent
- [x] 2.3 Add `list(prefix)` using GCS `listObjects` with prefix filter; return object names as relative strings (full GCS object name = relative path)

## 3. Backend — Startup Wiring

- [x] 3.1 In `Main.scala`, replace `LocalFileSystem.fromEnv()` call with a match on `HELIO_UPLOADS_BACKEND`: `local` or unset → `LocalFileSystem.fromEnv()`, `gcs` → `GcsFileSystem.fromEnv()`, unknown → log error and `system.terminate()`
- [x] 3.2 Update `Main.scala` import to include `GcsFileSystem` alongside `LocalFileSystem`

## 4. Backend — Documentation

- [x] 4.1 Add `HELIO_UPLOADS_BACKEND` and `HELIO_UPLOADS_BUCKET` entries to `backend/.env.example` with comments explaining values and when each is required
- [x] 4.2 Update `CLAUDE.md` production env-vars table to document `HELIO_UPLOADS_BACKEND` and `HELIO_UPLOADS_BUCKET`

## 5. Tests

- [x] 5.1 Add a `GcsFileSystemSpec` unit test that mocks the GCS `Storage` client and verifies `write`, `read`, `exists`, `delete`, and `list` delegate correctly to the SDK
- [x] 5.2 Verify existing `LocalFileSystem` tests still pass (`sbt test`)
