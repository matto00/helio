## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/e2e-shard-weights-slow-lane/HEL-1667`. HEAD is fb684d03b0010e030f80db62f45a2003957344a6. The only worktree change is the untracked change dir.
- **Round-1 CR1 (AC2 evidence) is addressed.** D5 now has the orchestrator dispatch `gh workflow run e2e-slow.yml --ref main` after merge and record the run id, conclusion and the MAXIMAL 390/768 log lines. Task 4.1 matches. The PR-trigger run is labelled pre-merge proof only.
- **Round-1 CR2 (stale gate text) is addressed.** D6 and task 2.3 narrow the non-goal to "no behavioural change" and verify with a comment/string-only `git diff`. I grepped the tree for `nightly|18-minute|18 minutes|slow lane|slow-lane` across e2e/, scripts/, .github/, docs/, CONTRIBUTING.md and MISTAKES.md. The only hits are `e2e/support/hel1582Phone.ts:396,398,401` and `e2e/hel1582-sweep-{390,768}.spec.ts:5-6`, which is exactly D6's scope. The 375 spec's header has no stale wording. The other "nightly" hits are fixture strings that have nothing to do with this change.
- Round-1 non-blocking notes are folded in: the separate pgrep/pkill grep (Planner Notes, task 3.1), the concurrency-cap note, and the explicit comment-only `ci.yml` edit (task 2.4).
- Gate shape: `hel1582Phone.ts:399-402` is `test.skip(size.width !== 375 && HELIO_E2E_SLOW !== "1", ...)`, and the 390/768 files each register one size. With the env var set, D4's `skipped == 0` guard is sound. `playwright.config.ts:139` has `retries: 0`, and the JSON reporter is CI-only (l.151), which matches D4's `CI=true` assumption.
- `ci.yml` e2e job (l.549-705) is self-contained (no `needs`, no cross-job artifacts), so D3's "mirror verbatim in one job" is feasible. It uses the sbt cache restore-only (`HEL-1299 D1`), `scripts/e2e-backend.sh start/wait` and Vite on 5173.
- Workflow-scanning guards: `check-ci-complete-needs`, `check-precommit-ci-parity` and `check-ci-sbt-no-pattern-kill` read `ci.yml` (plus named scripts) only. `check-cache-cleanup-pr` reads only `cache-cleanup-pr.yml`. Nothing forces the new workflow into `ci-complete`.
- Shard mechanism: `nice -n 19 node scripts/e2e-shard.mjs plan 4` ran at HEAD. Its defaulted list is hel1631, hel1656, hel1665, hel1668-{editor-phone-refresh,header-meta,phone-sheet,schema-panel-copy}, hel1681 and hel1683, which matches the proposal and task 1.1. The `# Runs:` header is `basename(runDir)` (`e2e-shard.mjs:268`). The current TSV was last regenerated in d0c600fbf (HEL-1668), as D1 says.
- CI facts via `gh`: run 39542663790 e2e legs took 20m17s, 24m58s, 22m06s and 20m18s, so the proposal's 24m58s is correct and the current spread is about 4m41s. Main push runs in retention are 39619844110 (success, 4f729eed7, contains hel1681), 39542663790, 39477341305 and 39334077998 (success), plus several failures the validator will judge. fb684d03b's run 39689629368 is still in progress. D1 is feasible.
- Owner ruling (weekly) is consistent across the proposal, D3 cron `17 10 * * 1`, C1 and the spec. Not re-litigated.
- No TBD or placeholders. Proposal, design, tasks and spec do not contradict each other.

### Verdict: REFUTE

### Change Requests
1. **AC1 has no defined pass/fail measure, so "done" can be read two ways.** D5 and the Risks section say to report whole-leg and test-step durations separately. The design itself notes that whole-leg time includes non-test setup noise (sbt compile, DNS retries) the weights cannot balance. But neither D5 nor task 4.2 says which of the two AC1 ("slowest leg within 2 min of fastest on main") is judged on. They also don't say how many main runs count: "the first post-merge main push run(s)" could be one run or a median. On the evidence above (current whole-leg spread about 4m41s), the choice can decide pass or fail. An unstated choice lets whoever runs 4.2 pick the metric that passes. Revise D5 and task 4.2 to state:
   - (a) the metric. Since the ticket's motivation is timeout headroom, I'd expect whole-leg wall time, with test-step reported alongside. If you pick test-step, justify it.
   - (b) the sample: for example, the median spread over the first N (N ≥ 3) post-merge main push runs where all 4 legs succeeded, plus the max.
   - (c) what happens on a miss: re-measure, hand back to the driver, or escalate. Don't silently report it as met.
   
   This is a wording change to D5 and task 4.2 only.

### Non-blocking notes
- D3 `concurrency` per ref with `cancel-in-progress`: a manual dispatch on main during the weekly scheduled run would cancel one of them. That's harmless, but consider `cancel-in-progress: false` (or grouping by `github.run_id` for schedule) so the AC2 evidence dispatch can't be cancelled by a coincident cron fire.
- D6 sits after D4 and before D5 in the design. It's cosmetic; reorder for readability.
- The weights for `hel1582-sweep-{390,768}` will come from PR-CI runs where MAXIMAL is skipped. That is correct for PR-leg balancing, and needs no change; just don't read those rows as slow-lane cost.
