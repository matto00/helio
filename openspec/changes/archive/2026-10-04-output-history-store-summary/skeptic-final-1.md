## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 70c72bfd923ce48f288d940569beddca9e3708e3. The base was resolved live with `resolve-review-base.sh` (main/origin) as f09ba92f63ab2a5407b10146c523498d708f519d. The range contains two commits: a1282e87 and 70c72bfd.

### What I verified (with evidence)

**Gate, my own fresh run.**
- `nice -n 19 sbt testFull` passed: `Tests: succeeded 5814, failed 0` / `All tests passed.` / EXIT=0, first try.
- The cost spec's output from the same run:
  - without history: 1026 statements / 0 batches / 91 ms
  - with history: 1027 statements / 1 batch / 82 ms
  - delta: +1 statement (the config query) and +1 JDBC batch; reducer CPU 1870 µs for both Outputs.
- Jest `aggregate.fixture`: 57/57 passed.
- `sbt --client shutdown` was run separately.

**AC 1: two real runs give 2 rows, and each excluded path gives 0.** These are my own mutations, applied together and restored with `git checkout --`. Each red is attributable to exactly one mutation, and each failure was for the asserted reason, not a precondition:
- Blocked path routed through `onUnblockedRunSuccess` before `onBlockedRun`: "write none for a blocked run" went red with `2 was not equal to 0` (spec:156).
- Backfill `persistBackfilledRows` switched to `overwriteRowsWith` plus a history insert for the pipeline's Outputs: the backfill test went red with `1 was not equal to 0` (spec:189).
- The evaluator's cycle-1 mutations (dry run routed to `onRunSuccess`, write-back `Left` routed to the unblocked path) already covered the dry-run and write-back tests. A mutation that reaches the branch proves the precondition, so I did not repeat them.
- Failed-run test: in the same run, the log shows `Pipeline execution failed for pipeline …, run …: invalid step configuration at step … (compute)`. That is the engine-failure path (`executeRunFailure`), not a rejection before the run. This matches the evaluator's status=failed probe.

**AC 2 / D9: rollback is real.**
- Mutation: `overwriteRowsWith` split into two separate `ctx.withSystemContext` calls.
- Repo-level `NodeSnapshotOverwriteRowsWithSpec` went red: `Vector(1, 2, 3, 4, 5) was not equal to Vector(1, 2)`.
- Service-level rollback went red: `Vector({"amount":"10"},{"amount":"20"}) was not equal to Vector({"amount":"999"})`.
- Restored, then 19/19 green.
- Code: `NodeSnapshotRepository.overwriteRowsWith` = `ctx.withSystemContext(overwriteRowsAction(...).andThen(andThen))`. The inner `.transactionally` nests inside the outer one from `DbContext.scala:64`.
- The history write has no `recoverWith`, so it is not best-effort.

**AC 3: cascade.** V115 has `REFERENCES outputs(id) ON DELETE CASCADE`. The cascade test checks both the deleted Output's rows and that other Outputs' rows survive. The evaluator showed it red with the FK cascade removed.

**AC 4: the reducer matches aggregate.ts on shared fixtures, and the expectations come from the real TS.**
- The Jest test imports the real exported `computeAggregate`/`groupAndAggregate` and drives coerce cases through `max`, so null is distinguishable from 0.
- Oracle check: I hand-corrupted two fixture expectations (blank → 0, and the 2^63 group key → its exact integer). Jest went red (`2 failed, 55 passed`). Restored with `git checkout --`.
- The fixture covers every case listed in design D-2: JS-grammar strings, NBSP/BOM trim, Java-only suffixes, and ES `Number::toString` keys including `5e-324`, `1e-323` and `9223372036854776000`.

**AC 5: RLS proof is non-BYPASSRLS, and the INSERT rejection comes from the policy.** My own mutation of V115:
- SELECT policy keyed on direct Output ownership instead of `helio_can_access_pipeline`: "grantee SELECT" went red (`0 was not equal to 1`), while the owner and non-grantee checks stayed correct. The grantee case is therefore discriminating.
- INSERT policy `WITH CHECK (true)`: both "reject INSERT with no user context" and "reject INSERT by a non-grantee" went red.
- helio_app_test holds `GRANT … ON ALL TABLES` in that spec, so the rejection cannot be a missing grant.
- The pool asserts `rolbypassrls = false` for `current_user`.
- Restored, then green.

**AC 6: guard specs updated.**
- RlsPolicyGuardSpec registers the table.
- RlsPrivilegedDmlSpec covers SELECT/INSERT/UPDATE/DELETE and adds the table to `cleanDb`.
- FlywayNonSuperuserMigrationSpec migrates to latest with no target cap as `helio_migration_test` (NOSUPERUSER NOBYPASSRLS; second `migrate()` at :279-286). It then runs `SELECT relforcerowsecurity … WHERE relname='output_snapshot_history'` with `.head`, which throws if the table is missing. So V115 applying under a non-superuser is genuinely proven. Green in my run.

**AC 7: repository primitives.** `listRecent` (tiebreak and limit), `nearestAtOrBefore` (exactly-at, before-first, empty), `earliest`, and `thinAndPurge` each have tests. The `thinAndPurge` tests cover each age class, isolated buckets, per-Output independence, per-tier purge with absent tiers, and idempotence. I read the SQL against D4:
- Buckets are epoch-aligned and keep the newest point.
- Age classes are 24h / 7d.
- Tier max age is joined via `outputs.owner_id → users.tier`.
- Every value is `$`-bound, with no `#$`.
- `insertAction` is a lifted `++=`, so `summary` is a bound JSONB parameter.

**AC 8: cost is measured, not asserted.** The spec wraps the real DataSource, Connection and Statement in a JDBC proxy and counts `execute*` and `executeBatch` calls. It takes the median of 7 runs over 1000 rows with a metric and a chart Output. The query-count delta is stable across three independent runs (two by the evaluator, one by me): +1 statement and +1 batch. The wall-time delta is within noise (+4, +7 and −9 ms), which is itself the honest finding.

**Defect probes the loop did not cover.** I used a temporary spec (`SkepticHel1271ProbeSpec.scala`) and deleted it by exact path afterwards.
- **Editor-grantee-triggered run:** succeeds, and records a history point per Output with `run_id` set and `trigger_source=scheduled`. `pipeline_runs` has only the owner's run row, which is exactly why D7 has no FK.
- **root_id / node_step_id:**
  - Root-bound Output: history row has `node_step_id NULL` and `root_id = <root>`.
  - Step-bound Output: history row has `node_step_id = <step>` and `root_id NULL`.
  - Both match the `node_snapshots` key shape for the same nodes.
- **Output on a disabled (non-transforming) step:** the node is still materialized (snapshot present), and it gets its history point. Outputs on nodes absent from `nodeOutcomes` get neither a snapshot nor history, consistent with before.
- **Persisted JSON shape (read back from JSONB):**
  - metric: `{"v":1,"metric":{"agg":"avg","field":"amount","value":10.0},"series":null,"columns":{},"rowCount":3,"columnsTruncated":false}`
  - chart: `"series":{"mode":"rows","x":"day","y":"amount","agg":null,"points":[["d1",10.0],["d2",null],["d3",null]],"totalPoints":3,"downsampled":false}`
  - A non-coercible `"x"` and a null both map to null y. A column holding a non-numeric string is correctly excluded from `columns`. This matches design D-2.
- **Snapshot writers:** a grep confirms only two production writers of `node_snapshots`. `onUnblockedRunSuccess` uses `overwriteRowsWith`; the backfill uses `overwriteRows`, which carries no history.

**Iron-law notes.** This is a feature, not a bug fix, so there is no debugging-law obligation. C2's red-first evidence exists for every exclusion, rollback and cascade test: either the evaluator's recorded reds or my own reproductions above.

**Worktree state.** Clean apart from the untracked evaluator reports and this report. Every mutation was reverted with `git checkout --`, and the probe file was removed by exact path. I did not touch the shared dev DB; every probe used embedded Postgres.

UI judgment does not apply: the only `frontend/**` change is a Jest test.

### Verdict: CONFIRM

### Non-blocking notes
- `PipelineRunService.historyConfigs`'s doc comment says `outputs` "was already ACL-scoped by `listByPipelineInternal`". That is inaccurate: `listByPipelineInternal` is an unscoped privileged read (`OutputRepository.scala:101-104`). The real ACL is `submit`'s `findByIdShared` plus the editor-grant check. The comment is worth correcting in a later leaf so nobody relies on it.
- The cost spec measures whole-run wall time rather than the node transaction alone (design D-6 wording). At 1000 rows the wall delta is below run-to-run noise, so the query-count delta is the meaningful number for the PR body.
- For L2: `thinAndPurge` never age-purges a tier missing from `maxAgeByTier`, so L2 must pass all three tiers.
- For L3/L5: grouped-series mode mirrors `OutputPreviewPane`, not the dashboard, where `chartAggregate` is always null. The y coercion uses `coerceNumber`, not the dashboard's `parseFloat`. Both divergences are already recorded in design.md Risks.
