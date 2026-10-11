## Standing Constraints

- [C1] An editor grantee's real run counts against the PIPELINE OWNER's concurrency budget (owner-keyed lock and count).
- [C2] Editor runs are recorded (run row, assertions, last_run_*, retention) and attributed via nullable pipeline_runs.triggered_by_user_id (V124-or-next, additive, no backfill, no data UPDATE).
- [C3] Editor dry runs write their dry_run row (no last_run_*, no cap).
- [C4] Editor writes use privileged paths only after submit's ACL check, re-authorized in-transaction; RLS policies unchanged; owner path unchanged.
- [C5] Tests red-first on VerifiedEmbeddedPostgres.start as a NOBYPASSRLS role; `[hel1468-guard]` line in every sbt run; no inline FQNs; guards mutation-proven.

### Backend

## 1. Migration and row model

- [x] 1.1 Add `V124__pipeline_runs_triggered_by_user.sql` (re-check next free number on origin/main) per design D3; verify Flyway applies in the spec DB
- [x] 1.2 Add `triggeredByUserId` to `PipelineRunRow`/table/`insertRunRowAction`/`insertDryRunInternal`; every submit path and `recordUnrunnable` pass `Some(user.id)`; verify compile + existing specs

## 2. Repository

- [x] 2.1 Add the privileged owner-keyed, re-authorizing cap insert for grantee submitters (design D2); verify with repository-level spec incl. revoked grant
- [x] 2.2 Add the privileged re-authorizing dry-run insert for grantee submitters; verify with spec
- [x] 2.3 Remove/retire `NotOwned` so no path treats "not authorized" as admitted; verify compile and grep shows no admitting match

## 3. Service wiring

- [x] 3.1 `PipelineRunExecutor.executeRun`: owner runs unchanged; editor runs use 2.1, map `NotAuthorized` (incl. pipeline deleted mid-submit) to Forbidden, and use `deleteOldRunsInternal` at the preExec retention site (:154-156); verify specs
- [x] 3.2 `PipelineRunTerminalWrites`/`PipelineRunSucceededWrites`: editor runs use `*Internal` terminal/last-run writes and `deleteOldDryRunsInternal` (TerminalWrites :127) (design D4); fix stale doc at TerminalWrites :91-100; verify specs

## 4. Docs

- [x] 4.1 Update CLAUDE.md `PIPELINE_RUN_MAX_CONCURRENT` row (editor runs count against the pipeline owner; HEL-1492); verify diff

### Tests

## 5. Specs (red first)

- [x] 5.1 Convert `Hel1492ReproSpec` into the permanent NOBYPASSRLS spec for the new behaviour; record its red run against unchanged code in the run evidence dir
- [x] 5.2 Invert (not delete) the old-behaviour tests: PipelineRunServiceSpec :521-545, PipelineRunGuardIntegrationSpec :370-385, PipelineRunRepositorySpec :626-638; update NotOwned doc comments
- [x] 5.3 Cap tests: owner at cap → editor 429, no execution; in-flight editor run → owner's next submit 429 at cap=1; held owner-key advisory lock blocks the editor insert (mutation: submitter-keyed lock fails it)
- [x] 5.3a Editor terminal-branch tests: success, failure, blocked, dry, write-back `Left` and exception paths — each row terminal and last_run_* updated (dry: unchanged)
- [x] 5.3b Revoked-grant-before-admission test → 403, not executed, nothing written
- [x] 5.3c Retention: 11 editor real runs leave exactly 10 rows; 11 editor dry runs leave exactly 10 dry_run rows; both fail with editor retention left on owner-scoped calls
- [x] 5.4 Attribution tests (owner, editor, scheduled, hook token user) and viewer/non-grantee no-write tests
- [x] 5.5 Run the backend suite (`sbt testFull`, MemAvailable >= 15 GB, nice -n 19) and show `[hel1468-guard]` failed=0
