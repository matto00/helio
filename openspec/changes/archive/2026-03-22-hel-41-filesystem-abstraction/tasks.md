## 1. FileSystem Trait

- [x] 1.1 Create `backend/src/main/scala/com/helio/infrastructure/FileSystem.scala` — define the `FileSystem` trait with `write`, `read`, `delete`, `exists`, `list` methods returning `Future`

## 2. LocalFileSystem Implementation

- [x] 2.1 Create `backend/src/main/scala/com/helio/infrastructure/LocalFileSystem.scala` — implement `FileSystem` using `java.nio.file`, reading base dir from `HELIO_UPLOADS_DIR` env var (default `./data/uploads`), creating base dir on construction
- [x] 2.2 Wrap all disk I/O in `scala.concurrent.blocking {}` to avoid starving the Akka dispatcher
- [x] 2.3 Ensure `write` creates parent directories before writing bytes
- [x] 2.4 Implement `list(prefix)` to return relative paths (stripped of base dir) matching the given prefix

## 3. Wiring

- [x] 3.1 Instantiate `LocalFileSystem` in `Main.scala` and hold it as a `val` available for future connector injection

## 4. Tests

- [x] 4.1 Create `backend/src/test/scala/com/helio/infrastructure/LocalFileSystemSpec.scala` using a `java.nio.file.Files.createTempDirectory` temp dir as the base
- [x] 4.2 Test `write` then `read` round-trip returns identical bytes
- [x] 4.3 Test `exists` returns `false` before write, `true` after
- [x] 4.4 Test `delete` removes the file (`exists` returns `false` after)
- [x] 4.5 Test `list(prefix)` returns all matching relative paths

## 5. Verification

- [x] 5.1 Run `sbt test` in `backend/` — all tests pass
