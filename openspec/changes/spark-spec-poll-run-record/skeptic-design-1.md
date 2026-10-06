## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- SparkJobSubmitter.scala lines 85/93 (success) and 109/113 (failure): updateLastRunInternal then updateRunTerminalInternal, both called as bare statements, Futures discarded (un-awaited). design.md's claim is true; commit order is not guaranteed.
- SparkJobSubmitterSpec.scala lines 381-383 / 418-420: assertions read lastRunStatus first (findByIdInternal), then listByPipeline (status/rowCount/errorLog), then cache. A run-row-only poll would leave the lastRunStatus assertion racing. Decision 2's conjunct (run row terminal AND lastRunStatus defined) is therefore necessary, not gold-plating.
- Predicate checks "defined", not the expected value, so the poll does not encode assertions; wrong values still fail on the unchanged assertion. Within AC ("poll the run record ... leave assertions unchanged"): it still polls the run record, bounded (30s Eventually), and adds the other write the assertions need.
- Mutation plan: M1 (sleep between the two writes) makes a lastRunStatus-only poll return while the run row is Running -> red at runs.head.status; new poll waits for terminal -> green. M2 (swap order + sleep) makes a run-only poll return while lastRunStatus is None -> red at line 383; new poll green. Both genuinely discriminate, and M2 is what justifies the conjunct. The reconstruction of the HEL-1287 poll is disclosed as such (never landed in git). Acceptable.
- No product code or assertion change planned: proposal Impact is the spec file only; tasks C1/C2 forbid src/main edits and require assertion diff checks; mutation edits are reverted with git diff --stat check (task 2.5). Worktree has only the untracked change dir so far.
- Failure-path nuance: cache is written synchronously before both writes, so no poll term is needed for it (correct).

### Verdict: CONFIRM

### Non-blocking notes
- Task 3.1 timing: the before-measurement on main must be run in a state with sleeps intact; ensure results are recorded verbatim.
- Mutation edits must be reverted before any commit; a tracked diff check at 2.5 covers it, also run it after 2.4.
- Follow-up (write-order/un-awaited writes) is correctly note-only.
