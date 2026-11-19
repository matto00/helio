## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md as revised after skeptic-design-3.md (REFUTE, 8 CRs), working tree at HEAD 8cdc5525a06dd455bfef6d13ba94398ec0faa435. Spawn-cwd guard: READY ambient=/home/matt/Development/helio branch=task/rebalance-e2e-shard-weights/HEL-1772.

### What I verified (with evidence)

**The 8 change requests from round 3**

1. CR1 (C7 forbade task 2b). Resolved. tasks.md:9 now reads "No `timeout-minutes` change and no partition-logic change in e2e-shard.mjs; the matrix / max-parallel / `DEFAULT_E2E_LEGS` change is section 2b's, per the owner ruling".
2. CR2 (Non-Goals listed "changing the leg count"). Resolved. design.md:28 marks it as superseded by Decision 4.
3. CR3 (Migration Plan said "data-only"). Resolved. design.md:67 says the rollback covers the weights, matrix/max-parallel, `DEFAULT_E2E_LEGS` and the selftest edits in one revert, and gives the reason (the drift assertion).
4. CR4 (proposal "no change to the matrix"). Resolved. proposal.md:8 now scopes "comment-only" to the original change. proposal.md:11 says "no partition-logic or timeout change", which is consistent with the rest.
5. CR5 (run count). The contradiction is resolved. The section 3 heading defers to Decision 5, and the body (tasks.md:35) and Decision 5 (design.md:53) state the same rule: keep running attempts until there are 5 counting attempts or 7 attempts in total, whichever comes first, with never fewer than 3 attempts. "six legs" is now "all legs". My judgment on whether this is sound is in its own section below.
6. CR6 (selftest needs a task). Resolved in content. 2b.3 names the fixtures, the literals, the over-count and under-count invariants, the allowed explicit `--legs 4 ... 5-of-6` case, and the assertion message. It also requires both-direction proof, with (b) run after the fixture rewrite. proposal.md:25 now says the selftest does hardcode 6. A new ordering defect came with it; see "New finding" below.
7. CR7 (MISTAKES.md:211). Resolved. 2b.4 names `MISTAKES.md:211` and widens the grep to "6 legs", "six legs", "~8 legs", "never add legs", "4 + e2e 6" and "backend 4 + e2e". I ran my own `git grep` outside archive and this change dir. Every leg-count statement it found is covered by 2b.2 or 2b.4:
   - ci.yml:614/616/622 (the e2e comments, 2b.2)
   - MISTAKES.md:211
   - e2e/README.md:140 ("default 6 legs") and :146 ("runs 6 legs")
   - playwright.config.ts:192 ("runs 6 legs")
8. CR8 (disclosure). Resolved, and I re-checked it against the GitHub API (`/actions/runs/44410691147/attempts/{1,2,3}/jobs`).
   - att1: leg 4 `failure` at 1433 s, the other legs 1266/1090/922/967/1031.
   - att2: leg 1 `failure` at 1211 s, the other legs 946/965/1016/1172/1395.
   - att3: all six legs `success`, 1340/931/1061/1274/1003/1001.
   - These match Decision 4 (slowest 1433/1395/1340) and its disclosure (only att3 counts).
   - `playwright.config.ts:190` confirms `retries: 0`.

**Ground truth re-checked**

- Spec `openspec/specs/e2e-ci-sharding/spec.md`:
  - The balance requirement (lines 41-47) needs "at least five sequential CI runs", and a run counts only if every e2e leg succeeded and every report is present.
  - The headroom requirement (lines 59-63) says the leg count is an owner decision recorded with the change, and must be measured on 5 consecutive all-green main runs. Decision 4 records the owner decision; Decision 3 handles the main runs as a post-merge watch.
- `scripts/e2e-shard.mjs:172-173`: `DEFAULT_E2E_LEGS = 6`; `EXPECTED_SHARD_REPORTS = DEFAULT_E2E_LEGS`. So deriving the fixtures from `EXPECTED_SHARD_REPORTS` makes a constant-only change reach the drift test at selftest:194-200, as 2b.3(b) intends.

### New finding: the 2b task order makes two verify steps unreachable as written (non-blocking, but the executor must follow the order below)

I reproduced the 2b.2 end state in a scratch copy (`.concertino/scratch/HEL-1772/skeptic/r4/`): `DEFAULT_E2E_LEGS = 7` plus `shard: [1..7]` and `max-parallel: 7`, with the selftest not yet rewritten. `node scripts/e2e-shard.selftest.mjs` exits 1:

```
Error: runX: expected exactly 7 shard reports, found 6 [1,2,3,4,5,6]
    at .../e2e-shard.selftest.mjs:155:64
```

- 2b.2's "Verify: the selftest passes" therefore cannot pass until 2b.3's fixture rewrite exists.
- 2b.1's "FAILS, naming the leg-count mismatch" depends on the assertion message that 2b.3 adds. Without it the failure prints only `7 !== 6`.

The end state and both mutation proofs are fully specified, so this is a sequencing nit, not a design flaw. The executor should do it in this order:

1. 2b.3's fixture rewrite and drift-assert message first, still at 6 legs. The selftest must pass, so the refactor is behavior-preserving.
2. Then 2b.1's red (matrix-only change, which also gives 2b.3(a)).
3. Then 2b.2.
4. Then 2b.3(b): a constant-only mutation from the 6/6 state, or revert the matrix from 7/7.

### Judgment on CR5's choice (5 counting or 7 total, never fewer than 3, gap stated)

It is sound, with a caveat.

**For:**
- The owner's ruling sets the measurement floor at "at least 3 attempts" and forbids re-escalation on a miss.
- The spec's 5-run line is a reporting bar. The design already plans to disclose two other unmet clauses in it: the control set, and the 15 s line the owner accepted as a gap at HEL-1361.
- An uncapped "until 5 counting" loop has no bound. The 6-leg PR had 1 counting attempt in 3, and main had about 5 clean runs in 11. Each attempt occupies 11 runners for about 20 minutes in a pool shared with sibling lanes, so a cap is a legitimate cost control.
- Known-flake failures don't inflate wall times (`retries: 0`). So non-counting attempts still give real slowest-leg data, and the plan reports them per attempt.

**Caveat:**
- At an estimated per-attempt counting rate of 0.33-0.5, P(at least 5 counting in 7) is about 5-23%. The plan will most likely end with the spec bar disclosed as unmet, so the PR must say so prominently, not bury it.

### Verdict: CONFIRM

All 8 round-3 change requests are resolved. The figures check out against the API. The leg-count statement inventory is complete. The run-count rule is internally consistent and defensible. The one new defect (2b task order) has an unambiguous fix, given above, which the executor applies in the order it works.

### Non-blocking notes

- Execute 2b in this order: fixture rewrite and assert message at 6 legs, then 2b.1 red, then 2b.2, then 2b.3(b) mutation. Record each output.
- CR5 follow-through: if the 7-attempt cap ends with fewer than 5 counting attempts, the shortfall can be closed after merge. Decision 3 already plans a Phase 4 watch of 7-leg main runs, and the same counting main runs can complete the 5-run balance set. Say that in the PR. Also consider a delivery note under the spec's balance requirement, as HEL-1361 did, so the gap is recorded durably and not only in a PR body that may auto-merge unreviewed.
- design.md:1-3 Context still says "across the 6 `e2e` legs". That is accurate as the before-state, and fine as context.
