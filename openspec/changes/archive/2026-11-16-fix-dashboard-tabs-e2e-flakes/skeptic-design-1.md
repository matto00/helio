## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Spawn guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/dashboard-tabs-e2e-flakes/HEL-1644`.
- I read ticket.md, proposal.md, design.md, tasks.md and workflow-state.md in full. The worktree HEAD is d9c6585a8 (main tip), and the change dir is the only untracked content.
- I checked the design's claims against the tree:
  - `e2e/hel1575-dashboard-tabs.spec.ts:20` `test.describe.configure({ mode: "parallel" })`. Confirmed.
  - Test A is at :593 and test B at :641, with the titles the design gives. Confirmed.
  - Test A has the HEL-1681 `serverNow` route rewrite (around :617-628). Confirmed.
  - Test B polls `warmEntryCount` to 0 after Sign out (:641-649). Confirmed.
  - `clearWarmState` (`warmCache.ts:181`), `registerClearWarmHook`/`awaitWarmClear` (`clearWarmHook.ts:14`) and the epoch/cancel step in `boundedWarmStore.ts:134` exist as described.
  - `playwright.config.ts`: `retries: 0` and `trace: "retain-on-failure"`. `baseURL` comes from `DEV_PORT`, which defaults to 5173 with only a warning (:8-17). CI writes `results.json` only. `.github/workflows` uploads no Playwright traces.
- The method itself is sound:
  - Measure on unmodified main first.
  - Contention may be raised, but the code under test may not change.
  - The mechanism must be shown by a trace or a probe.
  - The fix goes in the layer where the cause lives, with a red-first unit or seam test for an app defect.
  - C1 bans retries, longer timeouts, skip and fixme.
  - The Decision 7 scope fence against HEL-1634 is the right one.
- Coverage: AC1 (fails first, then 40/40 each) maps to tasks 1.x and 4.1/4.2. AC2 (unit or seam test for an app defect) maps to task 3.2. No scope drift. `skip_specs` is justified: logout-clears is an existing requirement.

### Verdict: REFUTE

### Change Requests
1. **There is no rule for when test B never fails.** Decision 6 and task 1.4 cover only test A. The only observed failure of test B is one CI failure (d777803c1). If test B also passes 200/200 locally, AC1's "shown failing first" cannot be met, and the plan does not say what happens next. An implementer could invent a fix for an unreproduced flake, which Decision 6 forbids for A only. Fix: make Decision 6 and task 1.4 apply to both tests, or add a B-specific rule (stop and escalate with the evidence). Name the budget explicitly for both: how many repeats, then whole-file repeats, then CPU throttle.
2. **The test invocation is not pinned to this lane's servers.** Tasks 1.1/1.2/4.x say "run test A alone with `--repeat-each=40`" but give no server start or port. `playwright.config.ts:8-17` falls back to `DEV_PORT=5173` with only a warning, and MISTAKES.md "Never invoke npm / vite / sbt / npx playwright bare" (CON-165) records runs that measured another worktree's server. A repro count taken against the wrong server is worthless, and so is a 40/40 taken that way. Fix: add to C2 or Decision 1 that servers start via `scripts/concertino/start-servers.sh` with DEV_PORT 7076 and BACKEND_PORT 9983, and are checked with `assert-phase.sh servers`. Every Playwright run must set `DEV_PORT=7076` (and `BACKEND_PORT`) explicitly. `repro.md` must record the exact command line, including the env assignments.
3. **The one real failure of test B is not examined.** The ticket names the failing CI run (d777803c1, HEL-1578's merge). CI uploads no traces, but the job log (`gh run view <id> --log-failed`) holds the assertion message and the step that timed out. Reading it is free and tells which hypothesis to probe first:
   - `waitForURL("/login")` timing out
   - the count poll stuck at N > 0
   - the `>= 1` precondition failing

   Fix: add task 1.0, "read the CI failure for :627 (and any recorded :593 failure) and record the error text in `repro.md`". This is evidence, not a hypothesis, so it fits Decision 1.

### Non-blocking notes
- workflow-state.md has `TICKET_TYPE: feature`, but this is a bug ticket (branch `bug/...`). It does not affect the plan; it may affect reporting.
- Test A keeps a `page.waitForTimeout(800)` at :609 (an existing sleep). C1 forbids adding sleeps. If the fix rewrites test A, consider waiting on a real signal there too, without widening scope.
- Decision 2: say how a whole-file repeated run counts toward the "40/40" in AC1, so the verify step compares like with like.
- Test A's route handler reads `jumped` at response time. A request issued before the jump whose response lands after `jumped = true` is also shifted. This is a candidate mechanism to probe, not to assume.
