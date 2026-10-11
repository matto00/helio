## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: c123f42392801ac1d9cec9314c9c3c8bcb776b73. Base resolved live with `resolve-review-base.sh`: bcb0e891923094c1a1e85ecc053f30a73ee6d70f.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/inline-source-leak-paths/hel-1475`.
- **Diff scope (C4/C5):** `git diff bcb0e8919...HEAD --stat`. Production changes are limited to `services/{patchsets,pipelines,sources}`. Nothing under `domain/engine/**`, no migration, no `schemas/`, and no protocol or route file. No inline FQNs in the added code; the imports are clean.
- **AC1 addRoot:** `PipelineRootWrites.scala`. The post-creation tail (`attachRoot`) runs under `InlineSourceCompensation.compensating`, which returns the original `Left` and re-raises the original exception (`transformWith`). An existing-`sourceId` root records nothing (`if (req.type.isDefined)`). Test: `InlineSourceLeakPathsRoutesSpec` (fault-injected `add`, 500, `data_sources` count unchanged). The cycle-guard trigger is recorded with a 201 test as not reachable.
- **AC2 implicit Connector:**
  - `InlineSourceCleanup.deleteCallCreated` reads the source's `connectorId` first, deletes the source, then calls `ImplicitConnectorCleanup.deleteIfAuto`.
  - `deleteIfAuto` applies two safeguards: an exact `Auto: <name>` match, and `ConnectorRepository.delete` with `dataSourceRepo.countRestSourcesReferencing`. That is the same `dependentCount` `ApiRoutes.scala:650` wires for the user-facing DELETE, and the delete also removes the credential row (`ConnectorRepository.scala:303-306`).
  - Callers set the flag only from the request shape (rest_api + url + no connectorId). `createRest` always creates a fresh Connector on that branch (`SourceService.scala:160-172`), so a user's explicit Connector can never be targeted.
  - Tests: single-call create, addRoot, patch-set rollback, production `ApiRoutes` wiring, the explicit-connector guard, and the dependents guard. The dependents guard can fail: a zero dependent count would delete the Connector, and the count assertion would catch it. **Not tested: the proposal-apply site (see CR1).**
- **AC3 post-insert failure:** `SourceService.cleaningUpOnFailure` wraps `CreateSourceEnvelope.build` in `createSql`/`createRestWithConfig`. It deletes the inserted row and re-raises the original `ex`, and a cleanup failure is only logged. The bare-url `createRest` adds a `transformWith` that removes the Connector, then re-raises. `createRestWithConfig` returns only `Right` or a failure, so no `Success(Left)` can bypass this. Tests: `SourceCreatePostInsertCleanupSpec` at service level and route level (`POST /sources`, 500, count unchanged), plus the fetch-error-keeps-source guard.
- **AC5:** `PatchSetApplyRollback.deleteInlineRootSources`. On a count mismatch it warns, deletes nothing and reports `unrecoverable`. When a `dataSourceId` is missing it warns, skips that root, deletes the rest and reports `unrecoverable`. The pipeline-delete-fails guard deletes the pipeline first, so it can fail. I accept the evaluator's mutation log for that (`HEL-1475-eval2-mut.log`); I did not reproduce it.
- **AC6:** the not-crash-atomic paragraph is in the `InlineSourceCleanup` doc comment.
- **Error and status preservation:** every compensation re-raises the original `Left` or exception. No status or message text changed.
- **Fresh gate run (mine):**
  - Command: `nice -n 19 sbt -J-Xmx3g "testOnly ..."` over 10 specs. These were the 5 new specs plus `PipelineCreateOrphanSourceRoutesSpec`, `PipelineRootRoutesSpec`, `PipelineApplyProposalSpec`, `FirstRunDashboardServiceRollbackSpec` and `PatchSetRoutesSpec`.
  - Result: `Tests: succeeded 58, failed 0`, `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, exit 0. All 10 specs appear in the log.
  - Log: `/home/matt/Development/helio/.concertino/runs/HEL-1475/HEL-1475-skeptic-final-targeted.log`. MemAvailable was 53 GB before the run. No sbt server was left running (no `project/target/active.json`).
- **testFull:** I did not re-run it. Production code is identical between 5de358368 and HEAD, so the executor's recorded testFull on 5de358368 (6822/0) is accepted as a claim, and my targeted run corroborates it.

### Verdict: REFUTE

### Change Requests

1. **AC2 / "every leak path gets a red-first test": the proposal-apply Connector cleanup has no test at all.**
   - The spec Requirement "Compensating an inline REST root also removes its implicit Connector" and AC2 both name "pipeline-proposal apply's own failure cleanup". The code is `PipelineProposalService.scala:385` (`implicitConnector = cfg.url.isDefined && cfg.connectorId.isEmpty`) carried into `rollbackSourceOnly` (`:570-572`).
   - No new or existing test drives `PipelineProposalService` and counts `connectors`. `grep -rln "FROM connectors\|Auto: "` over `backend/src/test` hits only `InlineSourceLeakPathsRoutesSpec`, `InlineSourceOrphanCountQueriesSpec`, `ConnectorRepositorySpec` and `V119OwnerFkMigrationSpec`. None of them applies a proposal.
   - So a mutation that sets that flag to `false`, or that drops it from `ResolvedSource`, would pass the whole suite. The path is reachable without fault injection: apply a proposal whose first source is an inline bare-`url` `rest_api` and whose second source fails to resolve (for example an unknown `sourceId`), which hits the `resolvedSoFar` rollback at `:146`.
   - Fix: add that test through the real apply route (or `PipelineProposalService.apply` with real repositories). Count `data_sources` and `connectors` by exact owner id before and after. Measure it red with the flag forced to `false`, and record that in `red-evidence.md`.
2. **`prod-count-queries.md` query (a) is mislabelled.**
   - It is described as counting "the HEL-1475 path 2 leak; a conservative count". It is neither. `DataSourceService.delete` (`DataSourceService.scala:649-685`) never touches a Connector. So every ordinary user deletion of a bare-url-created REST source, through `DELETE /api/data-sources/:id`, leaves its `Auto:` Connector unreferenced, and (a) counts it. (a) is therefore an UPPER bound on leaked Connectors, inflated by normal deletes.
   - It only undercounts in the renamed case, and that does not make it conservative overall.
   - Fix: relabel (a) as an upper bound on implicit Connectors left behind by any cause (this ticket's leak, or a normal source delete), as (b) already is. That way the PR body and the cleanup follow-up do not attribute the whole number to this bug. The query text itself is fine and read-only.

### Non-blocking notes

- `SourceService.createRest`'s compensation covers failures inside `createRestWithConfig(...)`'s returned Future, but not a synchronous throw while building `restConfig`/`QueryParams` between `connectorRepo.create` and that call. That throw would escape before `.transformWith`. Wrapping it as `Future.unit.flatMap(_ => createRestWithConfig(...))` would close the gap. Unlikely in practice.
- `ImplicitConnectorCleanup` is constructed per failure in `createRest`. That is harmless, but it could be a single field.
- The proposal-apply `newConnector` branch, a Connector created by the proposal itself, is outside this ticket. Worth adding to the 4.5 follow-up if its cleanup is also missing.
- `evaluation-2.md` is untracked in the worktree. Commit it with the next cycle so the archive carries both evaluation reports.
