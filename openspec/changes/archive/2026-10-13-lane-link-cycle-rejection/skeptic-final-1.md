## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `c3c91ed0e697ad2a118985a901068f6beab490c0`. The base was resolved live with `resolve-review-base.sh`: `67cf9e0e0451b781be463e82db25c57a8c8795bf`. The diff has 23 files and no migration.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/lane-link-cycle-rejection/HEL-1521`.

### What I verified (with evidence)

**Backend logic, read against the engine (AC1–AC3): sound.**
- Dependency model.
  - `InProcessPipelineEngine.isReady` (InProcessPipelineEngine.scala:450) waits for `parentKey(s)` and for `laneDependencyOf(s)`, which covers join, union and lookup only.
  - `LaneCycleViolations.reverseClosure` uses the same two edge kinds: `parentStepId` plus `PipelineStepConfigCodec.secondaryLaneStepId`, which also covers join, union and lookup only.
  - A lane write `a -> t` closes a cycle exactly when `t` already reaches `a` through those edges. That set is the reverse closure from `a`.
- Update. The seed is `{existing}`. The reverse closure never follows the seed's own outgoing lane edge, so the about-to-be-replaced edge cannot produce a false positive. Any new cycle must use the new edge, so the check is exact: it neither over-rejects nor under-rejects.
- Create. The seeds are `StepPlacement.reparentedIds(anchor, …)`. Re-parenting changes only the seeds' own outgoing parent edges, which the reverse closure from those seeds never reads. So the closure computed on the pre-insert graph equals the closure on the post-insert graph, and the check is exact.
- Duplicate. `reparentedIds(Some(existing))` returns every direct child (StepPlacement.scala:66). That matches `spliceInsertReportingInternal`, which re-parents all of the anchor's children, trunk and tails (PipelineStepRepository.scala ~L700). The clone copies `existing`'s lane target. On an acyclic graph, `dependents(children) ⊆ dependents(existing)`, so a valid duplicate is never newly rejected.
  - One behaviour change on legacy invalid data: a duplicate of a step whose stored lane already names its own descendant used to get 201 and now gets 400 with the descendant message. That graph was already unrunnable, so I accept this; it is noted below.
- Reorder. `of` now classifies through `relationOf`. `introduced` is still keyed on `(step, target)`. The pre-existing ancestor and descendant semantics are unchanged on acyclic graphs: `ancestorsFrom` equals the old walk, and `descendantsOf({s}) - s` is equivalent to the old `ancestors(target).contains(s)`.
- Messages, statuses and precedence. In `validateLaneReference` (PipelineService.scala:351-380) the order is still self 400 → missing 422 → ancestor 400 → descendant 400. All four strings are byte-identical to base (I compared the diff `-`/`+` lines). The only new string is the D3 one.
- One implementation. `LaneScope.of` (StepReferenceChecks.scala) is the only construction, and create, update and duplicate all call it. `PipelineService.ancestorChainOf` was deleted. `grep` shows no other relation code in the write-time path.

**Red first, reproduced by me rather than read (AC6).**
- Setup: a `git archive 67cf9e0e0 backend` in the scratchpad, with only `StepLaneTransitiveCycleRoutesSpec.scala` copied in, then `sbt -J-Xmx3g "testOnly …StepLaneTransitiveCycleRoutesSpec"`.
- Result: 10 run, 6 passed (the guards), 4 failed. The failures:
  - `200 OK was not equal to 400 Bad Request (…:47)`: update, one hop
  - `200 OK was not equal to 400 Bad Request (…:66)`: update, two hops
  - `201 Created was not equal to 400 Bad Request (…:104)`: create
  - `200 OK was not equal to 400 Bad Request (…:150)`: reorder
- The red evidence is genuine. The evaluator had only "verified by reading".

**Gates I re-ran at HEAD.** All runs were in the foreground, with `nice -n 19` and capped workers.
- `sbt -J-Xmx3g "testOnly com.helio.domain.pipelines.LaneCycleViolationsSpec com.helio.api.routes.pipelines.StepLaneTransitiveCycleRoutesSpec com.helio.api.routes.pipelines.DuplicateStepReferenceChecksSpec"`: 39/39 passed.
- `sbt -J-Xmx3g "testOnly com.helio.api.routes.pipelines.* com.helio.domain.pipelines.*"`: 698 run, 698 succeeded.
- `sbt -J-Xmx3g "testOnly com.helio.services.pipelines.* com.helio.infrastructure.persistence.pipelines.*"`: 850 succeeded, 0 failed, 1 canceled. The canceled test is the assume-gated timing test "add no more than 500 ms (median of 20) to the rows service path" and is unrelated.
- jest `laneLayout.test.ts` and `ui/stepConfigs` (maxWorkers 3): 35 suites, 355 tests passed.
- `npm run typecheck`: clean. eslint `--max-warnings=0` on the changed TS files: exit 0.
- Not run by me: the full jest suite, the other backend packages, and format:check. I relied on the evaluator's table for those.

**Picker against the server, live (AC4).**
- Servers on 6953/9860 were started with `start-servers.sh` (`PASS servers`) and stopped with `stop-servers.sh` (`STOPPED ports=6953,9860`).
- Throwaway user `hel1521-skeptic-1791901070219@example.test` (id `2acf874b-4406-4416-bfdb-11f92f2605e8`).
- Pipeline: head (Limit) → Union → Sort, plus two tails of head: Join (lanes to Sort) and Select.
- Union's picker shows these options (DOM `aria-disabled`):

  | Option | Label suffix | aria-disabled |
  |---|---|---|
  | Limit rows | (would create a cycle) | true |
  | Join tables | (would create a cycle) | true |
  | Sort rows | (would create a cycle) | true |
  | Select fields | (none) | false |

- Server agreement:
  - PATCH Union → lane Join returned `400 "Lane reference '…' would create a cycle (it depends on this step through a lane link)."`
  - PATCH Union → lane Sort returned `400 "… (it is a descendant of this step)."`
- The user was deleted by exact (id, email) with `buildUserDeleteSql`, and a re-count returned `0`. The browser theme was restored to dark.

**Design judgment.**
- No new UI element. The change reuses the shared `Select`, its disabled-option state and the existing "(would create a cycle)" label.
- Disabled options are muted and the enabled option reads clearly. Light and dark render the same way and match the pre-existing ancestor-disabled options.
- Screenshots:
  - dark: `/home/matt/Development/helio/.concertino/runs/HEL-1521/evidence/test-results/hel1521-skeptic-picker-theme-a.png`
  - light: `/home/matt/Development/helio/.concertino/runs/HEL-1521/evidence/test-results/hel1521-skeptic-picker-light.png`
- The only console error is the pre-existing `GET /api/pipelines/:id/schedule` 404.

**The committed e2e fails, reproduced twice (AC6, task 4.3).**
- Command: `DEV_PORT=6953 BACKEND_PORT=9860 HELIO_PLAYWRIGHT_WORKERS=1 npx playwright test e2e/hel1521-lane-picker-dependents.spec.ts --workers=1`.
- Result: `1 failed` on both runs, each with `page.fill: Test timeout of 90000ms exceeded … waiting for locator('#email')` at `e2e/support/isolateLivePage.ts:31`.
- The failure page snapshot (`test-results/…/error-context.md`) shows the authenticated Dashboards shell, not the login form.
- Root cause, confirmed by probe:
  - The spec calls `registerAndLogin(page, page.request, …)` (e2e/hel1521-lane-picker-dependents.spec.ts:16).
  - `page.request` shares the browser context's cookie jar. `POST /api/auth/register` sets the session cookie (AuthRoutes.scala:43, `setCookie(SessionCookies.issue…)`).
  - `uiLogin`'s `page.goto("/login")` is then redirected to `/` by `PublicOnlyRoute`, because the status is `authenticated`.
  - I reproduced this directly in the browser: after register, `/login` landed on `/` with `#email` absent.
- Every other spec passes the separate `request` fixture. `grep -rln "registerAndLogin(page, page.request" e2e` matches only this file.
- The evaluator reported "1 passed (4.1 s)" for this spec at this commit. That contradicts two fresh runs and the probe. At best it passed on a render race, which makes it a flaky e2e. As committed, it does not prove AC4 end to end.

### Verdict: REFUTE

### Change Requests
1. `e2e/hel1521-lane-picker-dependents.spec.ts:12-16`: register through the isolated `request` fixture, not `page.request`.
   - Change: `async ({ page, request }) => { … await registerAndLogin(page, request, { … }) }`. This follows `e2e/hel1003-actions-menu-keyboard-reach.spec.ts:35`.
   - Keep `page.request` for the seeding calls after the UI login; it carries the session by then.
   - Then run the spec green against this run's own servers (`DEV_PORT=6953 BACKEND_PORT=9860`) and paste the `1 passed` output. The current spec fails deterministically here: 2/2 runs, root cause confirmed above.

### Non-blocking notes
- `StepLaneTransitiveCycleRoutesSpec.scala`, "400 through two lane hops": add a `storedConfigOf(a) shouldBe before` assertion, and drop the filler `d should not be empty`.
- `StepLaneTransitiveCycleRoutesSpec.scala`, duplicate GUARD: it duplicates `x`, which has no children, so the seed path `reparentedIds(Some(existing.id))` runs with an empty set. Add a duplicate of a lane step that has children, for example `a` after a valid lane, so the new seed derivation is actually exercised.
- `PipelineStepRepository.scala:1375`: the scaladoc still cites the deleted `ancestorChainOf`.
- `LaneCycleViolations.scala:93`: the `introduced` scaladoc has lost its indent. `LaneCycleViolations.scala:57-60`: `extends` alignment.
- Behaviour change for the OWNER REVIEW notes: a duplicate of a step whose stored lane already names its own descendant (legacy data written before HEL-1515) now returns 400 instead of 201. That graph was already unrunnable.
- `files-modified.md`: the last entry is a directory (`openspec/changes/lane-link-cycle-rejection/`) rather than complete file paths. Enumerate the files.
- Gate defect, for the record: evaluation-1.md's Phase 3 claims the e2e passed. Two fresh runs at the same commit fail, with a deterministic cause.
