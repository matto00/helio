## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Read all artifacts plus NodePayloadHistoryRepository.scala (insertAndTrim, purge), OutputHistoryRepository.scala (thinAndPurge, PurgeAdvisoryLockKey private[persistence], same package so reachable), NodeSnapshotRepository.overwriteRowsAction, PipelineRunService ~1425-1475, V115/V116, OutputHistoryRetentionService.
- D1 statement audit of the run-side node tx (one withSystemContext tx): ownerLimit SELECT (plain read, no row lock); DELETE/INSERT node_snapshots (retention never touches that table); INSERT node_payload_history (new uncommitted row, invisible to retention; FK KEY SHARE on pipelines, which retention only reads via DELETE...USING, never locks); guarded trim; insertAction batch INSERT into output_snapshot_history (new rows; FK KEY SHARE on outputs and on its own new payload; V115/V116 declare no unique constraints, so no insert-vs-delete wait). Retention statements (thinAndPurge age/thin DELETEs, purge disallowed/age/count/unreferenced DELETEs) all run only after pg_try_advisory_xact_lock(key) returned true. Shared vs exclusive on one key conflict, so the only statement that can row-lock retention-visible rows (the trim and its SET NULL cascade) is excluded while retention runs, and retention's try fails while any run trim holds shared. Both sides use try, so the key itself cannot deadlock. The claim holds. Run-vs-run trims on one node contend on a single payload row (no cycle); nodes in a run are sequential (foldLeft).
- D2 determinism: with A holding the key and a delete on the ctid-last linked point, pre-fix B locks P_old and earlier points then waits on A; A then deleting an earlier point closes the cycle. Real pre-fix behaviour is therefore a genuine red (the Future blocks, then 40P01 after deadlock_timeout). Synchronising on pg_locks/pg_stat_activity is sound. The existing OutputHistoryRepositorySpec:272 already uses the same holder-connection pattern.
- No migration, NodeSnapshotRepository untouched, ACs all mapped (probe, fix + explanation, red test, never fail a run). Spec delta consistent with design.

### Verdict: CONFIRM

### Non-blocking notes
- deadlock_timeout is SUSET: lower it (e.g. 100ms) on the test sessions as the superuser before SET ROLE, otherwise the probe takes ~1s per run; it does not affect determinism.
- In the red-without-fix run the regression's run Future will block; bound it with a timeout and make cleanup (A deletes the remaining point and rolls back, awaiting the Future) unconditional so the red transcript is a clean assertion failure, not a hung pool.
- Probe's who-is-victim is nondeterministic; assert 40P01 on either, as planned.
- Assert the cascade order empirically (ctid) as designed; tiny tables may seqscan or use the partial index, both TID-ordered, but assert it anyway.
- Rolling-deploy claim: old instances (no guard) retain the deadlock window until replaced; correct but say "transient" in the PR.
- Starvation residual (claim() consumes the interval on skip) is correctly disclosed.
