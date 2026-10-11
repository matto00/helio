## Standing Constraints

- [C1] New embedded-Postgres specs use `VerifiedEmbeddedPostgres.start`; every sbt run's output must show `[hel1468-guard]`.
- [C2] No inline fully-qualified names (CONTRIBUTING.md).
- [C3] Every leak-path test is measured red on the whole pre-fix tree before the fix, and asserts the exact-owner-id `data_sources` (and `connectors`, for bare-url REST) count is unchanged after the failure.
- [C4] No change to any success response, existing error status/message, API shape or schema; no migration; no prod data change.
- [C5] Do not touch the compute engine (`domain/engine/**`, compute step code): HEL-1314 is parked on it.
- [C6] Machine hygiene: `nice -n 19` on heavy jobs; check `MemAvailable` (wait if under ~15 GB) before any `sbt testFull` or full jest run; at most two `testFull` machine-wide; shut down every sbt server you start; never pkill/pgrep/killall; `git -C`, never `cd`; Bash timeout 600000; no `--no-verify`/`HUSKY=0`/`core.hooksPath` without disclosure.
- [C7] Never print, cat, source or echo `backend/.env` or any env map. Dev-DB residue: capture ids up front, delete by exact id only, never touch the owner's account.
- [C8] Scratch files namespaced by ticket and kept in the worktree or `.concertino/runs/HEL-1475/`; never the main checkout root, never /tmp.

## 1. Red first

- [x] 1.1 Write the Decision 5 specs (addRoot fault-injected, cycle-guard reproduction attempt, bare-url implicit Connector on single-call create / addRoot / patch-set rollback, explicit-connectorId guard, post-insert failure for sql / rest and bare-url insert failure, fetch-error-keeps-source guard, rollback mismatch and pipeline-delete-fails). Run them on the pre-fix tree; record each red (and each guard's green) in `red-evidence.md` in this change dir. Record the cycle-guard outcome and `createStatic` (one transaction) explicitly as leaks / does NOT leak, with evidence.

## 2. Fix

- [x] 2.1 Decision 1: shared cleanup helper with implicit-Connector handling and the crash-atomicity doc; switch `PipelineCreateWrites.deleteInlineSources` to it (track the flag per created id).
- [x] 2.2 Decision 2: `addRoot` compensation, reusing/generalizing `compensatingInlineSources`.
- [x] 2.3 Decision 3: post-insert cleanup in `SourceService.createSql`/`createRestWithConfig` and bare-url Connector cleanup in `createRest`.
- [x] 2.4 Decision 4: `deleteInlineRootSources` count mismatch -> warn, delete nothing, `unrecoverable`; missing id -> warn, skip, `unrecoverable`; using the helper.
- [x] 2.5 `PipelineProposalService` internal apply-failure cleanup uses the helper via a flag on `ResolvedSource`; public `rollback(response, user)` unchanged (follow-up).
- [x] 2.6 Wiring in `Main`/test harnesses for any new constructor dependency.

- [x] 2.7 Design-gate r2 non-blocking notes (adopt): (a) Decision 4's count-mismatch rule applies only when the request has at least one inline root; (b) do not make the helper/`connectorRepo` a silently-skippable optional dependency -- at least one implicit-Connector red test runs through the production `ApiRoutes` wiring; (c) add a test where a second source references the Auto Connector (exercises the dependents guard, Connector kept); (d) keep the "upper bound" label on prod query (b).

## 3. Verify

- [x] 3.1 All task-1 specs green; related existing specs green (`PipelineCreateOrphanSourceRoutesSpec`, `PipelineRootRoutesSpec`, patch-set apply/rollback specs, `SourceService`/`DataSourceService`/proposal specs).
- [x] 3.2 Full backend gate (`sbt testFull`, with C6) and pre-commit hooks pass.
- [x] 3.3 Decision 6: write `prod-count-queries.md` in this change dir with the read-only queries, each run once against the dev/embedded schema (record the run, not prod numbers).
- [x] 3.4 (no live dev-server probe: the reachable path is covered through production ApiRoutes wiring in InlineSourceLeakApiRoutesWiringSpec, the rest needs fault injection) Live probe on the dev server for any path reachable without fault injection (throwaway user, exact-id cleanup), or state why the spec is the evidence.
- [x] 3.5 `files-modified.md` handoff and commit.

## 4. Orchestrator (Delivery)

- [x] 4.1 (HEL-1493) File follow-up: patch-set UNDO of an inline-root pipeline create -- owner product question (path 4).
- [x] 4.2 (commented) Comment on HEL-1441 that its item 3 is already satisfied.
- [x] 4.3 (HEL-1494) File follow-up: other `DataSourceService` create paths (csv/csvUrl/text/pdf/image) post-insert failure.
- [x] 4.4 (HEL-1495; also HEL-1497 for user-delete Auto Connector) File follow-up: prod orphan cleanup (prod data; owner), referencing the read-only count queries.
- [x] 4.5 (HEL-1496, incl. newConnector) File follow-up: public `PipelineProposalService.rollback(response, user)` implicit Connector.
