## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)
- Spawn guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/dashboard-tabs-e2e-flakes/HEL-1644`. HEAD is d9c6585a8c939c2d8148d0a1af9943006aa01a96, the main tip. `git status --short` shows only the untracked change dir, so the tree is clean.
- I read ticket.md, proposal.md, design.md, tasks.md, workflow-state.md and skeptic-design-1..3.md in full.
- **Round-3 CR1 (Decision 0's command returned nothing): resolved.** Decision 0 and task 1.0 now name the run directly (`gh run view 38987195427 --log-failed`) and give the full SHA for `gh run list`. Both say that an empty result is an error to investigate, not a finding. I ran `gh run list --commit d777803c1fbdf45f093584527ed4c052c8ad992f` and it returns rows. It does not return an empty list.
- **Round-3 non-blocking notes: folded in.**
  - Decision 0 now records that HEL-1631 (c1add2394) changed logout after the CI failure.
  - Decision 2(iii) now falls back to 200/200 alone when the race cannot be forced, so two weak 40/40 runs are no longer accepted as proof.
- **Facts checked against the tree.**
  - Test A's title is at `e2e/hel1575-dashboard-tabs.spec.ts:593`. Test B is at `:641`, and its final step is `expect.poll(...).toBe(0)` (`:648`).
  - `playwright.config.ts` falls back to `DEV_PORT` 5173 with only a warning (`:8-17`), sets `retries: 0` (`:167`) and `trace: "retain-on-failure"` (`:185`).
  - The default project is `dev`, the same one CI's main e2e legs run. Local runs therefore measure the same build mode as CI.
- **Soundness of the method:**
  - It measures unmodified main first, on the lane's own pinned servers.
  - It tries to reproduce with a fixed, escalating budget (40 alone, 200 alone, the whole file x10, then 100 throttled). Raising contention is allowed; editing the code under test is not.
  - The mechanism must be shown by a trace or a probe.
  - The fix goes in the layer where the cause lives. An app defect needs a red-first unit or seam test.
  - The post-fix proof has three parts: the literal AC run, a like-for-like re-run, and a forced red/green pair or 200/200 alone.
  - Escalation is triggered by a test that never reproduces (one combined escalation) and by HEL-1634 scope (Decision 7).
  - C1-C3 are recorded in workflow-state.md.
- **Coverage:** AC1 maps to tasks 1.x and 4.1/4.2, and AC2 to task 3.2. There is no scope drift and there are no placeholders. `skip_specs` is justified.

### Verdict: CONFIRM

### Non-blocking notes
- **`-g "<exact title>"` takes a regex.** Test A's title contains `(16 minutes)`, which the regex reads as a group, so the literal title does not match the test. Playwright then fails loudly with "No tests found", so the mistake would not go unnoticed, but it wastes a step. Escape the parentheses (`-g "an expired tab \(16 minutes\) refetches its panels"`), or match a substring that has no regex metacharacters. Record the escaped form in `repro.md`.
- Decision 2(d)'s CDP throttle is a probe edit to the spec. Run `git diff --stat` after reverting it, and record the output in `repro.md` as the clean-tree evidence.
- Round 3's note that `awaitWarmClear` is "bounded at 1 s" is not named in Decision 8. It is a natural candidate to probe for test B, whose recorded failure was the final count poll.
