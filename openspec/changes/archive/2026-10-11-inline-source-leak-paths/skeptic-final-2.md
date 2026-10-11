## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: 4aa54e3f8f2447db1bc211bcf2c343f5410d9d5b. Base resolved live with `resolve-review-base.sh`: bcb0e891923094c1a1e85ecc053f30a73ee6d70f.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/inline-source-leak-paths/hel-1475`.

**Round-1 CR1 (proposal-apply Connector cleanup untested): genuinely fixed, not reworded.**
- New test: `PipelineProposalImplicitConnectorCleanupSpec`.
  - It drives the real `PipelineProposalService.apply` over real repositories and uses `VerifiedEmbeddedPostgres.start`.
  - The first root is a bare-url `rest_api` source. The second root names an unknown `sourceId`, so apply returns NotFound and rolls back through `rollbackSourceOnly`.
  - It asserts that the `data_sources` and `connectors` counts for the exact owner id are unchanged (`:94-95`).
- Two independent mutations each turn it red:
  - Executor's mutation: `HEL-1475-c3-mutation.log` shows `1 was not equal to 0 (PipelineProposalImplicitConnectorCleanupSpec.scala:95)`, which is the `connectors` line.
  - Evaluator's mutation, at a different site (the consumer): `HEL-1475-eval3-mut.log`.
- So the flag is now pinned at both its producer and its consumer.

**Round-1 CR2 (prod query (a) mislabelled): fixed.**
- `prod-count-queries.md` (a) is now labelled "UPPER BOUND ... Not a count of this ticket's leak".
- It names the cause I identified: `DataSourceService.delete` never removes a Connector.
- The query text is unchanged: a read-only `SELECT count(*)`. Query (b) still carries its upper-bound label.

**Round-1 non-blocking note (synchronous throw in `createRest`): adopted.** `SourceService.scala:198` now wraps the call as `Future.unit.flatMap(_ => createRestWithConfig(...))`.

**Fresh adversarial review of the whole production diff** (`git diff bcb0e8919...HEAD -- backend/src/main`, read in full):

- **Can the Connector delete remove a Connector the user still needs?** No. There are three independent barriers:
  1. **Flag comes from the request shape only.** `isImplicitConnectorRoot` requires a `rest_api` type, a `url`, and no `connectorId`. For the proposal path the flag is `cfg.url.isDefined && cfg.connectorId.isEmpty`. On that branch `createRest` (`SourceService.scala:142-173`) always creates a fresh Connector; `(Some, Some)` is rejected with 400 before anything is persisted.
  2. **Exact name match.** The name must be exactly `Auto: <source name>`, which is what `createRest` passes to `forLegacySource`.
  3. **Dependents guard.** The delete goes through `ConnectorRepository.delete` with `countRestSourcesReferencing`. That count runs under `withSystemContext` (`DataSourceRepository.scala:274-282`), so it sees every referencing source, not just RLS-visible ones. It is the same guard the user-facing DELETE uses.
  - In `createRest`'s own compensation the id is `createdConnector.id`, which this call just created.
  - Patch-set rollback refuses on a root-count mismatch, so it never deletes a mispaired source.
- **Leak paths still open.**
  - `createRestWithConfig` can only return `Right(...)` or a failed Future (`:244-264`). Every `Left` in `createRest` happens before `connectorRepo.create`. So no `Success(Left)` can skip the Connector cleanup.
  - Two paths remain out of scope, as the ticket and AC2 state: the public `PipelineProposalService.rollback(response)` keeps `implicitConnector = false`, and the other `DataSourceService` create paths are not covered. Both are queued as tasks 4.3 and 4.5.
- **Swallowed errors / changed statuses.**
  - Every compensation returns the original `Left` or re-raises the original exception: `InlineSourceCompensation`, `cleaningUpOnFailure` (`transform` to `Failure(ex)`), and `createRest` (`.transform(_ => Failure(ex))`).
  - Cleanup failures are logged and never replace the original error.
  - The only status change is AC5's deliberate one: a patch-set edit with a mismatch or missing id now reports `unrecoverable` instead of `rolledBack`.
  - No HTTP status or message text changed.
- **Production wiring.** `ApiRoutes.scala:387,396-403,499-502` wire `SourceService` with the real `connectorRepo` and build `PipelineService`/`PipelineProposalService` with a non-null `dataSourceService`. So `inlineSourceCleanup` is non-null in production, and `InlineSourceLeakApiRoutesWiringSpec` exercises that path.
- **C2 (no inline FQNs).** I grepped the added non-import lines for `com.helio.`, `scala.(concurrent|util|collection).`, `java.(util|time).` and `org.x.`. The only hits are `package` declarations.
- **C4/C5 (scope).** The changed files contain no `domain/engine/**`, migration, `schemas/`, protocol or route production file. The only `routes/` hit is a test spec.

**Fresh gate run (mine, on HEAD 4aa54e3f8).**
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly ..."` over 11 specs:
  - the 6 new specs, including the cycle-3 one;
  - `PipelineCreateOrphanSourceRoutesSpec`, `PipelineRootRoutesSpec`, `PipelineApplyProposalSpec`, `PatchSetRoutesSpec` and `FirstRunDashboardServiceRollbackSpec`.
- Result: `Tests: succeeded 59, failed 0`, `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, sbt exit 0.
- All 11 spec names appear in the log. 59 is round 1's 58 plus the one new test.
- Log: `/home/matt/Development/helio/.concertino/runs/HEL-1475/HEL-1475-skeptic-final2-targeted.log`.
- MemAvailable was 53 GB before the run. No sbt server was left running (no `project/target/active.json`).

**testFull: not re-run by me.**
- `HEL-1475-c3-testFull.log` shows 6824 succeeded, 0 failed, `[hel1468-guard] failed=0`, and names the new spec 3 times.
- Its tie to HEAD rests on mtime plus the test-count arithmetic, as the evaluator disclosed. The evaluator corroborated that with the +2 count and the new spec's name. It is not accepted on mtime alone, so this is not a gate defect.
- The production delta since the prior full run is the one-line `Future.unit.flatMap` wrap, and my targeted run covers the changed `createRest` path through `SourceCreatePostInsertCleanupSpec`.

**UI.** No frontend changes, so there was no UI review.

### Verdict: CONFIRM

### Non-blocking notes
- `evaluation-3.md` is untracked in the worktree. Commit it with the archive.
- The ticket-level follow-ups and the HEL-1441 comment (tasks 4.1-4.5) are still open orchestrator delivery items and must be done before close.
- The new `Future.unit.flatMap` sync-throw guard in `createRest` has no pinning test. That is acceptable as a defensive one-liner.
