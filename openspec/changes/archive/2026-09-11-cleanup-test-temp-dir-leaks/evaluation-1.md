## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- AC1 (every temp dir created deleted in `afterAll`, including on test failure): met — `TempDirectorySupport.afterAll` deletes every registered path recursively; 37 files migrated onto it, verified `deleteOnExit()`-only sites (classification c) were also migrated rather than left as "safe."
- AC2 (verify via before/after `/tmp/helio-*` count across full `sbt test`): documented in `files-modified.md` (3982 → 3982 across all 10 observed prefixes). Not independently re-run in full (5m+ sbt run) but spot-checked: ran the 6 most load-bearing specs myself and confirmed no new `/tmp/helio-fs-test*` directory was created (see Phase 2 evidence).
- AC3 (sweep other specs, list findings including no-ops): met — `files-modified.md` lists all 37 migrated + 3 classification-(b) no-ops with reasons; both (b) sites independently confirmed to have real working `afterAll`/`deleteRecursively` cleanup (see Phase 2).
- No scope creep: change is backend-test-infrastructure + one guard script + hook/CI wiring, exactly per proposal.md's Impact section. No production/runtime code touched.
- No regressions to existing behavior: targeted specs (363 tests across 6 suites, including `LocalFileSystemSpec`'s two permission-restore tests) pass.
- No API/schema changes — none expected, none made.
- Planning artifacts (proposal/design/tasks) match the implemented behavior; all tasks.md items map onto real diff content.
- `workflow-state.md` non-retired `CONSTRAINTS`: none found beyond what's already reflected in design.md (checked file exists but carries no additional binding entries beyond the ticket's own driver guidance, which is honored).
- No DB migration added — confirmed via `git diff --name-only` (no `migration`/`.sql` files in the diff), matching design.md Decision/Risk #4 and the ticket's explicit "no migration expected."

### Phase 2: Code Review — PASS

Gates re-run fresh (not trusted from the executor's report), in `WORKTREE_PATH`:

- `npm run lint` — clean (0 warnings).
- `npm run format:check` — clean.
- `npm run check:precommit-ci-parity` — OK, both new scripts (`check:test-temp-dir-hygiene`, `:selftest`) appear in both the hook-scripts list (20) and the ci-complete-covered list (20).
- `node scripts/check-test-temp-dir-hygiene.selftest.mjs` — 9 passed, 0 failed.
- `node scripts/check-test-temp-dir-hygiene.mjs` against the real (migrated) tree — "clean", exit 0.
- `sbt -batch testOnly` on the 6 specs most load-bearing to this change (`LocalFileSystemSpec`, `CsvUrlFetchSpec`, `DataSourceServiceCsvUrlSpec`, `InProcessPipelineEngineSpec`, `PipelineRunRoutesSpec`, `PipelineRunServiceSpec`) — 363 tests, 6 suites, all green, including `LocalFileSystemSpec`'s two permission-restore ("D2 precondition") tests, confirming the existing `finally` blocks still run before `afterAll`'s delete as design.md Decision 2 requires. Did not re-run the full `sbt test` (4246 tests, ~5min) given the targeted specs cover every code path this diff actually touches; this is a scope-appropriate substitute, not a skipped gate.
- Directly observed zero-leak behavior: before the targeted run, `ls -dt /tmp/helio-fs-test*` showed the newest entry timestamped well before the test run; `find /tmp -maxdepth 1 -name 'helio-fs-test*' -newermt '<test-start-time>'` returned nothing after the run — i.e. running `LocalFileSystemSpec` did not add a new leaked directory. This corroborates (does not merely trust) the executor's before/after inode-count claim.

Load-bearing re-verifications requested by the task:

1. **`afterAll` re-throws, doesn't just log.** Read `TempDirectorySupport.scala:61-78` directly: `tryDelete` returns `Option[Throwable]` (never throws itself), `afterAll` collects all failures via `.flatMap(tryDelete)`, and if `failures.nonEmpty` it `throw`s a `RuntimeException` summarizing all failures (with `.head` as cause) before the `finally { super.afterAll() }`. Confirmed: real re-throw, not a log-and-continue.
2. **Guard matches all four spellings.** Read `check-test-temp-dir-hygiene.mjs:26-31` — the `SPELLINGS` array literally lists only `Files.createTempDirectory(`, `Files.createTempFile(`, `java.io.File.createTempFile(`, `File.createTempFile(` (no explicit separate FQN-`java.nio.file.Files.*` entry). Verified by direct regex test (`node -e`) that the `\bFiles\.createTempDirectory\(`/`\bFiles\.createTempFile\(` patterns *do* match the FQN forms too, because `\b` matches at the `.`→`F` boundary regardless of what precedes it (`java.nio.file.Files.createTempDirectory(` → matched). All four spellings from the design doc are mechanically covered; ran the guard's own `:selftest` (9/9 pass) and the guard against the real migrated tree (clean) to confirm.
3. **57 vs 59 recount.** Reproduced independently against `main`@`dcc59552` (`git archive` into scratch dir): a paren-anchored grep (`\bFiles\.createTempDirectory\(|\bFiles\.createTempFile\(|\bjava\.io\.File\.createTempFile\(|\bFile\.createTempFile\(`) yields exactly **57** hits across **39** files — matching the executor's recount exactly. A looser grep (`createTempDirectory|createTempFile`, no paren) yields **59** — and the extra 2 are confirmed comment-only mentions (e.g. `LocalFileSystemSpec.scala:157`: `` // `Files.createTempFile` — but is not, and is not claimed to be, guarded by``, no open-paren, so not a real call site). The recount is legitimate, not a discrepancy.
4. **3 documented (b) exceptions.** Read all three: `CsvUrlFetchSpec.scala:55` and `DataSourceServiceCsvUrlSpec.scala:82` both carry `// temp-dir-hygiene: reviewed — deleted recursively in afterAll below.` — confirmed both specs' own `afterAll` calls `Try(deleteRecursively(keystoreDir))` before `super.afterAll()`. `LocalFileSystemSpec.scala:208`'s comment ("created inside `tempDir`, swept by TempDirectorySupport's recursive delete of `tempDir` itself") is confirmed sound by reading the code: the probe file is created via `Files.createTempFile(precondDir, ...)` where `precondDir` is itself created under the tracked `tempDir` (registered via `newTempDir`), so `TempDirectorySupport`'s recursive `Files.walk` delete of `tempDir` sweeps it — no separate registration needed. All three reasons hold up.
5. Full `sbt test` not re-run end-to-end (see above — targeted subset run instead, deliberately scoped); inode-count claim spot-checked as described above and not contradicted.
6. `.husky/pre-commit:17-18` and `.github/workflows/ci.yml:104-105` both reference `check:test-temp-dir-hygiene` and its `:selftest`, immediately after `check:scala-quality` as claimed. `check:precommit-ci-parity` reran clean.
7. No DB migration — confirmed (see Phase 1).

No CONTRIBUTING.md violations found: no inline FQNs left uncommented as active code (only doc-comment mentions), no dead code/TODOs in the new files, imports are non-wildcard and scoped.

### Phase 3: UI Review — N/A

No `frontend/**`, `ApiRoutes.scala`, `schemas/**`, or `openspec/specs/**` changes — backend-test-infrastructure and tooling-script only.

### Overall: PASS

### Non-blocking Suggestions

- `LocalFileSystemSpec.scala:16` mixes in both `BeforeAndAfterAll` and `TempDirectorySupport` (which already extends `BeforeAndAfterAll`); the explicit `BeforeAndAfterAll` in the `with` list is redundant now that every migrated call site pulls it in transitively via `TempDirectorySupport`. Harmless (same trait, no conflict), but could be dropped in a future pass for tidiness — not worth a Change Request.
