## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed HEAD `54c2f222e09adcaa49fcf0b86bf643a3fc3f3426` (planning artifacts uncommitted in the change dir). Read design.md, tasks.md, specs/pipeline-run-sse/spec.md, skeptic-design-4.md; re-checked against `PipelineRunService.scala` and existing test precedents.

### What I verified (with evidence)

**Round-4 CR1 is addressed in design.md D4 assertion 3, point by point.**
- (a) One dedicated connection per lock: "Each lock is held on its own dedicated JDBC connection. In the succeeded case that means one connection for the `pipeline_runs` row and a separate one for the `node_snapshots` table lock." Present.
- (b) `pg_blocking_pids`: "assert that some service backend `w` (a pid that is not any test connection's) has that lock's holder-connection pid in `pg_blocking_pids(w.pid)`." Present.
- (c) No keying on ungranted relation entries for row locks: stated explicitly, with the correct reason (a row-lock wait shows up as a `transactionid`/`tuple` wait). The optional tuple-lock tie-in was dropped rather than mis-specified. That is acceptable.
- No "exactly one waiter" assertion: explicitly forbidden, citing `persistAssertions`.
- Staged-release step 2 now uses the same `pg_blocking_pids` form against the `node_snapshots` holder connection's pid.
- tasks.md 1.2 references "one connection per lock + pg_blocking_pids non-vacuity". Tasks and design are consistent.

**The check is satisfiable for each lock.** This is reasoning from Postgres semantics, corroborated by the round-4 probe.
- **Row locks** (`pipeline_runs` FOR UPDATE vs `updateRunTerminal`; `pipelines` FOR UPDATE vs `insertDryRun`'s FK KEY SHARE check):
  - The first waiter waits on the holder's `transactionid`, so `pg_blocking_pids` returns the holder pid.
  - A queued second waiter may instead report the first waiter. The "some `w`" quantifier tolerates that.
- **`node_snapshots` EXCLUSIVE table lock:** `overwriteRows` waits on the relation lock, so the holder pid is in `pg_blocking_pids`.
- **Staged step 2:** after the row-lock connection releases, the remaining blocked backend's only blocker is the table-lock connection. Even if `node_snapshots` writes also carry an FK to `pipeline_runs`, the relation lock is acquired before the FK check, so the wait is on the table lock.
- **No false positives from test reads.** Assertion 2 uses plain SELECTs. These take ACCESS SHARE, which is compatible with EXCLUSIVE, and MVCC reads do not block on FOR UPDATE.

**Red-first ordering still holds on unmodified code.**
- The succeeded publish is still the first statement at `PipelineRunService.scala:1397`.
- All terminal publishes route through `publish` (:984), and the pre-publish segments touch none of the locked rows/tables.
- So assertion 1 (no terminal event) fails first on the pre-fix code, before any non-vacuity check could run. The red log will show the ordering assertion, not a timeout.

**Buildability.**
- `pg_blocking_pids` / `pg_backend_pid()` are standard Postgres (9.6+).
- Dedicated `DriverManager.getConnection` connections outside the pool have test precedent: `PipelineApplyProposalUpsertTargetSpec.scala:16` and `SqlConnectorTlsSpec.scala:52` (`pg_backend_pid()`).
- The gating-backend precedent file `PipelineRunGuardIntegrationSpec.scala` exists.

**No new defect introduced.**
- D1, D2, D3, D5, the spec delta and the task-to-AC coverage are unchanged from round 4, which found them sound.
- No placeholders/TBDs.

### Verdict: CONFIRM

### Non-blocking notes
- The executor should capture each holder connection's pid via `SELECT pg_backend_pid()` on that connection. It should also define "test connection" pids as the set of all dedicated connections the spec opens, so a read helper on its own connection is excluded too.
- The non-vacuity poll should retry within a bounded window (waiters attach asynchronously after the gate opens). A single immediate `pg_locks` sample could be vacuously empty and flaky.
- Carried forward: a 429 rate-limit/concurrency rejection publishes `queued` with no terminal event. This is out of scope.
