# HEL-1120: LocalFileSystemSpec leaks a /tmp/helio-fs-test* dir on every sbt test run

## Description

`backend/src/test/scala/com/helio/infrastructure/storage/LocalFileSystemSpec.scala:19` creates `Files.createTempDirectory("helio-fs-test")` as a class field and never removes it (no `afterAll`), so **every** `sbt test` run leaks one directory tree into `/tmp`. Lines ~303 and ~312 (`helio-from-env-create`, `helio-from-env-compat`) look like they may leak the same way — verify.

**Impact (2026-09-10):** `/tmp` (a tmpfs capped at 1,048,576 inodes) hit 100% during a batch run. At that point every `mktemp` and every Claude Code shell call on the machine failed with `ENOSPC`, and two delivery lanes stalled mid-cycle. About 245 `helio-fs-test*` trees were among the residue, alongside leaked mktemp dirs from the Concertino test suite and a roughly 148k-inode `jest_rs` cache.

## Acceptance Criteria

* Every temp dir the spec creates is deleted in `afterAll` (or the equivalent), including on test failure.
* Verified by counting `/tmp/helio-*` entries before and after a full `sbt test`: the count must not grow.
* Sweep the other backend and frontend specs for `createTempDirectory`/`mkdtemp` calls that have no teardown, and list what was found even where nothing needed changing.

## Driver-supplied guidance (HEL-1120 delivery, 2026-09-11/12)

- Premise verified against `main` (dcc59552): `LocalFileSystemSpec` has 0 `afterAll` occurrences; 47 `createTempDirectory` call sites exist across 30+ files under `backend/src/test/scala`. Not all necessarily leak — triage each, and list findings even where nothing needed changing.
- Precedent to copy: Concertino's CON-181 fix — (a) a shared helper every test routes through, (b) a guard test that fails if the suite leaves new entries behind. The guard is what prevents recurrence; a one-off cleanup alone does not satisfy this ticket's intent.
- Build the Scala/ScalaTest equivalent: a shared trait/fixture (e.g. `TempDirectorySupport` with `afterAll` cleanup) plus a check that fails when a spec creates a temp dir outside the helper. If a full before/after inode count around `sbt test` is too slow for CI, a static guard (every `createTempDirectory` call site routes through the helper) plus a measured before/after count recorded in the PR body is acceptable — be explicit about which was built and what it does/doesn't prove.
- Evidence required: count `/tmp/helio-*` (and any other prefixes found) before/after a full `sbt test` — must not grow. Demonstrate the guard is failable: add a bare `createTempDirectory` call in a scratch commit, show the guard goes red, revert, and name the mutation in the PR body.
- Hazards: do not "fix" this by pointing tests at a directory that never gets cleaned. Watch for specs that deliberately keep a temp dir alive across the whole suite (e.g. shared fixtures) — those need case-by-case judgment, not blanket teardown. On ENOSPC, stop and report — never clean `/tmp` without approval.
- No DB migration is expected for this ticket. If one becomes necessary, the next free version is V107 — get explicit sign-off before committing one.
- PR body must list each AC bullet with its evidence.
