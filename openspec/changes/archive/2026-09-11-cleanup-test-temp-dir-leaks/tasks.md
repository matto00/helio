## 1. Backend

- [x] 1.1 Create `backend/src/test/scala/com/helio/testkit/TempDirectorySupport.scala`
      (`BeforeAndAfterAll` trait with `newTempDir(prefix)`/`newTempFile(prefix, suffix)` +
      `afterAll` cleanup that collects delete failures and re-throws rather than logging/
      swallowing them) and verify it compiles under `sbt Test/compile`
- [x] 1.2 Migrate `LocalFileSystemSpec` (class-field `tempDir` + `helio-from-env-abs`/`-create`/
      `-compat`) onto `TempDirectorySupport`, confirm the existing permission-restore `finally`
      blocks (~lines 176-225) still run before `afterAll`'s delete, and verify
      `sbt "testOnly com.helio.infrastructure.storage.LocalFileSystemSpec"` passes
- [x] 1.3 Enumerate all 59 temp-file/dir creation call sites under `backend/src/test/scala`
      across all four spellings (`Files.createTempDirectory`, `Files.createTempFile`, the FQN
      `java.nio.file.Files.*` forms, `java.io.File.createTempFile`/`File.createTempFile`) via
      `grep -rEn`, classify each as (a) leaking→migrate, (b) already-safe→leave, or
      (c) `deleteOnExit()`-only→migrate (3 files: `InProcessPipelineEngineSpec`,
      `PipelineRunRoutesSpec`, `PipelineRunServiceSpec` — `deleteOnExit` doesn't cover a
      killed/OOM'd JVM), and migrate every (a)/(c) site onto `TempDirectorySupport`; verify each
      migrated spec's own test class still passes in isolation
- [x] 1.4 For every classification-(b) site left unmigrated, add a
      `// temp-dir-hygiene: reviewed — <reason>` comment on that line and record the full file
      list + reasons (including the (b) no-ops) in `files-modified.md`/the PR body

## 2. Tooling / CI

- [x] 2.1 Create `scripts/check-test-temp-dir-hygiene.mjs` (guard: fails on any of the four
      direct temp-file/dir creation spellings under `backend/src/test/scala` not in
      `TempDirectorySupport.scala` and not marked with the reviewed-comment escape hatch) and
      verify it exits 0 against the now-migrated tree
- [x] 2.2 Add a `check:test-temp-dir-hygiene:selftest` script that plants one instance of each of
      the four spellings in a fixture and asserts the guard flags all four (mirroring
      `check:precommit-ci-parity:selftest`'s existing pattern); verify it passes
- [x] 2.3 Add `check:test-temp-dir-hygiene` (and its `:selftest`) to `package.json` scripts, wire
      both into `.husky/pre-commit` (after `check:scala-quality`) and
      `.github/workflows/ci.yml`'s frontend job, and verify `npm run check:precommit-ci-parity`
      still passes
- [x] 2.4 Demonstrate the guard is failable against a real file: in a throwaway local commit, add
      one bare call of each of the four spellings to a test file, run
      `npm run check:test-temp-dir-hygiene`, confirm non-zero exit flagging all four, then
      `git reset` the scratch commit — record the exact mutations and command output in the PR
      body

## 3. Tests / Evidence

- [x] 3.1 Enumerate the distinct temp-dir/file string-literal prefixes actually used across the
      59 call sites (expect at least `helio-`, `analyze-`, `audit-`, `csv-`, `hel1076-`,
      `hel914-`, `hel974-`, `output-`, `patch-`, `pipeline-`), count matching entries under
      `/tmp` for each, run a full `sbt test`, count again, and verify no prefix's count grew —
      record both counts, the prefixes, and the command used in the PR body
- [x] 3.2 Run the full backend suite (`sbt test`) and confirm all specs still pass after the
      migration
