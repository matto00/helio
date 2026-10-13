## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `712756074c06facda00f9ce6d4e3698a30779db7`. Base resolved live with `resolve-review-base.sh` and
the exit status checked: `f63ab8365d2b0e6cac36154a83437b6d26b3a209`. Backend-only change, so there was no UI phase
and no servers were started. Embedded Postgres only; no Flyway was run against the shared dev DB.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/slick-owner-uuid-guard-tests/HEL-1433`.
- **AC1 (non-optional UUID):** in the diff, `DataSourceTable.ownerId` is `column[UUID]` and `DataSourceRow.ownerId: UUID`.
  `rowToDomain` is `UserId(row.ownerId.toString)` and `domainToRow` is `UUID.fromString(ds.ownerId.value)`.
  `grep -rn 'UserId("")\|ownerless\|ownerIdOpt' backend/src/main` returns hits only in immutable migration SQL.
  `PipelineCycleGuard` now uses `ownerId.toString == actingUserId`. Test/compile succeeded as part of every sbt run below.
- **AC1/D1 (failure mode preserved):** `insertRowAction` (`DataSourceRepository.scala` around :228) defers
  `domainToRow` into `DBIO.successful(()).flatMap`. It is the only call site of `domainToRow`, which grep confirms;
  `insert` and `insertDatasetSourceAction` both use it. `DataSourceRepositoryEmptyOwnerSpec` captures the Future inside
  `noException should be thrownBy` (3/3 green in my run). The evaluator recorded a red result for the eager-conversion
  mutation; I read the test and agree it catches a synchronous throw.
- **AC2 (behaviour preservation):** `sql-parity.md` records byte-identical base and head SQL for every
  owner_id-referencing expression. A probe was used and then deleted, and its caveat is disclosed (it restates the
  expressions rather than calling the private methods). That is consistent with Slick semantics: lifting
  `Option[UUID] === UUID` versus `UUID === UUID` produces the same SQL, and the insert column list is unchanged. No
  SQL changed, so no new NOBYPASSRLS test was required. I re-ran the existing NOBYPASSRLS specs myself and all were
  green: `DataSourceRepositoryApplyWriteBacksRlsSpec` 3, `DataSourceReferenceGuardNonSuperuserSpec` 30,
  `UpsertTargetWritableRlsSpec` 7, `RlsOwnerTablesSpec` 32.
- **AC3 (dead branch):** `case None` is gone, the header lists "three outcomes" with the ownerless line removed, and
  `findAllRestApiRawInternal` returns `(String, UUID, String, String)`. The rest of `migrateOne` is a de-indent with no
  other change; I compared the bodies line by line. The `RestSourceConnectorMigrationSpec` comment and the
  `seedLegacyRestSource` signature are updated. The spec has 5/5 tests green.
- **AC4 (guard tests, red by mutation):** `V119OwnerFkGuardSpec` has one abort test per kind: two-root, join, lookup,
  union, upsertsource and form panel. It also has a live-mention negative test, extended with lookup and union. I
  reproduced three mutations myself, each worktree-only. Each run turned exactly one test red (6 passed, 1 failed):
  - removing `'lookup'` from the IN list turned the lookup test red;
  - removing `'union'` turned the union test red;
  - dropping `panel_refs` from the sum turned the form-panel test red.

  After each mutation I ran `git checkout --`. The V119 file then showed `git diff --exit-code` rc=0 and sha256
  `574aff75bf071eabd4c2aacdcb2bbc02920de2ac26a41221083b21d6b359e54f`, which equals `git show f63ab8365:<V119> | sha256sum`.
  `git status` was clean apart from the untracked `evaluation-1.md`. `mutation-runs.md` covers the other three mutations.
- **AC5 (split):** the base spec had 15 tests. Head has 17 across Cleanup (2), Guard (7) and Migration (8). A `comm`
  of the base and head test-name sets shows no missing names. Every test sits under its original `should` block text,
  so full names are unchanged. The only additions are the lookup and union tests. The kept class still holds the
  23502/23503 test, the user-delete outcomes and the inventory-doc parse. So these references stay true:
  `docs/user-reference-inventory.md:10` and `:68`, `RlsOwnerTablesSpec:282`, and `RestSourceConnectorMigrationSpec:215`.
  `StoredObjectDeletionsMigrationSpec:18` is retargeted to `[[V119MigrationHarness]]`, where the role shape now lives.
  File sizes: harness 153 lines, specs 51, 97 and 175.
- **Test runs (all foreground, `nice -n 19`, `sbt -J-Xmx3g testOnly`):**
  - V119 ×3, EmptyOwner, RestSourceConnectorMigration, the NOBYPASSRLS specs, `WorkspaceTeardown*` and
    `persistence.sources.*`: 14 suites, 159 passed, 0 failed.
  - `PipelineCycleDetectionServiceSpec`, `StoredObjectDeletionsMigrationSpec` and `RlsOwnerTablesSpec`: 3 suites,
    60 passed, 0 failed.
  - Guard spec under each of the three mutations, as listed above.

  I did not re-run the full suite. The evaluator pasted shard totals: 8 shards, 593 suites, 7790 passed, 4 canceled.
  The 4 cancellations are `HELIO_MEASURE`-gated, and those files are unchanged from base.
- **Other gates:** `npm run check:scala-quality` rc=0 ("clean"). `openspec validate slick-owner-uuid-guard-tests --strict`
  reports the change as valid. The spec delta's MODIFIED header matches `openspec/specs/user-reference-integrity/spec.md:48`.
- **Constraints:** V119 is byte-identical to base and no migration was added. The diff shares no files with parked PRs
  #994, #996, #998, #999 and #1000 (all OPEN), or with #986 (now MERGED). I checked with `gh pr view --json files` and
  `grep -Fx` against `git diff --name-only`.
- **Main has moved:** `origin/main` is now one commit ahead (#986, HEL-1455), which touches the compute-expression
  engine only. `git merge-tree --write-tree HEAD origin/main` is clean, and #986's diff has no `DataSourceRow`,
  `DataSourceTable` or `ownerId` hits.
- **files-modified.md** lists every changed source, test and spec-delta file as a repo-relative path, including the
  comment-only `StoredObjectDeletionsMigrationSpec`.

### Verdict: CONFIRM

### Non-blocking notes
- A malformed but non-empty owner string used to throw synchronously out of `insert` (an eager `UUID.fromString`).
  It now fails the Future. This is strictly safer and unreachable from production callers, and is noted only for
  completeness.
- The spec delta keeps the older aggregate scenario "An orphan referenced by a pipeline step or form panel aborts the
  migration intact" alongside the new per-kind scenarios. It is redundant but harmless.
- Gate-defect check: no report I drilled into relies on mtime ordering. The restore proofs are content-based (diff and
  sha256).
- Follow-ups filed: none.
