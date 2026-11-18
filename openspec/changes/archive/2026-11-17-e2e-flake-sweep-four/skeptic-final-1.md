## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 633c8aa5735cc615b30766baf5b7a5e9cca03d28. The base was resolved live with `resolve-review-base.sh` and
gave fd370e5e5abbfa3451133c8a2db97edc22970be8. Diff: 4 files. They are `hydrateTabs.ts` and its test,
`e2e/support/isolateLivePage.ts`, and `e2e/hel1668-schema-panel-copy.spec.ts`.

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/e2e-flake-sweep-four/HEL-1754`.
- **hel1578:111 root cause (D1)**
  - Read the base `hydrateTabs`. It computes `plan` once, from `window.location.pathname` at the start. It then
    awaits `refreshChangeSignals` plus the bounded restore. After that it always dispatches
    `setSelectedDashboardId(plan.target)`.
  - So a load of `/home` with saved active tab B selects B after the await, whatever the user did meanwhile.
  - The CI trace analysis in design.md matches that code path.
  - The new jest test "location change during the signal fetch" fails on the base by construction:
    `startDeepLink` is null, so the target is `b`. The executor's red transcript
    (`evidence/d1-jest-red.txt`: Expected "a", Received "b") is consistent with this.
- **hydrateTabs fix correctness** (read in full, `hydrateTabs.ts:139-207`)
  - The re-plan runs only when the deep link derived from the location changed (`latestDeepLink !== startDeepLink`).
  - The no-navigation path is unchanged: the same `plan`, the same dispatches. The jest test "no navigation: the saved
    active tab is still restored" covers it.
  - When an explicit `options.deepLinkId` is passed, `currentDeepLink` is constant, so it never re-plans.
  - Warm restore: the original target's restore and `adopted` stamp still run. Stamps are carried into the re-planned
    tabs through `adoptedStamps`.
  - `applyWarmEntry` writes a per-dashboard list entry (`setListEntry(entry.dashboardId, …)`), so restoring B and then
    selecting A cannot show B's panels under A.
  - The guard test pins that the re-planned target's warm copy is not applied by hydration. It is labelled honestly as
    a guard.
- **Fresh jest run**: `npm --prefix frontend test -- --testPathPatterns=features/dashboards/tabs` with
  `HELIO_JEST_MAX_WORKERS=3` gave 21/21 suites and 234/234 tests.
- **hel813:93 (D2)**
  - The diff changes only the two `uiLogin` navigations to `waitUntil: "domcontentloaded"`.
  - The forced red (`evidence/d2-red.txt`) times out at `goto("/login")` in `isolateLivePage.ts:30` under the
    first-fonts-request stall. The green under the same stall is 10/10.
  - The forcing spec (`evidence/force-813.spec.ts.txt`) holds only the first fonts request, as designed.
  - `fill("#email")` still waits for the field, and `waitForURL("/home")` still asserts the post-login URL.
  - Other callers: `registerAndLogin`, `newDeviceLogin` and `hel1572-appearance-preferences.spec.ts`. None depends on
    `load` after login. The specs that need fonts await `document.fonts.ready` themselves.
- **schema-panel-copy:172 (D4)**: I checked the CI trace myself with `tools/dump_trace.py`, run 44184688504.
  - In the light iteration, `.spine-row--selected >> nth=0` resolved (call@11539, call@11545) to
    `data-step-row="ecee67dc…"`. That is the same element `.spine-row >> nth=0` resolved to (call@11521), so it is the
    pre-tap, pre-selected row 0.
  - In the dark iteration, call@11499 resolved to ecee67dc and then call@11505 resolved to `b60ca3d1…`, the tapped
    row. The selection moved between the spec's reads.
  - This confirms the cause from ground truth: the locator matched the pre-selected row.
  - The fix waits on `.spine-row` nth(1) having `spine-row--selected` and its menu reaching opacity 1, then reads the
    tones from that row. It cannot pass vacuously:
    - nth(1) only gets the class if the tap selected it;
    - opacity 1 needs the `:hover`/`:focus-within` reveal (`PipelineSpine.css:489-495`);
    - all of the tone assertions are unchanged.
  - The forced red with the original body under 10x CPU throttle is 10/10 red (`evidence/spine-force-orig-throttle10.txt`).
    The fixed body is 10/10 green under the same throttle.
- **hel1668-phone-sheet:184 named candidate (AC4)**
  - Trace run 44048058244: the `N fields` trigger tap (call@6018) came about 115 ms after the step-row tap
    (call@6014). The trigger resolved with `aria-expanded="false"`, the tap was reported done, and then the
    `Output schema` dialog was not found.
  - This matches the record in `phone-sheet-probe.md` and the Outcome note in design.md D3.
  - The record names the probes tried and the refuted hypotheses. It labels the hardening as unproven, and no fix was
    claimed. I judge it honest.
- **No sleeps, retries or longer timeouts added**
  - `git diff fd370e5e5...HEAD | grep -E '^\+.*(waitForTimeout|timeout|retries|retry|setTimeout)'` printed nothing.
  - The `waitForTimeout` calls in `hel1578-home-changed-dot.spec.ts` (:77 etc.) were already there and are untouched.
- **Independent e2e run** (pinned ports, servers via `start-servers.sh` with `assert-phase.sh` PASS)
  - Command: `DEV_PORT=7186 BACKEND_PORT=10093 nice -n 19 npx playwright test hel1668-schema-panel-copy:172
    hel1578:111 hel813:93 --project=dev --repeat-each=10 --workers=2 --retries=0`.
  - Result: `60 passed (3.1m)`, exit 0. Log: `.concertino/scratch/HEL-1754/skeptic-final-1754-a.txt`.
  - Global teardown deleted the 60 recorded throwaway users by exact id. Servers were stopped with `stop-servers.sh`.
- **UI design judgment**: not applicable. There is no visual change: the product change is selection logic, and the
  rest is test-only.

### Verdict: CONFIRM

### Non-blocking notes

- **Behavior change.** A user opens `/dashboards/X` and navigates away, for example to `/home`, before hydration ends.
  The re-plan now targets the saved active tab, so X is no longer opened as a tab. Before this change it was.
  - This is consistent with "a navigation wins", but it is a behavior change.
  - The PR body could mention it.
- **CI light signature.** The schema-panel probe note says the forced red has "the CI light signature". It matches
  on `select` (transparent) and `menuOpacity` (0). It does not match on `menuImage`:
  - CI showed `none`;
  - the forced run showed the accent-dim gradient.
  - The CI value fits an evaluate on the stale row-0 handle after its selection class had moved. That is the same
    root cause in a slightly later phase. Worth correcting if the line is copied into the PR body.
- **Re-plan uses a start-time snapshot.** `dashboardIds` is taken at the start of hydration. A navigation to a
  dashboard created during hydration therefore falls back to the saved active tab, the same as on the base.
