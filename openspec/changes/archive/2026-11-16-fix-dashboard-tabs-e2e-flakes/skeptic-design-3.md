## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)
- Spawn guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/dashboard-tabs-e2e-flakes/HEL-1644`. HEAD is d9c6585a8c939c2d8148d0a1af9943006aa01a96, the main tip. The change dir is the only untracked content.
- I read ticket.md, proposal.md, design.md, tasks.md, workflow-state.md and both earlier skeptic reports in full.
- **Round-2 CR1 (the post-fix proof could not show the fix worked): resolved.** Decision 2 now requires three things:
  - (i) the literal 40/40 alone, with its weakness stated (about 36% false pass);
  - (ii) zero failures when the step that first failed is re-run with identical parameters;
  - (iii) a forced-race run that is red on the unfixed code and green on the fixed code, or a written reason why forcing is impossible.

  Tasks 4.1 and 4.2 carry all three parts.
- **Round-2 non-blocking notes:** both are folded in. Decision 6 now raises one combined escalation after the other test reaches a stopping point. Decision 2 now requires a record of the probe diff and its revert. The Planner Notes explain the `TICKET_TYPE` flag.
- **Design facts against the tree.** Test A is at `e2e/hel1575-dashboard-tabs.spec.ts:593` and test B at `:641`. `waitForTimeout(800)` is at `:609`. The `jumped` flag is read after `await route.fetch()` (`:622-626`), which matches Decision 8.
- **Test B's body is unchanged since the CI failure.** `git show d777803c1:e2e/hel1575-dashboard-tabs.spec.ts` lines 627-635 are identical to the current lines 641-649. The CI failure is therefore evidence about the current test.
- **Decision 0's literal command returns nothing.** I ran each form twice:
  - `gh run list --commit d777803c1 --limit 20 | wc -l` gave `0`, with exit status 0.
  - The full SHA, `gh run list --commit d777803c1fbdf45f093584527ed4c052c8ad992f`, lists the run: `completed failure HEL-1578 Home page ... CI main push 38987195427`.

  `gh` does not expand short SHAs, so the command the design prescribes finds no run and does not error.
- **The evidence Decision 0 is after does exist.** `gh run view 38987195427 --log-failed`, job `e2e (3)`, log line 1658, shows `✘ 48 e2e/hel1575-dashboard-tabs.spec.ts:627:7 › ... logout clears the browser-stored warm copy (13.2s)`. Line 1770 names the failing step as `Expect "poll toBe"`, which is the final count poll, not `waitForURL` and not the `>= 1` precondition. The log is about 31 days old, inside GitHub's retention window.
- **The logout path changed after the failure.** `git log d777803c1..HEAD` touches `authSlice.ts` once: c1add2394 (HEL-1631) added `clearKeptDrafts()` before `awaitWarmClear()`. The comment beside that call says the wait is "bounded at 1 s".
- Scope is unchanged from round 2. AC1 maps to tasks 1.x and 4.1/4.2, AC2 to task 3.2, and the HEL-1634 fence is Decision 7 / task 2.3. There are no placeholders.

### Verdict: REFUTE

### Change Requests
1. **design.md Decision 0 and tasks.md 1.0: the prescribed command finds no CI run and reports no error.** `gh run list --commit d777803c1` returns zero rows (reproduced twice) because `gh` needs the full 40-character SHA. An executor who follows the plan word for word gets an empty list. It is then natural to record "no CI run found for test B". That empty result looks like evidence but is not, and it removes the only real failure on record for test B. Decision 6's escalation for test B depends on exactly that log. Required revision:
   - Replace the command with the full SHA (`gh run list --commit d777803c1fbdf45f093584527ed4c052c8ad992f`), or name the run directly: `gh run view 38987195427 --log-failed`.
   - State that an empty result is an error to investigate, not a finding.

### Non-blocking notes
- What I read in the log, which Decision 0 should confirm independently: test B failed at the final `expect.poll(...).toBe(0)` after 13.2 s. Its first probe should therefore target entries that remain after logout, not navigation.
- The logout comment says `awaitWarmClear` is "bounded at 1 s". If the delete can outlast that bound, logout returns before the clear finishes, and that is a candidate mechanism. Probe it under Decision 8; do not assume it. HEL-1631 (c1add2394) added a step before `awaitWarmClear` after the CI failure, so record in `repro.md` that the measured tree differs from the one that failed in CI.
- Decision 2(ii) adds nothing over (i) when the first failure comes at step (a): both are 40 runs of the test alone. In that case the real proof rests on (iii). If (iii) is declared impossible, consider requiring a larger post-fix count (for example 200 alone) rather than accepting two weak 40/40 runs.
