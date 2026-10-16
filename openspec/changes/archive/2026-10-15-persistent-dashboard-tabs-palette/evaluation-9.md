## Evaluation Report — Cycle 9 (evaluation-9.md)

Head reviewed: `e6dbad79a9caaef1278115dee322443d28a94642` (worktree
`/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575`). The review base was resolved
live: `db91c840e` (origin/main). Since evaluation-8 (PASS on `c999d3ccf`) the branch has three new commits: `b2cb8e574`
(merge of HEL-1572), `41daeb1f5` and `e6dbad79a` (merge of HEL-1617, helio-mcp only).

Correction to the brief: `41daeb1f5` only touches `ci-fix-cycle.md`. The cross-key route tests and
`dashboardTabsPrefsSeam.test.ts` were added in the merge commit `b2cb8e574` (`git log` on both files). This does not
affect the verdict.

### Phase 1: Spec Review — PASS
- **HEL-1572 behaviour is preserved exactly.** I read `archive/2026-10-15-appearance-type-density-motion/design.md` D1
  and D2 and diffed `2a9f9e467..e6dbad79a` over backend, schemas and specs.
  - Every HEL-1572 path is unchanged: `PreferencesPatch`/`patchPrefs`, the enum validation, the `motion: null` →
    `Some(None)` → jsonb `- 'motion'` clear in the same UPDATE, invalid stored values dropped on read,
    `saveAppearancePreferences` (fire-and-forget, response not written back) and `ThemeProvider`.
  - The merge adds only `dashboardTabs` alongside the existing keys: `PreferencesPatch` field, allow-list entry,
    `UserPreferencesData`/`UserPreferences` field (`jsonFormat8`), assembler, the `/api/users/me/update` response
    and the `tabsJson` merge entry.
  - On the frontend, the only change to HEL-1572's auth code is that `patchShellPreferencesRequest` now takes the
    union `PreferencesPatch` (`authService.ts:58-63`).
- **Every key of both lanes round-trips.** `UserPreferencesRoutesSpec` (b2cb8e574) checks:
  - tabs plus width plus accent, delivered on `/me`;
  - a `dashboardTabs` write leaves accent, width, typeStyle, density and motion byte-equal in storage;
  - appearance writes, including `{motion: null}`, leave the stored `dashboardTabs` equal and remove `motion`;
  - a mixed body applies both halves, and a mixed body with invalid tabs returns 400 and changes nothing;
  - 20 tabs are accepted and 12 invalid shapes are rejected;
  - user isolation, and an invalid stored set is read as unset.

  All of these ran green in my sbt run (named in the transcript).
- Schemas (`user-preferences`, `update-user-preferences-request`) and the canonical `user-ui-preferences` spec state
  the union. `check:schemas` exit 0.
- CSS-file pins: I counted independently and got 146 (`find frontend/src -name '*.css' | wc -l`), which matches both
  guards.
- DESIGN.md keeps HEL-1572's density/gutter text and this lane's Tabs and `⌘K` text.
- CONSTRAINTS C1–C7: nothing in the merge weakens them. No new dependency (`package*.json` is identical to main) and
  no new table or migration.

### Phase 2: Code Review — PASS
I ran every gate myself on this head. Each transcript starts with the worktree path and the full SHA.

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run check:schemas` | exit 0 |
| `npm --prefix frontend run build` | exit 0 |
| Full jest, `HELIO_JEST_MAX_WORKERS=2`, `nice -n 19` | root 58 suites / 493 tests; frontend **660 suites / 7840 tests**, 0 failed (`jest.txt`) |
| `sbt testFull` under `sbtfull.lock`, servers stopped | **8170 succeeded, 0 failed**, 4 canceled, 621 suites (`sbt.txt`) |

Evidence refs: `.concertino/runs/HEL-1575/evidence/.concertino/scratch/HEL-1575/eval9/{jest,sbt}.txt`.

**Seam test honesty.** `dashboardTabsPrefsSeam.test.ts` is labelled a guard, not red-first, and that label is
correct. I mutation-tested it in a throwaway detached worktree at this head, which I removed afterwards:
- Dropping the `!tabsOf(state).hydrated` hydration guard (`dashboardTabsListeners.ts:46`) makes **both** tests fail.
- Adding an `updateUserPreferences.fulfilled` case to `dashboardTabsSlice` that writes the response's tabs back makes
  the "does not revert" test fail.

So the test can fail on the regression it names.

No code-quality violations in the merge delta. Non-blocking notes are listed below.

### Phase 3: UI Review — FAIL
- **Full e2e** under `e2e.lock`, `--workers=2`, `nice -n 19`, DEV_PORT 7007 / BACKEND_PORT 9914 from
  `start-servers.sh`, with the same DB as the backend (`backend/.env`): **361 passed, 1 skipped, exit 0**, 21.3 min,
  on this head (`e2e-full.txt`, persisted next to `jest.txt`).
- **Phone shell at 768 and 375, both themes, Comfortable and Compact.** I used my own Chromium via a scratch spec,
  with the port asserted to be 7007 before each step.
  - No tab strip and no meta row on the phone shell, as DESIGN.md and the planning notes require.
  - BottomNav renders, and the document is no wider than the viewport (`docScrollW == vw`).
  - No clipped non-ellipsis text.
  - Screenshots: `shots/compact-light-375.png`, `comfortable-dark-375.png`, `compact-dark-768.png`.
- **Compact density on desktop (1280 and 820, both themes).**
  - Tab strip 49px, tab button 40px, meta row y 49–97 (48px), identical to the executor's default geometry.
  - The active-tab accent bar and muted inactive tabs are as specified.
  - The strip scrolls sideways at 820 (third tab off-strip).
  - Screenshots: `shots/compact-light-1280.png`, `compact-dark-820.png`.
- **Console errors: FAIL.** An intermittent React "Maximum update depth exceeded" console error appears on this head
  and was not seen on main.
  - **Where it fires.** The flow is: log in, create 3 dashboards with a markdown panel, PATCH density and
    `dashboardTabs`, then load `/dashboards/:id` at 1280/820/768/375 in light and dark. The error fires on a full
    page load at 1280: 1 to 26 occurrences over about 350 ms.
  - **Rate.** It occurred in **5 of 32** runs on this branch and **0 of 22** runs on main `db91c840e` (scratch
    detached worktree, own servers on 7098/9998, same DB, the identical spec minus the `dashboardTabs` key, which
    main rejects). The comparison included 4 cold-restart A/B cycles. If the true rate were the branch's 0.156,
    P(0 of 22) ≈ 0.024.
  - **Stack.** The captured `new Error().stack` at the `console.error` call shows a `setState` inside
    react-grid-layout's layout/children sync effect (`useEffect` with deps
    `[propsLayout, children, cols, compactType, compactor, activeDrag, droppingDOMNode, layout]` →
    `setLayout(newLayout)`), committed from passive effects.
  - **Why the branch is implicated.** In the instrumented run (`run3-30.txt`) all 13 occurrences come **before** the
    load's first `GET /api/dashboards/:id/panels` (errors at +13295–13643 ms, the panels GET at +13811 ms). After a
    fresh page load, a grid render before any panels request can only come from this branch's warm-restore window:
    `restoreStarted` → `PanelList` shows `DesktopPanelGridSkeleton` (a `Responsive` grid whose `layouts`/`stubs` are
    rebuilt every render) for up to 500 ms, or `panelsRestored`. Neither path exists on main.
  - **Not deterministic.** Five focused loops of 10 iterations each (375→1280, 1280-only, theme toggling,
    Comfortable) all gave 0. The trigger involves the multi-tab, multi-width sequence and timing.
  - Evidence: `maxdepth-evidence.txt` (per-run counts, branch and main), `run3-30.txt` (instrumented hit with
    request timeline and stack), and the harness `eval9-visual.spec.ts` + `playwright.config.ts`, all under
    `.concertino/runs/HEL-1575/evidence/.concertino/scratch/HEL-1575/eval9/visual/`. Run the harness with
    `EVAL9_SPEC` unset, `DEV_PORT=7007 BACKEND_PORT=9914 npx playwright test --config <that config>`; it extends the
    worktree's `playwright.config.ts` and uses its user registry, so throwaway users are deleted.
- The executor did not check 768/375. I checked them above.
- Both "1 tab instead of 3" (below) and the error rest on observed counts and request ordering (timestamps from one
  process clock in one run). Neither rests on file mtimes.

### Overall: FAIL

### Change Requests
1. **Root-cause and fix the intermittent "Maximum update depth exceeded" during a warm-restore dashboard load**, then
   show it is gone.
   - **Start from the evidence.** The stack is react-grid-layout's sync effect → `setLayout`. It fires before the
     load's first panels GET, so the grid is rendering during `restoringDashboardId === selectedDashboardId`
     (skeleton) or after `panelsRestored`.
   - **Suspects to probe:**
     - `PanelList.tsx` `showPanelGridSkeleton` (the new `restoringDashboardId` clause) re-rendering
       `DesktopPanelGridSkeleton` once per store update while `layouts` and `stubs` are rebuilt each render;
     - a warm-restored `items`/layout pair that `synchronizeLayoutWithChildren` keeps "correcting", for example
       stubs or children whose ids do not match the layout entries;
     - the window where `panelsRestored` swaps `items` and a background `fetchPanels` then swaps them again.
   - **Confirm the cause with a probe before fixing** (systematic-debugging law). For example, count `setLayout`
     calls per render, or log `restoreStarted`/`panelsRestored`/`fetchPanels.fulfilled` timing against the warning.
   - **Then:**
     - add a failable guard: a jsdom or e2e test that counts RGL layout-sync updates, or asserts no
       `Maximum update depth` console error across a warm-restore load, and is shown to fail on the current code;
     - re-run the persisted harness at least 30 times with 0 occurrences;
     - record both in `ci-fix-cycle.md`.

   If the probe shows the loop is a pre-existing main defect that this harness merely exposes more often, prove that
   with a main-side reproduction. Then raise it as a spinoff instead of fixing it here.

### Non-blocking Suggestions
- `patchDashboardTabsRequest(wire: unknown)` (`frontend/src/features/auth/services/authService.ts:67`): type the
  parameter as `TabsWire` (or `DashboardTabsWire`) instead of `unknown`.
- `ci-fix-cycle.md` "Merge with HEL-1572" says "146 (144 + `AppearanceSection.css` + `SegmentedRadioGroup.css`)", but
  main's 144 already included those two. The guard comment's arithmetic (135 + 6 + 2 + 1 + 2) is the correct one.
  Align the prose.
- **Low-confidence observation, not reproduced in about 40 later runs.** In my first harness run, a 3-tab set seeded
  through the API after sign-in loaded as 1 tab and stayed at 1. This is consistent with a pending whole-set tabs
  write from the previous page (`/home`), flushed on `pagehide`, overwriting a newer server value. That is
  last-writer-wins by design (`dashboardTabs` replaces the set whole). Noted only so the skeptic can judge the
  cross-device case.
- **Judgment, deferred to the skeptic.** At 820 the third tab sits off-strip with no visible overflow affordance (the
  strip scrolls).
- **Process note.** The executor self-reported one read-only `pgrep` use against the lane rule; recorded, no effect
  on this verdict.

### Critical Path
`CYCLE` 9 is beyond the resolved `EXECUTION_CYCLES` of 3. The merge itself is sound: contract union, round-trips and
every gate are green on this head, and the full e2e passes. The single blocker is the branch-only, intermittent React
update-depth loop on a warm-restore load (CR1).

Recommendation for the human: have the executor probe and fix CR1 using the persisted harness. If it proves
pre-existing on main, accept it as a spinoff with the main-side reproduction attached. No other rework is needed.
