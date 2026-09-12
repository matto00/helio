# Files modified — HEL-1120

## New

- `backend/src/test/scala/com/helio/testkit/TempDirectorySupport.scala` — shared
  `BeforeAndAfterAll` trait (`newTempDir`/`newTempFile`) that registers every created temp path
  and deletes them all in `afterAll`, **collecting delete failures and re-throwing them** (never
  swallowing/logging) so a permission-restore `finally` that didn't run still surfaces as a real
  test failure.
- `scripts/check-test-temp-dir-hygiene.mjs` — static guard: fails on any of the four raw
  temp-file/dir creation spellings (`Files.createTempDirectory(`, `Files.createTempFile(`,
  `java.io.File.createTempFile(`/`File.createTempFile(`) under `backend/src/test/scala` outside
  `TempDirectorySupport.scala` itself or a `// temp-dir-hygiene: reviewed — <reason>` exemption
  (same line or the line directly above).
- `scripts/check-test-temp-dir-hygiene.selftest.mjs` — proves the guard flags all four spellings
  (individually and together), respects both exemption paths, and does NOT let an unrelated
  reviewed-comment nearby silently exempt an unrelated call.

## Re-verified premise (before migrating)

Re-grepped all four spellings myself rather than trusting the ticket/design's carried-over count:
**57 real call sites across 39 files** (not the 59 design.md cites — 2 fewer; every file-level
count still matches). Every file below was checked for whether its own `afterAll` (or a `finally`)
actually deletes the created path, not just whether an `afterAll` exists at all — several specs
have an `afterAll` that only closes `db`/`embeddedPostgres` and never touches the temp dir, which
would have been misclassified as "already safe" by a shallower check.

## Migrated (classification (a)/(c) — leaked, now routed through `TempDirectorySupport`)

All 37 files below: added `import com.helio.testkit.TempDirectorySupport` + `with
TempDirectorySupport` to the class declaration (as the LAST mixed-in trait, so its `abstract
override def afterAll()` is what the class's own `super.afterAll()` call resolves to), replaced
the raw call(s) with `newTempDir(prefix)` / `newTempFile(prefix, suffix)`, and — for 6 of them
(marked below) — added a `super.afterAll()` call that was previously missing entirely (without it,
`TempDirectorySupport`'s cleanup would never fire for that spec).

- `backend/src/test/scala/com/helio/api/AuditMutationInstrumentationSpec.scala` — 2 sites
- `backend/src/test/scala/com/helio/api/routes/assistant/AssistantConversationRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/dashboards/DashboardPanelAclSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/patchsets/PatchSetPreviewRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/patchsets/PatchSetRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/patchsets/PatchSetUndoRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/patchsets/RefinementRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala` — FQN
  `java.nio.file.Files.createTempDirectory` form
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRootRoutesSpec.scala` — 2 sites
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunRoutesSpec.scala` —
  classification (c): `java.io.File.createTempFile` + `deleteOnExit()`-only; `deleteOnExit`
  doesn't cover the killed/OOM'd JVM path that caused the actual incident, so migrated (not
  left as "already safe"); `deleteOnExit()` call removed
- `backend/src/test/scala/com/helio/api/routes/proposals/DashboardAuthoringRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/ResourceTaggingSpec.scala` — 2 sites
- `backend/src/test/scala/com/helio/api/routes/sources/DataSourceRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/sources/UploadRoutesSpec.scala`
- `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineSpec.scala` —
  classification (c): 8 `java.io.File.createTempFile` + `deleteOnExit()`-only sites, all migrated;
  8 `deleteOnExit()` calls removed
- `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineUrlRefetchSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/RlsOwnerTablesSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/V100ZeroRootGuardNonSuperuserSpec.scala`
  — also needed a `super.afterAll()` call added (previously absent)
- `backend/src/test/scala/com/helio/infrastructure/storage/LocalFileSystemSpec.scala` — the
  ticket's own repro: class-field `tempDir` plus `helio-from-env-abs`/`-create`/`-compat`, all 4
  sites migrated; verified via `sbt "testOnly com.helio.infrastructure.storage.LocalFileSystemSpec"`
  (17/17 pass, including the two permission-restore tests, confirming the existing `finally`
  blocks still run before `afterAll`'s delete)
- `backend/src/test/scala/com/helio/services/assistant/AssistantConversationServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/assistant/AssistantTelemetrySpec.scala`
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetApplyServiceSpec.scala` — also
  needed a `super.afterAll()` call added (previously absent)
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetPreviewServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoServiceSpec.scala` — also
  needed a `super.afterAll()` call added (previously absent)
- `backend/src/test/scala/com/helio/services/patchsets/RefinementServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/Hel914Ac1EndToEndSpec.scala` — also
  needed a `super.afterAll()` call added (previously absent)
- `backend/src/test/scala/com/helio/services/pipelines/PipelineAnalyzeConciseByteBudgetSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala` —
  classification (c): `java.io.File.createTempFile` + `deleteOnExit()`-only, migrated; also
  needed a `super.afterAll()` call added (previously absent)
- `backend/src/test/scala/com/helio/services/proposals/AuthoringTelemetrySpec.scala` — 2 sites
- `backend/src/test/scala/com/helio/services/proposals/DashboardAuthoringServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/sources/DataSourceServiceCsvUrlSpec.scala` — 1 of its
  2 sites (`tmpDir`, used to build the `LocalFileSystem` under test — never cleaned); the other
  (`keystoreDir`) is classification (b), see below
- `backend/src/test/scala/com/helio/services/sources/DataSourceServiceRestartPersistenceSpec.scala`
  — 3 sites
- `backend/src/test/scala/com/helio/services/sources/DataSourceServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/sources/SchemaInferenceRegressionSpec.scala`
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceAgentContextSpec.scala`
  — also needed a `super.afterAll()` call added (previously absent)
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceSearchServiceSpec.scala` — FQN
  `java.nio.file.Files.createTempDirectory` form
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceTeardownServiceSpec.scala`

## Classification (b) — already safe, left in place with a reviewed-comment exemption (no-op per AC)

- `backend/src/test/scala/com/helio/services/sources/CsvUrlFetchSpec.scala` — `keystoreDir`
  (line 55/56) is deleted recursively in its own `afterAll` (`Try(deleteRecursively(keystoreDir))`)
  — added `// temp-dir-hygiene: reviewed` comment, no functional change.
- `backend/src/test/scala/com/helio/services/sources/DataSourceServiceCsvUrlSpec.scala` —
  `keystoreDir` (its 2nd site) has the identical own-cleanup pattern; reviewed-comment added.
- `backend/src/test/scala/com/helio/infrastructure/storage/LocalFileSystemSpec.scala` — the
  `Files.createTempFile(precondDir, ".probe", ".tmp")` call at the D2-precondition check creates
  its probe file **inside** `precondDir`, itself a subdirectory of the already-tracked `tempDir`
  — it is swept by `TempDirectorySupport`'s recursive delete of `tempDir` with no separate
  registration needed; reviewed-comment added.

## Tooling / CI

- `package.json` — added `check:test-temp-dir-hygiene` and `check:test-temp-dir-hygiene:selftest`
  scripts.
- `.husky/pre-commit` — wired both scripts in, immediately after `check:scala-quality`.
- `.github/workflows/ci.yml` — wired both scripts into the `frontend` job (the job named in
  `ci-complete`'s `needs:`), immediately after `check:scala-quality`, mirroring the HEL-1123
  precedent. `npm run check:precommit-ci-parity` re-run and passes (both scripts appear in both
  the hook-scripts and ci-complete-covered lists).

## Evidence

**Inode count (task 3.1, AC bullet 2):**

```
$ ls -d /tmp/{helio-,analyze-,audit-,csv-,hel1076-,hel914-,hel974-,output-,patch-,pipeline-}* 2>/dev/null | wc -l
3982   # BEFORE a full `sbt test` run (this count is pre-existing residue from the 2026-09-10/11
       # incident this ticket exists to prevent recurring — not cleaned per the ticket's own
       # non-goal / owner-approval requirement)

$ cd backend && sbt -batch test    # 4246 tests, 277 suites, all green, 5m2s

$ ls -d /tmp/{helio-,analyze-,audit-,csv-,hel1076-,hel914-,hel974-,output-,patch-,pipeline-}* 2>/dev/null | wc -l
3982   # AFTER — identical count. Zero net growth.
```

**Guard failability demonstration (task 2.4 / design Decision 6):** appended a scratch `object`
to `LocalFileSystemSpec.scala` (never committed) with one bare call of each of the four spellings:

```scala
object Hel1120ScratchMutation {
  val a = java.nio.file.Files.createTempDirectory("scratch-a")
  val b = java.nio.file.Files.createTempFile("scratch-b", ".tmp")
  val c = java.io.File.createTempFile("scratch-c", ".tmp")
  val d = File.createTempFile("scratch-d", ".tmp")
}
```

`node scripts/check-test-temp-dir-hygiene.mjs` exited 1 and flagged all four lines by number
("Test temp-dir hygiene check failed — 4 violation(s)"). The scratch block was then removed
before this commit (verified `git status`/re-run of the guard shows clean).

**Guard `:selftest` (task 2.2):** `node scripts/check-test-temp-dir-hygiene.selftest.mjs` — 9
passed, 0 failed (each spelling individually, all four together, both exemption paths honored,
and a non-adjacent reviewed-comment correctly does NOT exempt an unrelated call).

**Full backend suite (task 3.2):** `sbt test` — 4246 tests, 277 suites, all green (see above).

**Full pre-commit hook** (`bash .husky/pre-commit`, run end-to-end since this change touches
`package.json`/`.husky/pre-commit`/`.github/workflows/ci.yml`): exit code 0 — lint, typecheck,
format:check, every `check:*` gate including the two new ones, and `npm test` (jest, 25+315
suites) all passed.

**`check:precommit-ci-parity`:** passes — both new scripts appear in both the hook-scripts list
and the ci-complete-covered list.

## Root cause (systematic-debugging.md)

- **Root cause:** `LocalFileSystemSpec` (and 36 sibling specs) call
  `Files.createTempDirectory`/`createTempFile`/`java.io.File.createTempFile` directly with no
  `afterAll` (or an `afterAll` that closes only `db`/`embeddedPostgres`, never the temp path), so
  every `sbt test` run leaves a new directory tree in `/tmp` permanently — `/tmp` is a tmpfs
  capped at 1,048,576 inodes, and it filled twice (2026-09-10/11).
- **Probe:** `ls -d /tmp/helio-fs-test* | wc -l` before this change, across two consecutive
  `sbt test` runs, showed the count incrementing by one new directory per run (one per
  `LocalFileSystemSpec` execution) with none removed.
- **Probe output:** confirmed growth pre-fix; confirmed **zero** growth post-fix across the full
  57-site sweep (3982 → 3982, see Evidence above).

## No DB migration

None created. No finding in this sweep required one — per the driver's guidance, V107 stays
reserved and unused by this change.
