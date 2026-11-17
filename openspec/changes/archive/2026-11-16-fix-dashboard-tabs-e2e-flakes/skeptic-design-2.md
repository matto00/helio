## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
- Spawn guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/dashboard-tabs-e2e-flakes/HEL-1644`. The worktree HEAD is d9c6585a8c939c2d8148d0a1af9943006aa01a96, the main tip.
- I read ticket.md, proposal.md, design.md, tasks.md, workflow-state.md, .openspec.yaml (`skip_specs: true`) and skeptic-design-1.md in full.
- **Round-1 CR1 (no rule if test B never fails): resolved.** Decision 2 now gives one budget for both tests: 40 alone, then 200 alone, then the whole file x10, then 100 alone under a 4x CDP CPU throttle (probe only, reverted). Decision 6 and task 1.4 now cover "either test" and say to stop and escalate. They forbid inventing a fix for a flake that was never reproduced.
- **Round-1 CR2 (runs not pinned to this lane's servers): resolved.** Decision 1 and new constraint C3 require all of the following, and C3 is recorded in the CONSTRAINTS of workflow-state.md:
  - `start-servers.sh` on 7076/9983
  - a pass from `assert-phase.sh servers`
  - `DEV_PORT=7076 BACKEND_PORT=9983` set explicitly on every Playwright command line
  - the exact command recorded in `repro.md`

  `playwright.config.ts:8-19` confirms the 5173 fallback, which only prints a warning, so the constraint is needed.
- **Round-1 CR3 (the CI failure not read): resolved.** Decision 0 and task 1.0 now read the d777803c1 job log before any local run. `git cat-file -t d777803c1` returns `commit`, so the reference is real.
- I checked the design's factual claims against the tree:
  - Test A is at `e2e/hel1575-dashboard-tabs.spec.ts:593` and test B at `:641`, with the titles the design gives.
  - `waitForTimeout(800)` is at `:609`.
  - `jumped` is read inside the route handler after `await route.fetch()` (`:622-630`). The design's Decision 8 candidate mechanism, "a request issued before the jump whose response lands after it is also shifted", therefore matches the code.
  - `git show --stat 4f729eed7` confirms that HEL-1681 touched this spec (+14 lines).
- Round-1 non-blocking notes:
  - whole-file vs alone counting: folded into Decision 2.
  - `waitForTimeout(800)`: folded into Decision 8.
  - the `jumped` mechanism: folded into Decision 8.
- Scope:
  - AC1 maps to tasks 1.x and 4.1/4.2.
  - AC2 maps to task 3.2, with red shown by reverting the fix.
  - The fence against HEL-1634 (Decision 7 / task 2.3) is intact.
  - There is no scope drift and there are no placeholders.

### Verdict: REFUTE

### Change Requests
1. **The post-fix check cannot show that the fix worked, and it contradicts the design's own "like with like" rule.** Tasks 4.1/4.2 and Decision 2 count "40/40" as one run of the test alone with `--repeat-each=40`. The ticket puts test A's base rate at about 1 in 40. At that rate an unfixed test passes 40/40 about 36% of the time (0.975^40). Test B has one CI failure on record, so its rate is lower still. Worse, Decision 2 exists because step (a) may not reproduce at all. If the first failure shows up only at step (b) 200 alone, (c) the whole file x10, or (d) the throttled 100 alone, then the before measurement is a failure under that condition. A plain 40/40 afterwards is a different condition, and the unfixed code could also have passed it. That breaks the design's own "before/after compare like with like" sentence, and it breaks the verification law's "the original symptom's probe now passing (was failing before)". Required revision to design.md Decision 2 and tasks 4.1/4.2:
   - Keep the 40/40-alone run. The AC requires it literally.
   - **Also** re-run, with identical parameters, the Decision 2 step that first produced the failure: the same repeat count, scope and throttle. Require zero failures and record the result in `repro.md` next to the before count.
   - Where the root-cause probe can force the race deterministically, show the forced run red on the unfixed test and green on the fixed one. Examples: delay the `/api/dashboard-changes` response until after `fastForward`, or delay an IndexedDB write until after logout's delete. That red/green pair is what proves a test-race fix, and the e2e analogue of 3.2's red-first rule for an app fix.

### Non-blocking notes
- Decision 6 says "the other test's work continues meanwhile". If the orchestrator's escalation mechanism pauses the whole run (`PENDING_ESCALATION`), say whether the escalation for one test is raised only after the other test reaches a stopping point. Otherwise the two may collide.
- workflow-state.md still has `TICKET_TYPE: feature` for a bug ticket. This was noted in round 1; it is cosmetic.
- Step (d) CPU throttling is a probe edit to the spec. Note in `repro.md` the commit or diff that was reverted, so the evaluator can confirm the tree is clean.
