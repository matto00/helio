## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `712756074c06facda00f9ce6d4e3698a30779db7`. Base resolved live via `resolve-review-base.sh`:
`f63ab8365d2b0e6cac36154a83437b6d26b3a209`. Backend-only change; no servers started, no Flyway against the shared dev DB
(embedded Postgres only).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1: `DataSourceTable.ownerId` is `column[UUID]`, `DataSourceRow.ownerId: UUID`; the `getOrElse(UserId(""))` read fallback
  and the `"" -> None` write fallback are both gone (`DataSourceRepository.scala:50`, `:114`). `grep 'UserId("")' backend/src/main`
  returns no hits. The suite compiles and passes.
- AC2: none of the query-building code changed in the diff; only the column/row type declarations and the conversion
  sites changed. That makes the executor's probe, which restates each expression against the real `TableQuery[DataSourceTable]`,
  adequate: the only thing that can change the SQL is the column type, and the probe exercises exactly that. My own grep
  of `DataSourceTable` users in `backend/src/main` found only `DataSourceRepository`, `WorkspaceTeardownRepository` (:107,
  :135, plus :156 delete by id only), `PipelineCycleGuard` (:44-47) and `PipelineRepository` (:219, :234, join on `id`
  only). Every owner_id site is in the sql-parity.md table, so none was missed. The NOBYPASSRLS repository specs are green in
  my full-suite run.
- AC3: the `case None` ownerless branch is removed. The header now says "three outcomes" and the
  `findAllRestApiRawInternal` doc and return type are non-optional. The `RestSourceConnectorMigrationSpec` comment now
  matches what the code does.
- AC4: six dedicated abort tests are present. I re-ran the `lookup` and `union` mutations myself; each turned exactly its
  targeted test red (16 passed, 1 failed). Restore was proven both times: `git diff --exit-code` rc=0 and sha256
  `574aff75bf071eabd4c2aacdcb2bbc02920de2ac26a41221083b21d6b359e54f`, equal to the base blob.
- AC5: the spec is split into `V119MigrationHarness` and the Cleanup, Guard and Migration specs. Comparing base test
  names to head, all 15 original test names are present verbatim under the same `should` prefixes. The only new names
  are the lookup and union tests, for 17 tests in total. Every repo reference to `V119OwnerFkMigrationSpec` is still
  true: `docs/user-reference-inventory.md:10,68` (inventory parse and user-delete outcomes, both kept in that class),
  `RlsOwnerTablesSpec:282` and `RestSourceConnectorMigrationSpec:215` (the 23502/23503 test, kept). The
  `StoredObjectDeletionsMigrationSpec:18` reference to the role shape now points at `V119MigrationHarness`, where that
  code lives.
- Constraints C1–C4 are honored. V119 is byte-identical to base. No migration was added. The diff's file list has zero
  overlap with the 167 files of parked PRs #994/#996/#998/#986/#999 (checked with `gh pr view --json files`). No servers
  were started and no dev-DB Flyway was run.
- Spec delta: `openspec validate slick-owner-uuid-guard-tests --strict` passes. The MODIFIED requirement header matches
  the base spec.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates I ran myself in `WORKTREE_PATH`, all foreground with `nice -n 19`:
- `npm run check:scala-quality`, `check:openspec`, `check:spec-structure`, `check:repo-integrity`,
  `check:test-temp-dir-hygiene`, `check:no-credential-leak`, `format:check`: all rc=0.
- `sbt -J-Xmx3g testFull` as 8 foreground shards (`HELIO_TEST_SHARD_INDEX=0..7 HELIO_TEST_SHARD_COUNT=8`, local group
  concurrency 1). All 8 shards had rc=0. Totals: 593 suites completed, 0 aborted; 7790 tests passed, 0 failed,
  4 canceled.
- The 4 canceled tests are **pre-existing and not caused by this change**. They are 3 in `DatasetWriteSubmitLatencySpec`
  (`assume(Measure, "set HELIO_MEASURE=1 ...")`, :215) and 1 in `OutputFilteredMetricMeasurementSpec` (`assume(enabled, ...)`,
  :50). Both are opt-in measurement specs gated only on the `HELIO_MEASURE` env var, and both files are byte-identical
  to base (`git diff --quiet f63ab8365 HEAD -- <both>` rc=0). They cancel on any run without `HELIO_MEASURE=1`, base
  included.
- Targeted run of the three V119 specs plus `DataSourceRepositoryEmptyOwnerSpec`: 20 passed, 0 failed.

Independent mutation checks:
- V119 `'lookup'` removed: only the lookup test is red. V119 `'union'` removed: only the union test is red. Restore was
  proven after each.
- Eager-conversion mutation of `insertRowAction` (conversion moved outside `DBIO.successful(()).flatMap`): both
  empty-owner tests fail with "An unexpected java.lang.IllegalArgumentException was thrown" at
  `DataSourceRepositoryEmptyOwnerSpec.scala:70` and `:78`. The valid-owner test stays green. So the test does catch a
  synchronous throw. Restored with `git checkout --`: diff rc=0, sha256 `281d5f3d...e0c9` unchanged.

Checklist:
- Code quality, DRY, readability: `insertRowAction` removes the two duplicated `table += domainToRow(...)` sites. The
  ownerless branch removal is a pure de-indent apart from the dropped `case None`; I compared the before and after
  bodies.
- Type safety: improved (the Option is gone).
- Error handling: the failure mode is preserved as a failed Future (the error is now `IllegalArgumentException`, where
  it used to be DB 23502). No caller matches on 23502; sql-parity.md records this and I confirmed it.
- Tests: meaningful, and each new test is shown red by mutation.
- Dead code: none. The imports in `RestSourceConnectorMigration.scala` are all still used.
- Behavior-preserving refactor: the split moves code without changing tests. `PipelineCycleGuard` keeps the same
  semantics on a NOT NULL column.

### Phase 3: UI Review — N/A
Backend-only change. No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` file changed; the spec
delta is under `openspec/changes/`.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `files-modified.md` lists every code file, test file, spec-delta file, comment-only edit and evidence file, all with
  repo-relative paths. It leaves out the planning artifacts that are also in the diff: `.openspec.yaml`, `proposal.md`,
  `design.md`, `ticket.md`, `skeptic-design-1.md`, `skeptic-design-2.md` and `files-modified.md` itself. To meet the
  "complete" rule literally, append them.
- `design.md` D1 names the method `create` (`:222`), but the method is `insert`. `sql-parity.md` notes this; a
  one-word fix in design.md would remove the inconsistency.
- `V119MigrationHarness.scala:25` has the wording "Each mixing suite owns its own embedded Postgres". This probably means
  "each suite mixing in the harness".
- Pre-existing and out of scope: `openspec/specs/dataset-row-storage/spec.md:54` still describes a `static` source with
  `owner_id IS NULL` as "the existing, documented posture", which V119 made impossible. Candidate follow-up (Follow-up
  label, relatedTo HEL-1433).
