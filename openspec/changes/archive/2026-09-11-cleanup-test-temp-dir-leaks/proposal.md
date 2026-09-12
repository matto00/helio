## Why

`LocalFileSystemSpec` (and 58 other temp-file/dir creation call sites, across four spellings, in 39 backend
test files) leak temp directory trees into `/tmp` with no teardown. `/tmp` is a
tmpfs capped at 1,048,576 inodes; it hit 100% twice on 2026-09-10/11, breaking every
`mktemp` and shell call on the machine and stalling two delivery lanes mid-cycle.

## What Changes

- Add a shared `TempDirectorySupport` trait (ScalaTest `BeforeAndAfterAll`-based) that
  creates and registers temp directories and deletes them (recursively) in `afterAll`,
  including on test failure.
- Migrate `LocalFileSystemSpec` (all `createTempDirectory` call sites: the class-field
  dir plus the `helio-from-env-abs`/`-create`/`-compat` per-test dirs) onto the shared
  helper.
- Sweep the other 58 call sites (all four spellings: `Files.createTempDirectory`,
  `Files.createTempFile`, the FQN `java.nio.file.Files.*` forms, and `java.io.File.createTempFile`/
  `File.createTempFile`) across `backend/src/test/scala`; migrate any that leak, and record
  findings for any that don't need a change (e.g. specs that intentionally keep a temp dir alive
  for the suite's own lifetime, or already have their own `finally`/`afterAll`).
- Add a guard (static grep-based check, run as part of the backend test/CI gate, with its own
  `:selftest`) that fails when a spec calls any of the four temp-file/dir creation spellings
  above directly instead of routing through the shared helper.
- No production/runtime code changes; no API/contract changes; no DB migration.

## Capabilities

### New Capabilities
(none — this is test-infrastructure only, no spec-level behavior changes)

### Modified Capabilities
(none)

## Impact

- `backend/src/test/scala/com/helio/testkit/TempDirectorySupport.scala` (new)
- `backend/src/test/scala/com/helio/infrastructure/storage/LocalFileSystemSpec.scala` (migrated)
- Any other backend test file found to leak temp dirs during the sweep (migrated)
- A new guard script/check wired into an existing gating job (e.g. `check:scala-quality`
  or a dedicated `check:test-temp-dir-hygiene`), plus `.husky/pre-commit` parity per
  `check:precommit-ci-parity` if the guard is added there.
- No frontend, API, or database changes.

## Non-goals

- Cleaning up already-leaked `/tmp/helio-*` residue on this machine (owner-approved,
  out of band).
- Migrating frontend/Playwright temp-file usage (ticket AC calls for a sweep/listing,
  not necessarily a fix, and no leak was found there in the premise check).
