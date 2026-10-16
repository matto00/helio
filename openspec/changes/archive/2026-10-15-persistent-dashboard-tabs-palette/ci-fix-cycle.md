# HEL-1575 CI fix cycle (run 38707177620, head bf1421dfb)

CI failed on 20 existing e2e specs. Each was reproduced locally on this worktree (`DEV_PORT=7007`, `BACKEND_PORT=9914`)
and root-caused with a probe before any change. Where a failure was claimed pre-existing, it was run against a throwaway
`origin/main` (453c57f1e) checkout (served on the same ports and backend; the checkout is removed).

## Per-failure table

| test | root cause | evidence | fix | why |
| --- | --- | --- | --- | --- |
| hel516-palette-quick-create `:49,:67,:91,:106,:122,:134,:158,:201,:272` (9 tests) | The palette now offers an `Ask the assistant: "<query>"` row (C3, D10) whose accessible name contains the query, so `getByRole('option', {name: 'Add source'})` matched 2 elements (strict mode violation). | Local run: `strict mode violation: getByRole('option', { name: 'Add source' }) resolved to 2 elements` (also for New pipeline, New dashboard, Add panel). `:134` and `:106`'s other failure is row 2 below. | locator: `runPaletteAction` uses `{ name: title, exact: true }`. | The Ask row is intended behaviour; the action under test is the option whose whole name is the title. No assertion weakened. |
| hel503 `:204` (overflow notice) | Same Ask row: `getByRole('option')` count 5 became 6. | Local: `toHaveCount(5)` received 6 (`2 x resolved to 1 element`, `7 x resolved to 6`). | locator: the 5-source assertion filters out `hasNotText: "Ask the assistant"`, and a second assertion pins the total at 6. | The cap of 5 source rows is unchanged; the extra option is the intended Ask row, now asserted explicitly instead of ignored. |
| hel503 `:123` (dashboard by name) | Two causes. (a) Product: see row 2 (no `Active dashboard` dot). (b) Ask row: after (a) was fixed the test clicked the Ask row (the page landed on `/chat`), because the query contains the dashboard name. | After (a): the failure moved to the final assertion with the page on the Assistant (`heading "Assistant"` in the error context); a probe printed the options: `["HEL-503 root-dashboard Dashboard","Ask the assistant: \"HEL-503 root-dashboard Dashboard\""]`. | product (a) + locator (b): `{ name, exact: true }` on both option lookups. | See rows 2 and 1. |
| hel519 `:134`, hel516 `:67`, `:134` (`getByLabel('Active dashboard')` not found) and hel503 `:123` | **Product defect.** A user who opens the app with no dashboards had `dashboardTabs: {tabs: [], activeId: null}` written to their preferences at hydration (`planHydration` set `dirty = true` even when nothing was selected). D1 says a stored empty set means "the user closed everything" and must not auto-select. When the dashboard was then created (here through the API; in real life on another device or through MCP) a reload found a "stored empty set" and selected nothing. | Probe `zzprobe-tabs-write` (deleted): zero-dashboard user, load, idle 2.5 s. Without the fix: `WRITES ["PATCH {\"dashboardTabs\":{\"tabs\":[],\"activeId\":null}}"]`. With the fix: `WRITES []`. The error context of hel519 `:134` showed the list with the dashboard, `tablist "Open dashboards"` empty and no active dot. | product: `planHydration` sets `dirty = autoSelectedId !== null` in the "no saved key" branch (`hydrateTabs.ts`). New unit test `no saved key and no dashboard: nothing is selected and NOTHING is saved`. | An empty set may only be written when the user closes their last tab (`closeTab`/removal), never by hydration. |
| hel1574-shell-rail `:108` (width survives a reload: "248" vs "264") and `:136` (one preference write) | The same spurious empty-tab PATCH as row 4, sent ~1 s after load (1000 ms debounce). The specs wait for "the" `PATCH /api/users/me/preferences` response, or count preference writes: on a slow CI runner the hydration PATCH lands in that window (`:108` resolved on the wrong PATCH and reloaded before the width write; `:136` saw two PATCHes). Locally (fast) the specs pass either way, so they did not reproduce on this machine. | The row-4 probe proves the extra PATCH exists with a zero-dashboard user and not after the fix. The specs read `writes` / `waitForResponse` for the preferences URL without a body filter. Both pass locally with and without the fix at local speed (recorded honestly: the race is timing-only; the mechanism is the evidence). | product: row 4's fix removes the extra PATCH. | The specs' expectation (one write, per user action) is correct; the defect was the write. |
| HEL-866 `state-surface-contrast-guard.spec.ts:941` (chrome, light and dark) | **Product (CSS) defect.** New tab-bar states fell below the 1.1 floor: tab name button hover (no background change at all), close hover (`--app-surface-strong` on the active tab's `--app-surface` is 1.025 in light), and the "+" ghost IconButton hover (`--app-surface-soft` on the bar's own `--app-surface-soft` is ratio 1). | Local guard output before: dark `button[role=tab] ... (hover) ratio=n/a` and `Open a dashboard in a new tab (hover) ratio=1`; light adds `[dashboard-tab__close] ratio=1.0253`. After: `elements probed: 33 ... fail=0` for chrome in both themes. | product, tokens only (`DashboardTabBar.css`), guard untouched: hover wash on the tab name button and the close, `--app-surface-strong` on the bar (1.167 dark / 1.179 light); on the active tab `--app-surface-strong` in dark and `--app-surface-soft` in light (`:root[data-theme="dark"]`-scoped, the DESIGN.md section 3 rung table: 1.133 / 1.150); the "+" gets `--app-surface-strong`. | The rung depends on the real backdrop (DESIGN.md). New CSS-source test pins the four rules. |
| hel1028 `:156` (sm light, "panel has no bounding box") and `:219` (lg, flush sends no layout PATCH); `:252` failed the same way locally | Test race made visible by the intended hydration gating (D1: panels are fetched only after the tab set hydrates). `PanelGridSkeleton` renders one RGL `.react-grid-item` per saved layout entry (HEL-528 D10); with panels now fetched later, that layout-accurate skeleton stays up ~100 ms, so `toHaveCount(2)` is satisfied by the skeleton, and the next `boundingBox()` hits a node the real grid has just replaced (a MutationObserver probe showed `REMOVE`/`ADD panel-grid-shell` ~100 ms after the first mount, on `origin/main` too). | Branch: 1 to 2 of 3 iterations of `flush sends no|resize, immediate` failed with `panel has no bounding box`. `origin/main`: 24/24 passed (6 iterations x 4), with the same remount present, so only the window moved. After the fix: 24/24 on the branch (6 iterations x 4). | locator/wait: `openDashboard` also waits for `getByLabel("Loading panels")` to have count 0 and the items to be 2 again. | The skeleton is existing, intended behaviour; the helper measured a placeholder. No assertion weakened. |
| hel588 `:583` (Inspect dialog never appears) | Layout shift from the tab bar (+48 px of chrome, intended): the second of two stacked 288 px panels' click point moved to y=743, below the 720 px default viewport, so the raw `page.mouse.click` hit nothing. | Probe logged the canvas boxes: `{"y":656,"height":288}` for panel B (click y = 656+144-57.6 = 742 > 720). Passes on `origin/main` (the box fits there). | locator/helper: `clickPieChart` calls `canvas.scrollIntoViewIfNeeded()` before the animation wait and measuring. | A raw coordinate click must be inside the viewport; nothing about the assertions changed. 3/3 file runs pass. |
| hel1605-row-delete-confirm `:144` (375px I14, `groupBottom` 81 not < 0) | Web-font timing flake in the gesture-point computation, **not related to this change**: HEL-1606 (`563a4c476`, "Wait for web fonts before computing row double-click gesture points") fixes it and was not in the CI head. | `git merge-base --is-ancestor 563a4c476 bf1421dfb` is false; the spec and `rowDeleteGesture.ts` differ between bf1421dfb and this head by exactly the 1606 edit (`:144` is `:146` now). Passes on `origin/main` and on this head (individually and in the full run: `I8`, `I14` 375 and 768 all green). | none (merged from `origin/main`, step A). | Pre-existing, already fixed upstream. |

## Step A (merge)

`origin/main` (453c57f1e) merged cleanly (643026f22). HEL-1600's `NETWORK_ALLOWLIST` listed four files owned by this
branch (`App.test.tsx` and `AppShell.rail.test.tsx` shared with HEL-1578/1579, `CommandPalette.test.tsx`,
`PanelList.test.tsx`). Each was run with its entry removed, the unmocked requests were listed, and each is now stubbed
with the HEL-1600 convention (`jest.mock(<service>, () => ({...requireActual, fn: reject}))`): `CommandPalette.test.tsx`
(`fetchDashboards`, `getPipelines`, `listAllOutputs`, `fetchSources`), `PanelList.test.tsx` (`getPipelines`,
`fetchSources`), `AppShell.rail.test.tsx` (`fetchConnectors`), `App.test.tsx` (`outputService` reads,
`fetchConnectors`, `listConnectors`). The four entries are removed from `frontend/src/test/networkGuard.ts`. HEL-1578 /
HEL-1579 still edit `App.test.tsx` and `AppShell.rail.test.tsx`: whichever merges second keeps these stubs and must not
re-add the entries.

## Verification transcripts (this worktree, final head)

All run from `/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575`;
transcripts are under `/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1575/`.

| gate | result |
| --- | --- |
| `npm run lint` (`lint.txt`) | exit 0, `--max-warnings=0` |
| `npm run typecheck` (`typecheck.txt`) | exit 0 |
| `npm run format:check` (`format.txt`) | exit 0, "All matched files use Prettier code style!" |
| `npm --prefix frontend run build` (`build.txt`) | exit 0, PWA `precache 41 entries` |
| `HELIO_JEST_MAX_WORKERS=3 npm test` (`jest-full.txt`) | exit 0: root 51 suites / 469 tests; frontend 634 suites / 7513 tests |
| `npx playwright test --workers=2` under `nice -n 19` (`e2e-full.txt`) | exit 0: 325 tests discovered, **324 passed, 1 skipped** (the opt-in `hel1575-switch-measurement`), 0 failed, 19.6 min; 21 lines of `hel1575-dashboard-tabs` specs green |

No backend file changed, so `sbt testFull` was not re-run.

## Merge with HEL-1579

`origin/main` (HEL-1579 `31263face`, HEL-1614 `d517db75b`) was merged into this branch. Conflicts: `CLAUDE.md` (kept main's
reworded `GET /api/dashboards/:id/panels` line and this branch's `dashboard-changes` line), and the CSS-count pins in
`elevationTokenGuard.css.test.ts` / `motionTokenGuard.css.test.ts`.

- **Shared predicate.** The `hideDashboardBreadcrumb` prop is removed from `CommandBar`/`App`. `app/hidesBreadcrumbItemName.ts` now
  returns true on the rail shell for the pipeline detail route (HEL-1579) and for `isDashboardViewPath` routes (`/home`,
  `/dashboards/*`, where the tab bar owns the name), and false on the phone shell. `CommandBar` has one `breadcrumbNameHidden`
  value gating both breadcrumb blocks. `hidesBreadcrumbItemName.test.ts` covers pipeline detail, the dashboard view with tabs
  (`/dashboards/:id`, `/home`) and the phone shell for both. The old "`/home` is not hidden" assertion was inverted on purpose:
  `/home` is a dashboard view, and the tab bar now shows its name.
- **CSS pin = 143.** `find frontend/src -name '*.css' | wc -l` = 143 = 135 (shared base) + 6 (HEL-1579 spine/step files) + 2
  (this branch: `DashboardTabBar.css`, `PaletteSearchBox.css`). Both guards pin 143; neither guard was loosened.
- **Network-guard allowlist.** `frontend/src/test/networkGuard.ts` merged cleanly: it holds HEL-1579's five `PipelineDetailPage*`
  entries and no entry for `CommandPalette.test.tsx`, `PanelList.test.tsx`, `AppShell.rail.test.tsx` or `App.test.tsx`.

Transcripts (this worktree), in `scratchpad/hel1575/`: `static.txt` (lint, typecheck, format:check, build all exit 0),
`jest.txt` (frontend 641 suites; the one failure was the inverted `/home` assertion, then fixed and re-run green),
`e2e-merge.txt` (318 passed, 15 failed: the Playwright run lacked `DATABASE_URL`, so its psql helpers hit the shared dev DB
while the backend used a private DB), `e2e-rerun.txt` + `e2e-expired.txt` (those specs re-run with the right DB: 34 passed;
the one "expired tab" failure is a load flake, 3/3 green on its own), `sbt.txt` (`Tests: succeeded 8161, failed 0`).
The shared dev DB had V136 applied by another lane and lacked V135, so Flyway refused to start; this run used a private
scratch DB (created and dropped), not the shared one.

## Fix cycle 2: one PATCH per page leave (evaluation-4.md)

Defect: the general `/api` limit (120 per 60 s per user) tripped `e2e/state-surface-contrast-guard.spec.ts:760` (overlays, light),
because `handlePageHidden` ran on both `visibilitychange`->hidden and `pagehide` on every route and re-stamped `lastViewedAt`,
sending two keepalive PATCHes per leave. Neither the limit nor the guard changed.

Fix (`tabsBrowserTriggers.ts`): a leave is handled once (hidden + pagehide; re-armed on visible/`pageshow`); the stamp and capture
apply only on the dashboard view (`isDashboardViewPath`), and the stamp only when the stored one is older than 5 min; a pending real
tab change is still flushed with `keepalive` from any page. `visibilitychange`->visible refreshes `/api/dashboard-changes` at most
once per 30 s, and the visible/2-minute refreshes fire only on the dashboard view. Kept: hydrate and tab-add refreshes (hydrate
decides the warm restore; tab-add is user-driven). Recorded as D7 in `design.md`.

Unit tests (`tabsBrowserTriggers.test.ts`): RED on the pre-fix code (5 of 13 failed, `red-run-fix2.txt`), GREEN after (tabs dir:
17 suites / 213 tests).

Overlays (light), `--repeat-each 5 --workers=2 --trace on`, 5 passed, 0 HTTP 429s. `/api` requests per run, counted from the traces
(`api-counts.txt`): 102, 103, 102, 102, 102 (of which `dashboard-changes` 11, 11, 11, 11, 10; preferences PATCH 1 each). That is 17-18
requests (about 15%) under the 120 limit, against 117-123 before the fix. Load average at start 2.9.

Gates (this worktree, SCRATCH `hel1575/`): lint, typecheck, format:check exit 0 (`static.txt`); `npm --prefix frontend run build`
exit 0; `HELIO_JEST_MAX_WORKERS=2 npm test` exit 0: root 55 suites / 485 tests, frontend 641 suites / 7640 tests (`jest-full.txt`).
Shared dev DB at V135 (flyway_schema_history), used by both backend and Playwright (`backend/.env`); no scratch DB created. No backend
file changed, so no `sbt testFull`. origin/main had not moved (no merge needed).

Full e2e (`flock ... e2e.lock nice -n 19 npx playwright test --workers=2`, `e2e-full-fix2.txt`): **333 passed, 1 skipped** (the opt-in
`hel1575-switch-measurement`), 0 failed, 20.7 min; load average 5-9 during the run (below the 15 rerun threshold).

## Fix cycle 2b (evaluation-5 CR1)
The leave capture now stamps the browser copy with the current time (`viewedAt: serverNowMs()`, local only), so a leave can no longer
replace the heartbeat's fresher stamp with a stale stored one; C1 (15 min warm TTL) holds. design.md D7 corrected (it wrongly called a
shortened TTL owner-approved). Red-first in `evidence-red-first.md`. Not done: making the hydrate refresh update the 30 s visible-refresh
timer (the timer is closure-local; harmless extra request at most once per 30 s). Gates: lint/typecheck/format:check/build exit 0; tabs jest
215 passed; full frontend jest 641 suites / 7642 tests exit 0; hel1575 e2e 21 passed; overlays (light) x5 passed, /api 105,103,102,102,102,
0 429s. Full e2e result below.
Full e2e (flock, workers=2, nice 19; `fix2b/e2e-full.txt`): **333 passed, 1 skipped**, 0 failed, 20.8 min.

## CI two-device + HEL-1576 merge
**CI failure (run 38834564117, e2e (4), head 76fca5fa6, `hel1575-dashboard-tabs.spec.ts:652`, two devices, 125 s idle).** Root cause: a TEST RACE,
not a product defect. Probe: the CI trace (`playwright-report-shard-4`, downloaded to `SCRATCH/ci-art`) holds every network request of the three
contexts. Device A (the idle page) sent two preferences PATCHes: 01:29:11.892 (one tab, the active id) and 01:29:15.167 (the full three-tab set,
`lastViewedAt` values 01:29:12.4 / 13.3 / 14.0). Device B's save landed at 01:29:14.579, between them. A's second PATCH is the 1 s coalesced
save of the two tabs A opened in `openThreeTabs`; it was queued by A's OWN edits (last at :14.031), not by an idle path (no visibilitychange, pagehide,
hydration write or heartbeat PATCH occurred; the only other A request in the window was `POST /api/events`). The test waited only on
`expectSavedActive`, which already passes on the FIRST write (active id A, one tab), so B saved before A's own writes had settled. Last-write-wins
is the designed behaviour for a user's own edit, so the product is unchanged and the assertion is untouched (B's set must never be reverted by an
idle A, plus zero PATCHes from A over 125 s). Fix: before B saves, the test waits for the server to hold A's full set, `expectSaved(page,
[A, B, C], A)`. Proof: `--repeat-each 5` 5/5 passed (2.2-2.3 min each), and 2/2 with three busy-loop CPU hogs (load 5.7-6) running
(`fix2c/two-device-repeat5.txt`, `two-device-stress.txt`).

**Merge of origin/main (HEL-1576, 38de7610a).** Conflicts: `App.tsx`, `DESIGN.md`, `networkGuard.ts`, the two token-guard CSS-count pins. Resolved:
- Shared predicate: `app/dashboardChrome.ts` now has one private `isRailDashboardView` (`!isPhoneShell && isDashboardViewPath`) with two exports,
  `usesDashboardMetaRow` (HEL-1576) and `usesDashboardTabBar` (this branch; `App.tsx`'s `showTabBar` no longer has its own conditional).
  `hidesBreadcrumbItemName` takes its dashboard clause from `usesDashboardTabBar`. Behaviour identical for both lanes (tests in
  `dashboardChrome.test.ts`).
- CSS-file pins recounted with `find frontend/src -name "*.css" | wc -l` = 144 (135 + 6 HEL-1579 + 2 HEL-1575 + 1 HEL-1576), both guards; not loosened.
- `networkGuard.ts`: kept this branch's drained allowlist; HEL-1576 itself removed the `DesktopPanelGrid.processedWidth` entry on main (that file makes no
  network request on the merged tree); this branch only took main's version.
- Adapted tests: `AppShell.dashboardMetaRow.test.tsx` store gets the `dashboardTabs` reducer (hydrated); `AppShell.rail.test.tsx` no longer expects a
  breadcrumb on the dashboard view (the meta row replaced the command bar; the name rule is covered in CommandBar tests); the hel1575 e2e drag
  helper turns Edit layout on first (panels move only in edit mode now).
- No backend change and no migration in the merge (latest V135): no `sbt testFull`.
- Visual check at 1280 and 820, light and dark (`.concertino/runs/HEL-1575/evidence/merge-1576/`): the meta row sits directly under the 49 px tab strip
  (tab bar y 0-49, meta row y 49-97, same x/width), tabs/search box/Share/Add panel render in both themes; phone shell 768 and 375: no tab list,
  no meta row, the command bar (unchanged).
- Gates on 4f492359d (+ the e2e helper edit committed after): lint, typecheck, format:check, build exit 0; full jest 650 suites / 7761 tests exit 0;
  overlays x5 (light+dark, 10 runs) passed, /api 102-104 per run, 11 `dashboard-changes`, 1 preferences PATCH, 0 429s; full e2e (flock, workers 2):
  331 passed, 1 skipped, 2 failed: the hel1575 dragged-panel test (the Edit-layout helper above, fixed) and `hel813 ... surface 7: Connectors page`
  (a create-connector dialog stayed open once; touches nothing in this diff; 12/12 on `--repeat-each 6` of it, and it passed in the rerun). Rerun of
  the whole hel1575 + hel813 specs: 35 passed. Transcripts in `SCRATCH/fix2c/`.

## evaluation-7

- Failure: `hel1457-stale-tab-layout-save.spec.ts` ("a conflict that cannot be rebased"), `boundingBox()` null in `dragA`. Cause: the
  `.react-grid-item` count wait is satisfiable by the loading skeleton; the meta row's "Edit layout" button mounts only with the real desktop
  grid, so the guarded click (`count() > 0`) was skipped and the drag handle did not exist yet. HEL-1575 loads panels after tab hydration,
  which widens the window (same mechanism as the hel1028 fix).
- Reproduced before the fix: 8 repeats passed, then 16 repeats failed once (1/16) at the same line (`fix2d/hel1457-prefix*.txt`).
- Fix: both gotos now wait for `getByLabel("Loading panels")` to reach count 0; `dragA` asserts the "Done" button is visible after the guarded
  click so a skipped click fails at its cause. No assertion weakened. After: `--repeat-each 12` = 24/24 pass under the lock.
- Sweep of every spec using "Edit layout", a drag handle or `mouse.down`: hel1028 (already waits for the skeleton), hel1230 (unconditional
  auto-waiting click), hel1575-dashboard-tabs (`enterLayoutEditMode` asserts "Done"; drag helper runs after load), hel1574 (separator drag, no
  grid), hel1605 (table cell), hel908 (pipeline editor). No other occurrence of the pattern.
- Non-blocking: comment on `hidesBreadcrumbItemName` (dashboard clause latent: no command bar on the rail dashboard view); corrected the
  `processedWidth` attribution above (HEL-1576 removed it on main).

## Merge with HEL-1572 (2a9f9e467, appearance preferences)

Skeptic final round 4 found `git merge-tree` conflicts in 14 files (GitHub `CONFLICTING`) because both lanes had rewritten `PATCH /api/users/me/preferences`.

- **One contract.** HEL-1572's `PreferencesPatch` + `patchPrefs` is the only patch path; `patchShellPrefs` is gone. `PreferencesPatch` gained
  `dashboardTabs: Option[DashboardTabsPref]` (replaces the stored set as a whole). `UserPreferences` (response) and `UserPreferencesData` carry accentColor, zoomLevels,
  contextListWidth, contextListCollapsed, typeStyle, density, motion and dashboardTabs (`jsonFormat8`); the route allow-list adds `dashboardTabs`;
  `UserResponseAssembler`, the `/api/auth` update route and the route response all pass the union. `mergePrefs` keeps HEL-1572's `- 'motion'` clear branch.
  Both JSON schemas, `openspec/specs/user-ui-preferences/spec.md` and the archived delta state the union (drift check passes). No migration, no dependency.
- **Route tests (both directions, `UserPreferencesRoutesSpec`).** A `dashboardTabs` write leaves accent/width/typeStyle/density/motion stored values equal;
  appearance writes (typeStyle, then `motion: null`) leave the stored `dashboardTabs` equal and `motion` absent; a mixed body applies both kinds, and a mixed body with
  invalid tabs is a 400 that changes nothing. The user-isolation tests are kept. `AuthServiceSpec` now writes tabs and appearance through `patchPrefs`.
- **Frontend.** `main.tsx` keeps `startTabsBrowserTriggers(store)` and HEL-1572's appearance wiring; `user.ts` keeps both lanes' fields. New
  `dashboardTabsPrefsSeam.test.ts`: an `updateUserPreferences.fulfilled` response that carries a stale `dashboardTabs` does not change the in-memory tab set
  (same object), schedules no tabs write and starts no hydration (this is a guard, not a red-first test: the existing code already behaved so; `hydrated` is
  one-shot and `saveShell/AppearancePreferences` never write their response back).
- **CSS pins.** `find frontend/src -name '*.css' | wc -l` = 146 (144 + `AppearanceSection.css` + `SegmentedRadioGroup.css`); both guards pin 146, none loosened. DESIGN.md keeps
  HEL-1572's `--density-grid-gap` gutter text and this branch's `⌘K` button text. The network-guard allowlist did not conflict and was not touched.
- **Visuals** (`.concertino/runs/HEL-1575/evidence/merge-1572/`): tab strip y 8-49 and meta row y 49-97 at 1280 and 820, light and dark, in default, Compact,
  Serif and Compact+Serif; geometry identical across all 16 shots; the strip scrolls (third tab clipped at 820) as before.
- **Gates on the merged tree:** lint, typecheck, format:check, build exit 0; `check:schemas` ok; full jest 660 suites / 7840 tests (the one failure was my new seam test's
  wrong tab-order expectation, fixed, 2/2); `sbt testFull` under the lock 8170 succeeded, 0 failed (4 canceled, pre-existing); full e2e under the lock, 2 workers:
  361 passed, 1 skipped, exit 0 (includes hel1572, hel1574, hel1575, hel1576). Transcripts in `SCRATCH/merge1572/`.

## Fix cycle 3 — reload path (evaluation-9, CI run 38863940699)

Three symptoms; they do NOT share one cause. Head e6dbad79a, worktree `/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575`.
Transcripts: `.concertino/scratch/HEL-1575/fix3/` (each starts with the worktree path and head SHA).

### Symptom 2 (CI hel1260:148, "no .react-grid-item after reload"): root cause found and fixed

- **Probe.** The CI trace (`fix3/ci/tr`) shows, after `page.reload()`, `/me`, `/dashboards`, `/dashboard-changes` and NO `GET /panels`; the page text says "0 panels".
  So a stored browser copy with an empty list was restored as valid. Server times in the trace: first panels fetch started 07:00:50.8 (empty list captured then), the create committed at
  `contentUpdatedAt` 52.574, own-write receipt plus 2 s slack = 54.6. The copy validates when `contentUpdatedAt <= max(contentCapturedAt, ownWriteAt)`: 52.574 <= 54.6.
- **Cause.** An own write was claimed as covering a stored copy that did not contain it, by two paths:
  1. `noteOwnDashboardWrite` called `patchOwnWrite`, which merges the new `ownWriteAt` into the stored copy of the LOADED dashboard (the copy still holds the pre-write list). Live probe of IndexedDB
     (`probe/idb.spec.ts`): after the create the stored entry was `panels: 0, own: <the write>`; 2.8 s later `panels: 1`. A reload inside that window restored `[]`.
     `markDashboardPanelsStale` is itself an own-write source and clears `loadedDashboardId`, so a "loaded" check alone missed the real `createPanel` sequence (found by this probe).
  2. A debounced write built its entry at fire time: `items` and `contentCapturedAt` were frozen when it was queued, but `ownWriteAt` was read live, so a write that happened between queue and fire was
     attributed to an older list. (Reproduced by the second red jest test.)
  The pref flush on pagehide carries `ownWriteAt` too (`applyWarmEntry` takes the later of the two), so a stored copy must simply never exist across a write that it does not include.
- **Fix (product code).** `warmCache.noteOwnDashboardWrite` takes `listLoaded`: for the on-screen dashboard (active tab, or loaded list) the stored copy is removed (`BoundedWarmStore.remove` also cancels a queued write)
  instead of patched; `warmListeners` then queues a fresh capture straight away, claiming the write it now includes. `warmCapture` freezes `ownWriteAt` with the items at capture time
  (`buildWarmEntry` takes it as a parameter). A left tab still gets the patch (design D4; a rename or layout flush after leaving does not change its panel list).
- **Guards that fail on the old code.** `warmReloadStaleCopy.test.ts` (jest, 2 red / 5, see `evidence-red-first.md`) and `e2e/hel1575-reload-after-edit.spec.ts` (e2e; reloads at 0 / 0.3 / 1.2 / 1.8 / 2.4 s after the create; 4 of 6 fail on the old code).
- **Counts.** `hel1575-reload-after-edit` `--repeat-each 6` = 30/30; `hel1260` `--repeat-each 30` = 120/120; `dashboards/tabs` jest 222/222.

### Symptom 1 (intermittent "Maximum update depth exceeded"): root cause found; it sits inside react-grid-layout, so this is an ESCALATION (no workaround applied)

- **Deterministic reproduction** (`probe/probe.spec.ts`): a warm tab, a reload, and the browser-store read delayed past the 500 ms restore timeout (the skeleton stays up for the whole window).
  3 of 3 runs: 52 to 61 update-depth errors, all before the first panels request, exactly the evaluator's signature. The slow read only widens the window; the loop starts as soon as the skeleton mounts.
- **What loops** (the dependency was re-served with logging via `page.route`): the skeleton's `Responsive` is first rendered for dashboard X at the initial width 1280 (breakpoint `md`), then in the next render receives
  dashboard Y's layouts (the URL's dashboard; `fetchDashboards` first selects the most recent one) AND the measured width 928 (breakpoint `sm`). Its inner `GridLayout` sync effect then alternates between the `md` layout
  (w 5) and the `sm` layout (w 3) forever (`RGLSYNC` log: `props` and `cur` swap on every pass).
- **It is the library.** A bare `Responsive` from react-grid-layout 2.2.4 with no Helio code (`fix3/rgl-bare-repro.test.tsx.txt`) loops when ONE render changes both `layouts` (and the children) and crosses a breakpoint;
  each change alone settles in 2 renders. The real `PanelGrid` is mounted with `key={selectedDashboardId}`, which is why it never meets this; the skeleton is not keyed.
- **Why only on this branch (hypothesis, main was not instrumented).** On main the panel area is probably first mounted under the bootstrap skeleton (no dashboard selected yet), so the width has settled before the selection moves. Here the first skeleton render already has the dashboard list loaded (the log shows both renders at +7114 ms, right after `/dashboards`).
- **Stopped here** per the owner's plan: any fix (key the skeleton by dashboard, stop the transient wrong-dashboard selection, patch or replace the library) works around a library defect and needs the owner's decision.
- **Rate in this cycle.** 39 of 40 runs of the evaluator's harness were clean (0 update-depth errors) with the symptom-2 fix in place, so the harness alone is a poor guard here; the delayed-read probe above is the reliable reproduction.

### Symptom 3 (3-tab set seeded through the API loaded as 1 tab): not reproduced

40 harness runs, each asserting the server's tab count after every load (`harness/before-1/summary.txt`): tab count was 3 every time, and PATCH bodies are logged per run. No `pagehide` overwrite was observed.
The one failed run (run-17) was a different symptom: `html` never received `data-theme` within 5 s on the first load (no trace was kept; the config now writes artifacts to the scratch directory). It is recorded, not explained.
