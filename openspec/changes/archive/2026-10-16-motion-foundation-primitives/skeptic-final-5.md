## Skeptic Report — final gate (round 5, skeptic-final-5.md)

Reviewed HEAD: `e2de6fd55a93e1cb421a86f892a20d706709036e`. I re-read it after all checks; it was unchanged and the worktree was clean apart from the untracked evaluation-6.md.

Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/motion-foundation-primitives/HEL-1573`.

Review base: `resolve-review-base.sh <wt> main origin` exited 0 with `d777803c1`. That equals both the live `origin/main` (after a fetch) and `git merge-base HEAD origin/main`.

Scope: the integration since skeptic-final-4 CONFIRMed `a24e4f8fe`. That is merge `400dbd24a` (HEL-1581), merge `e5f2d4c71` (HEL-1578) and `e2de6fd55` (the e2e retarget). I checked everything below myself and treated evaluation-6 and the executor's notes only as claims.

Evidence directory (`<ev>`): `/home/matt/Development/helio/.concertino/runs/HEL-1573/evidence/.concertino/scratch/HEL-1573/`.

### What I verified (with evidence)

**1. Merge integrity: the merges changed none of this branch's own source.**
- I recomputed each merge with `git merge-tree --write-tree <p1> <p2>` and diffed the result against the real commit.
  - `400dbd24a`: no difference, so it is a pure auto-merge.
  - `e5f2d4c71`: conflicts only in `AppRail.tsx`, `elevationTokenGuard.css.test.ts` and `motionTokenGuard.css.test.ts`. The commit differs from the auto-merge in exactly those three files plus `AppRail.test.tsx` (+6). Nothing else was edited by hand.
- I compared the branch's own delta before the merges (`0d8bd55cf..052627ef6`) with its delta now (`d777803c1..HEAD`), file by file, archive dir excluded.
  - The two file lists are identical (`sk5-pre.txt` and `sk5-post.txt`).
  - Only 6 files have a different +/- body:
    - `AppRail.tsx`: exactly one added line, `data-indicator-active={homeActive ? "" : undefined}` on Home.
    - `AppRail.test.tsx`: exactly the new Home test.
    - The two guards: only the pin (148 to 149) and its comment.
    - The two hel1573 specs: only 4 `page.goto("/home")` lines changed to `"/dashboards"`.
  - `DESIGN.md`, `openspec/specs/**`, every motion primitive, `PanelContent`, `PanelGrid.css`, `DashboardList` and `theme.css` have byte-identical branch deltas before and after.

**2. The AppRail resolution keeps HEL-1578's semantics exactly.**
- `git diff d777803c1 HEAD -- AppRail.tsx` only adds lines over main:
  - the `useIndicatorSlide` import;
  - `railRef` and the `<span class="motion-indicator app-rail__indicator">`;
  - `data-indicator-active` on Home, the mapped destinations and Settings;
  - a JSDoc wording change.
- The following are main's code, unchanged:
  - `homeActive = isDestinationActive(homeAlias, pathname)`;
  - per-destination `isDestinationActive`;
  - `settingsActive`;
  - the classes and `aria-current`.
- Exactly one item can be marked at a time. `isDestinationActive` (`navDestinations.ts`) gives Home only `pathname === "/home"`. Dashboards gets `isDashboardViewPath`, which is now `/dashboards` and `/dashboards/*` only (`sections.ts:168`). The other destinations each own their own path prefix, and Settings owns `/settings`.
- Because the wash moved from `.app-rail__item--active` to the indicator (`AppRail.css`), Home would have lost its wash without the attribute. The merge adds the attribute, so Home keeps it.

**3. Indicator in a real browser, on this run's 7005/9912 servers.**
- Server checks:
  - `assert-phase.sh servers` printed PASS.
  - Vite PID 614431 and JVM PID 614213 both have their `/proc/<pid>/cwd` inside this worktree.
  - Both started at 18:02, after `e5f2d4c71` was committed at 17:51.
- Method: a throwaway user, sampling the indicator rect and its running `transform` transitions every animation frame for 700 ms per rail click.
- **Full, light.** Path: load, Dashboards, Home, Data Sources, Home, Data Pipelines, Connectors, Assistant, Home, Settings, Home, Dashboards.
  - Every move takes 17-18 frames, with a 280 ms transform transition.
  - Moves into and out of Home: 108 to 64, 152 to 64, 284 to 64, 632 to 64.
  - On every step, `marked` equals `aria-current`, and both name exactly one item.
  - The final fit is always dx 0.5, dy 0, dw 0, dh 0.
- **Full, dark.** Same result over Dashboards, Home, Data Sources, Home, Settings, Home. The wash is the accent at alpha 0.1, against 0.08 in light.
- **Subtle, light.** Every move takes 2 frames (a snap) with no running transform transition.
- **Off, light and dark.** Every move takes 2 frames, and the only transition seen is `0.01ms`.
- **First placement does not slide.**
  - I loaded `/home`, `/settings` and `/dashboards` from scratch in a same-origin iframe, sampled every frame from the parent. In each case the first observed state was `snap` at the final position with opacity 1 and no transform run, then `ready`, with no movement.
  - From a non-rail route (`/admin/usage`) the indicator is `hidden` (opacity 0, 0 marked). Clicking Home goes `hidden`, then `snap`, then `ready`, with 0 ms of transition. It does not slide in from the origin or from the stale offset.
- **Screenshots.** I looked at all three:
  - `<ev>/sk5-home-dark-full.png`: Home washed, aligned with the icon, dark.
  - `<ev>/sk5-home-light-off.png`: Home washed, light.
  - `<ev>/sk5-rail-midflight-dark.png`: the wash paused mid-slide between items, a clean rounded `--app-radius-md` block, with the Settings glyph already accent.
- **Console:** 3 messages, 0 errors, 0 warnings.

**4. The CSS-file pins are true and no looser.**
- `find frontend/src -name '*.css' -type f | wc -l` gives 149, as does `git ls-tree HEAD`; main has 147.
- `comm -3` of main's tree against the worktree lists exactly two additions: `shared/motion/motion.css` and `shared/ui/Crossfade.css`.
- Both pins are still exact `toBe(149)`. No allowlist, matcher or exception changed in the merge.
- The removal of exception (c) (PanelGrid `180ms`) is the branch's own pre-merge change, already reviewed. Its delta is unchanged.

**5. The spec retarget does not weaken the specs.**
- At `052627ef6`, `AppRoutes.tsx:112` rendered `/home` as `<PanelList />`. At HEAD `/dashboards` renders `<PanelList />` (`AppRoutes.tsx:115`) and `/home` renders `<HomePage />`. The retarget therefore reaches the same component.
- The diff is 4 `goto` lines. No assertion, count, tolerance or wait was touched.

**6. Constraints and earlier invariants.**
- `git diff d777803c1 HEAD` touches neither `PanelGrid.tsx` nor `DesktopPanelGrid.tsx`. The grid change is `PanelGrid.css` plus its test only.
- The tab strip is not an indicator consumer. The only consumers (`grep motion-indicator|useIndicatorSlide`) are `AppRail` and `SegmentedRadioGroup`.
- `PanelList.tsx` is not in the branch diff, so HEL-1575's `key={selectedDashboardId}` (line 425) is main's own.
- Nothing in this range touches grid layout or breakpoint logic.

**7. Gates, run fresh at HEAD.**
- `npm run lint`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run format:check`: exit 0, "All matched files use Prettier code style!"
- `npm run check:tokens`: exit 0, OK.
- `HELIO_JEST_MAX_WORKERS=2 nice -n 19 npm test`: exit 0. Root: 61 suites / 524 tests. Frontend: 698 suites / 8843 tests (`<ev>/sk5-jest.log`).

**8. e2e on 7005, run by me.** All runs used the flock, 2 workers, nice 19 and `--trace retain-on-failure`.
- **hel1573 primitives, hel1573 grid-chart, hel1574-shell-rail, hel1578-home-page and hel1578-home-changed-dot: 39 passed, rc 0** (`<ev>/sk5-e2e.txt`).
  - That is 9 + 4 + 18 + 3 + 5 tests.
  - It includes C1 (chart entrance, no replay), C2 (vendor overrides and drag/resize) and C3's shrink-after-load test.
- **C3 sweep: 71 passed, rc 0, 0 failures** (`<ev>/sk5-e2e-c3.txt`). It covered:
  - hel1023 breakpoint layout;
  - hel1304 and hel1305;
  - hel1392 remount staleness;
  - hel1398 and hel1444 chart canvas;
  - hel1510 table overflow;
  - hel1512;
  - hel813;
  - hel909.
- **hel1575-dashboard-tabs: 21 passed, rc 0** (`<ev>/sk5-e2e-1575.txt`).

**9. PR #1050 CI at HEAD.** `headRefOid` is `e2de6fd55…` and `mergeable` is MERGEABLE.
- Passing: frontend, backend 0-3, security, docker-image, CodeQL plus all 4 Analyze jobs, and e2e (2), (3) and (4).
- **The re-run of e2e (1) (run 38990241105, attempt 2) was cancelled again** at the 18-minute limit, 02:05:27 to 02:23:43Z.
  - The log shows 93 passed and 0 `✘` out of 105.
  - No hel1573 spec is in shard 1.
- As a result `ci-complete` is FAILURE and `mergeStateStatus` is BLOCKED.
- To test whether this branch slows the suite, I compared the 60 tests in the shard 1 log that I could match one-to-one by key against main's CI run at `d777803c1` (38987195427). The sum is 1705 s on this branch against 1632 s on main (+4.5%). Individual tests vary in both directions, for example state-surface-contrast at 73.8 s against 104.0 s. Main's own CI at `d777803c1` is also red.
- I read this as a shard-budget problem on main after HEL-1575 and HEL-1578, not a defect in this branch's code. It is still a hard merge-gate condition.

**10. Mtime disclosure.** No claim here rests on mtime ordering. Server freshness was checked against process start times from `ps lstart` and the commit timestamp, not file mtimes. evaluation-6 does not declare its evidence mtimes unsound, so there is no gate defect to record.

### Verdict: CONFIRM

### Non-blocking notes
- **Merge gate, for the orchestrator.** `ci-complete` is red because e2e (1) was cancelled at the time limit twice in a row, with 0 failures each time. Do not merge until it is green. A third re-run may not finish within the 18-minute budget, so the real fix is main's shard weights or `timeout-minutes`. Several new specs, including hel1573, hel1575 and hel1578, show "defaulted (no weight row)" in the shard planner. That is a main-side follow-up.
- The indicator sits at a constant +0.5 px dx in every mode and theme. It comes from `offsetLeft` rounding against a fractional rail offset. It is invisible in the screenshots and within the spec's 1.5 px tolerance.
- No e2e covers sliding the indicator to or from Home. It is covered by the jest test and by my browser probe. A one-step addition to `drivePrimitives` would close that gap, either here or in HEL-1584.
- DESIGN.md §9 Tabs still says the tab bar is "static until the motion foundation lands". That is accurate by design, since the driver brief bars the tab strip as a consumer and leaves it to HEL-1584.
- House-rule disclosure: the hel1575 e2e run started when the 1-minute load average was 10.6, just over the gate of 10, after the C3 run finished. It passed.

### Throwaway data created
- **Dev DB:** one user, `skeptic5-hel1573-1792202880808@example.com` (id `7872cea4-1cdf-4f53-a6bb-be5cb579730a`), with one dashboard "Sk5 dash" (`2281c92a-ae33-4e38-b4f6-d90dbff22541`) and motion preference `off`. Neither was deleted. The e2e runs deleted their own recorded users (39, 71 and 21).
- **Scratch** (`/home/matt/Development/helio/.concertino/scratch/HEL-1573/`):
  - logs: `sk5-{lint,tc,fmt,tokens}.log`, `sk5-jest.log` and `sk5-e2e{,-c3,-1575}.txt`;
  - file lists: `sk5-pre.txt` and `sk5-post.txt`;
  - Playwright output dirs: `sk5-e2e*-results/`;
  - the three `sk5-*.png` screenshots.
- **Session scratchpad:** CI logs and the duration comparison files.
- **Playwright MCP:** snapshot and console logs in `/home/matt/Development/helio/.playwright-mcp/` (2026-10-17T02-0*/02-1*).
- **Browser state:** the MCP browser's localStorage `helio-theme` was left at `light`.
- No servers were started or stopped, no process was signalled, and the worktree was not modified except for this report.
