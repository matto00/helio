## Evaluation Report — Cycle 3, scoped integration re-evaluation (evaluation-6.md)

Reviewed HEAD: `e2de6fd55a93e1cb421a86f892a20d706709036e`. Diff base resolved live with `resolve-review-base.sh`:
`d777803c1` (origin/main, HEL-1578).

Scope: `052627ef6..e2de6fd55`. evaluation-5.md passed `052627ef6` and skeptic-final-4.md confirmed `a24e4f8fe`. In
this range:

- `400dbd24a` merges HEL-1581.
- `e5f2d4c71` merges HEL-1578 (the Home page) and resolves three conflicts.
- `e2de6fd55` points the two hel1573 e2e specs at `/dashboards`.

Evidence directory (`<ev>`): `/home/matt/Development/helio/.concertino/runs/HEL-1573/evidence/.concertino/scratch/HEL-1573/`.

### Phase 1: Spec Review — PASS
Issues: none.

**Merge integrity (item 4).** I recomputed both merges with `git merge-tree --write-tree <p1> <p2>` and diffed the
result against the real merge commit:

- `400dbd24a`: the auto-merge tree matches the commit exactly. Nothing was hand-edited.
- `e5f2d4c71`: git reported conflicts only in `AppRail.tsx`, `elevationTokenGuard.css.test.ts` and
  `motionTokenGuard.css.test.ts`. `DESIGN.md` and `AppRail.test.tsx` auto-merged. The commit differs from the
  auto-merge in exactly four files:
  - the three conflict resolutions;
  - one added test in `AppRail.test.tsx` (+6 lines).

  Nothing else was added or dropped.
- I also compared the branch's own delta before and after the merges, for every branch path except the archive dir:
  `git diff 0d8bd55cf 052627ef6` against `git diff d777803c1 HEAD`. Six files differ:
  - `AppRail.tsx`: only the new `data-indicator-active` on Home.
  - `AppRail.test.tsx`: only the new Home test.
  - the two guards: only the 148 to 149 pin and its comment.
  - the two e2e specs: only `/home` changed to `/dashboards`.

  `DESIGN.md`'s branch delta is byte-identical before and after. No other production source, CSS or script changed.

**Constraints.**
- C1: the real-browser chart entrance and no-replay test (`hel1573-motion-grid-chart`) passed at HEAD.
- C2: the vendor-override specificity test passed at HEAD, in the same spec.
- C3: the wrapper check passed. The shrink-after-load test is in the hel1573 run, and the layout / chart-fit /
  table-overflow sweep passed 71/71 (Phase 2).

### Phase 2: Code Review — PASS
Issues: none blocking.

**1. AppRail resolution.** `git diff d777803c1 HEAD -- frontend/src/app/shell/AppRail.tsx` is purely additive over
main:
- the `useIndicatorSlide` import;
- `railRef` and the `.motion-indicator` span;
- `data-indicator-active` on Home, the mapped destinations, and Settings;
- a JSDoc wording change.

HEL-1578's `homeActive = isDestinationActive(homeAlias, pathname)` and its per-destination `isDestinationActive` calls
are unchanged. The resolution drops `isDashboardViewPath` because main removed it, and keeps `useIndicatorSlide`.

**AppRail unit test discrimination (checked independently).** I did not edit the worktree. Instead I wrote AppRail
mutants into scratch and ran the real `AppRail.test.tsx` against each one, using a scratch jest config whose
`moduleNameMapper` swaps the mutant in for `./AppRail` (`<ev>/eval6-mutation.txt`):

| Mutant | New Home test | Whole suite |
|---|---|---|
| original | passes | 16/16 pass |
| Home `data-indicator-active` removed | fails | 15/16 |
| Dashboards always marked | fails (count 2) | 13/16; 2 other indicator tests also fail |
| Home marked by `settingsActive` | fails | 14/16; the Settings test also fails |

The executor's red/green transcripts (`home-indicator-{red,green}.txt`) show the same failure, `Received length: 0`,
at `AppRail.test.tsx:138`.

**Real browser check: Home indicator, both themes, Full and Off.** I used the Playwright MCP browser on 7005 as a
throwaway user. For each rail click I sampled the indicator rect every animation frame for 700 ms
(`<ev>/eval6-rail-indicator-browser.txt`, `<ev>/eval6-home-dark-off.png`).

- **Light / Full:** Dashboards, Home, Data Pipelines, Home, Settings, Home, Assistant, Dashboards. Every move goes
  through 11-14 intermediate frames, and a `transform` transition is observed each time.
  - Sliding into and out of Home both work. Examples: top 108 to 64 (Dashboards to Home), 632 to 64 (Settings to
    Home), 64 to 196 (Home to Pipelines).
  - Every final fit to the active item is (dx 0.5, dy 0, dw 0, dh 0). The constant 0.5 px dx is subpixel, under the
    spec's 1.5 tolerance.
  - On every route exactly one item is marked, and `aria-current` matches it.
- **Dark / Full:** the same results over Dashboards, Home, Settings, Home, Data Sources, Home. The wash colour is the
  dark accent (alpha 0.1, against 0.08 in light).
- **Dark / Off and Light / Off:** `--motion-duration-move` is 0.01ms. Each move has 0 intermediate frames and no
  running transform transition longer than 1 ms, and it lands on the correct item with the same fit.
- **Route coverage:**
  - `/home`: Home is marked.
  - `/dashboards`: Dashboards is marked.
  - `/dashboards/:id` (full load): Dashboards is marked, `ready`, and fits.
  - `/admin/usage` is a non-rail route (NotFound for the free tier). No item is marked, `data-indicator="hidden"`, and
    the indicator's opacity is 0. Clicking Home from there gives hidden, then `snap` at 64, then `ready`. The
    indicator does not slide in from the origin.
- **Console:** the only messages were two 401s on `/api/auth/me` before login. No errors during any flow.

**2. CSS pins.**
- `find frontend/src -name '*.css' -type f | wc -l` gives 149, and `git ls-tree` at HEAD also gives 149. Main has 147.
- Comparing the two trees' file lists shows exactly two added files, `shared/motion/motion.css` and
  `shared/ui/Crossfade.css`.
- `git diff 052627ef6 HEAD` on both guards changes only the title, the comment and `toBe(148)` to `toBe(149)`. The pin
  is still an exact `toBe`. No allowlist, exception or matcher changed.
- `HomePage.css` declares one motion property, `transition: border-color var(--app-transition)` at line 105. It has
  no literal duration and no `animation`/`@keyframes`. Its shadows and radii use `--app-shadow-*`, `--app-radius-*`
  or `50%`.
- It passes the motion and elevation guards honestly. Under this branch, `--app-transition` drops to `0.01ms` for
  Off and for the OS-reduced case (`theme.css:212,225`).
- The literal-timing primitive guard (`motionPrimitiveLiterals.test.ts`) only covers the nine primitive files, so it
  does not apply to `HomePage.css`.

**3. Spec retarget.** In `AppRoutes.tsx`, before the merge `/home` rendered `<PanelList />`. HEL-1578 moved
`<PanelList />` to `/dashboards` (`AppRoutes.tsx:115`) and gave `/home` to `<HomePage />`. The retarget therefore
points the specs at the same component, which drives the same primitives:
- the dashboard-list stagger and layout slide;
- the panel crossfade and grid;
- the chart entrance.

The rail-indicator step still starts from an active item (Dashboards, as before) and slides to Data Pipelines. No
assertion was removed or loosened. The diff is 4 `page.goto` lines.

Judgment, not blocking: Home (shelf, run timeline, Needs attention) is not a motion consumer. The stagger could fit
its lists, but adding it there is HEL-1578 or follow-up scope, not this ticket's. Neither Home's rail item nor the
indicator slide to and from it has e2e coverage. It is covered by the jest test above and by my browser probe only.

**Gates, run fresh at HEAD in WORKTREE_PATH.** The 1-min load average stayed under 10 throughout.
- `npm run lint`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run format:check`: exit 0, "All matched files use Prettier code style!"
- `npm run check:tokens`: exit 0, OK.
- `HELIO_JEST_MAX_WORKERS=2 nice -n 19 npm test`: exit 0. Root: 61 suites / 524 tests. Frontend: 698 suites / 8843
  tests. Log: `<ev>/eval6-jest.txt`.
- **Servers.** Vite PID 614431 and the backend JVM PID 614213 started at 18:02:12 and 18:02:10 PDT, with cwd inside
  this worktree. That is after `e5f2d4c71` (17:51:41 PDT). `e2de6fd55` touches only e2e specs, so no restart was
  needed. `assert-phase.sh servers` gave PASS. I did not start or stop either server.
- **e2e, requested set.** Run under flock with 2 workers, nice 19 and `--trace retain-on-failure`
  (`<ev>/eval6-e2e.txt`): 66 passed, 1 skipped, rc 0. The skip is `hel1575-switch-measurement`, behind its opt-in
  guard.

  | Spec | Passed |
  |---|---|
  | hel1573 motion-primitives | 9 |
  | hel1573 motion-grid-chart | 4 |
  | hel1574-shell-rail | 18 |
  | hel1575-dashboard-tabs | 21 |
  | hel1575 reload-after-edit | 5 |
  | hel1575 delayed-restore | 1 |
  | hel1578-home-changed-dot | 5 |
  | hel1578-home-page | 3 |
- **e2e, C3 sweep from evaluation-4.** `<ev>/eval6-e2e-c3.txt`: 71 passed, rc 0. It covered:
  - hel1023 breakpoint layout;
  - hel1304 chart types;
  - hel1305 time axis;
  - hel1392 remount staleness;
  - hel1398 and hel1444 chart canvas;
  - hel1510 table overflow;
  - hel1512 category axis;
  - hel813 touch targets;
  - hel909 picker sheet.

**PR #1050 CI at HEAD `e2de6fd55`** (`headRefOid` matches):

- Passing: CodeQL and all 4 Analyze jobs, security, backend 0-3, docker-image, frontend, and e2e 2-4.
- **e2e (1) was `cancelled` at the job's `timeout-minutes: 18`, so `ci-complete` fails.**
  - The log shows 97 of 105 tests passed and 0 failed (`✘` count is 0) when it ended with "The operation was
    canceled".
  - The shard's long tests are main's own: several 2.1-2.3 min `hel1575-dashboard-tabs` tests and a 2.9 min
    `hel1578-home-changed-dot` test. No hel1573 spec ran in that shard.
  - Durations of the same tests on main's own CI run for `d777803c1` (run 38987195427, shard 3) are comparable, for
    example 21.8 s vs 24.7 s and 15.4 s vs 15.4 s.
  - Main itself is red at `d777803c1`: its e2e (3) ran 17 min and failed on `hel1575-dashboard-tabs.spec.ts:627`.

  I attribute the cancellation to a shard-budget problem on main after HEL-1575 and HEL-1578, not to this branch's
  code. It is still a merge-gate condition: the leg needs a re-run, and `ci-complete` must be green before merge.

### Phase 3: UI Review — PASS
Issues: none. The rail-indicator checks in Phase 2 cover:
- the happy path from every entry point (rail click, full load on `/dashboards/:id`, a non-rail route);
- both themes, with motion Full and Off;
- console cleanliness.

Breakpoints were already covered by evaluation-4. The only runtime change since then is one attribute, and
`hel1574-shell-rail` and the hel813 768px touch-target spec passed at HEAD.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- No e2e asserts the indicator slide to or from Home, which is the new HEL-1578 rail item. A one-step addition to
  `drivePrimitives` would cover it: from `/dashboards`, click Home and assert the indicator's rect fit.
- Merge gate, for the orchestrator rather than the executor: re-run PR #1050's e2e (1) leg, which hit the 18-minute
  timeout with 0 failures. Consider a follow-up on main's shard weights or timeout, since main's own e2e is red at
  `d777803c1` too.

### Throwaway data created
- Scratch, all under `/home/matt/Development/helio/.concertino/scratch/HEL-1573/`:
  - logs: `eval6-{lint,typecheck,format-check,check-tokens,jest,e2e,e2e-c3}.txt`;
  - Playwright results: the `eval6-e2e-results/` and `eval6-e2e-c3-results/` dirs;
  - `eval6-mut/` (AppRail mutants, a scratch jest config and its cache) and `eval6-mutation.txt`;
  - `eval6-rail-indicator-browser.txt` and `eval6-home-dark-off.png`.
- Persisted copies are under `<ev>`.
- Dev DB: one user, `eval6-hel1573-1792200432216@example.com` (id `d7936858-39d7-4f20-857d-cc9f75698991`), with one
  dashboard ("Eval6 dash", `60feb43b-20a6-4f0d-9f2b-91441f6a8ef1`) and motion preference `off`. These were not
  deleted.
- The e2e runs deleted their own recorded users (66 and 71).
- The Playwright MCP wrote snapshot and console logs to `/home/matt/Development/helio/.playwright-mcp/`, timestamped
  `2026-10-17T01-2*`.
- CI logs were downloaded to the session scratchpad.
- No servers were started or stopped, no worktree was created, and no process was signalled.
