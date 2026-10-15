## Evaluation Report — Cycle 4 (evaluation-4.md)

This cycle is the owner-approved CI fix cycle. I reviewed head `b91b454761beae0d1103b0c86058150864c9f3cf`. The review base was resolved live as `7fd2f4f29` (= `origin/main`, an ancestor of HEAD). The scope is everything since the cycle-3 PASS:
- `7c31e14a0`: the CI e2e fixes;
- `67015f688`: the merge of HEL-1579 and HEL-1614, plus the breadcrumb predicate fold;
- `b91b45476`: the merge of HEL-1610 and HEL-1601.

Spawn guard: `READY ambient=/home/matt/Development/helio branch=feature/persistent-dashboard-tabs-palette/HEL-1575`.

Scratch artifacts are in `/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1575/eval4/`, called `eval4/` below. Every transcript starts with this worktree's path and HEAD sha. `persist-evidence.sh` refuses sources that sit outside a git worktree, so the only artifacts persisted durably are the failing trace and its error context (see Phase 2).

### Phase 1: Spec Review — PASS

I checked each item the orchestrator asked about against the diff.

**1. Locator changes are justified only by the intended Ask row.** No assertion or guard was weakened.
- `e2e/hel516-palette-quick-create.spec.ts:46`: `runPaletteAction` now uses `{ name: title, exact: true }`. The click still targets the action; only the second match (the Ask row) is excluded.
- `e2e/hel503-palette-global-resource-search.spec.ts:148-151`: the same change, on both the expectation and the click. The active-dot assertions after it are unchanged.
- `hel503:225-229`: the 5-source cap is still asserted, now with `hasNotText: "Ask the assistant"`. The new `toHaveCount(6)` pins the total, so the assertions are stricter than before, not looser.
- `e2e/hel1028-layout-undo-redo-visual-revert.spec.ts:74-79`: two waits were added (the skeleton is gone, then the real grid has 2 items). No assertion was removed.
- `e2e/hel588-cross-filter-panels.spec.ts:217`: one `scrollIntoViewIfNeeded()` before a raw-coordinate click. The assertions are untouched.
- The HEL-866 guard spec is untouched in this cycle.
- `frontend/src/test/networkGuard.ts`: four allowlist entries were removed. This tightens the guard, and the replacement `jest.mock` stubs follow the HEL-1600 convention.

**2. The hydration fix is correct** (`frontend/src/features/dashboards/tabs/hydrateTabs.ts:76`).
- `dirty = autoSelectedId !== null` is reached only in the "no saved key / everything pruned" branch.
- The stored-empty-set branch (`:68`, `saved !== null && saved.tabs.length === 0`) still returns `target: null` with `dirty` false. Its unit test (`hydrateTabs.test.ts:120`) is unchanged and green.
- A new unit test pins the zero-dashboard case.
- Live probe (`eval4/probe.json`, page port 7007):
  - a zero-dashboard user's load sends no preferences PATCH (`zeroDashboardWrites: []`);
  - a dashboard created afterwards through the API is auto-selected on reload (`tabsAfterCreate: ["Eval4 Alpha"]`);
  - closing the last tab writes `{"dashboardTabs":{"tabs":[],"activeId":null}}`;
  - a reload after that shows 0 tabs and sends no write. The stored empty set stays empty.

**3. The contrast fix uses tokens and the DESIGN.md rung table** (`DashboardTabBar.css:53-71,184-187`).
- Only `var(--app-surface-*)` values are used; there are no literals.
- The active tab sits on `--app-surface` (`:78`). It uses `--app-surface-strong` in dark via a `:root[data-theme="dark"]` override and `--app-surface-soft` in light. That is exactly DESIGN.md §3 row 2.
- The inactive tab, the close control and "+" sit on the bar's `--app-surface-soft` (`:18`) and take `--app-surface-strong`. This backdrop has no table row; the rendered guard (the stated arbiter) passes it.
- My full run of the HEL-866 chrome guard reports `elements probed: 33 ... fail=0` in both themes.
- Live computed hover colours (`eval4/probe.json`):
  - light: active tab hover `rgb(239,236,230)`, which is the soft rung;
  - dark: active tab hover `rgb(38,35,32)`, the strong rung;
  - "+" hover: `rgb(255,255,255)` on the light bar `rgb(239,236,230)`.

**4. The predicate fold preserves both lanes' behaviour.**
- Before the merge, this lane hid the name when `showTabBar = !isPhoneShell && isDashboardViewPath`.
- `hidesBreadcrumbItemName` now returns `!isPhoneShell && (PIPELINE_DETAIL || isDashboardViewPath)`.
- `CommandBar.tsx:151` gates the dashboard block and `:161-163` gates the item-name block, which keeps `!onDashboardView`. On a non-dashboard route the predicate reduces to HEL-1579's pipeline-detail rule. Both lanes' behaviour is therefore unchanged.
- The inverted `/home` assertion is correct: `isDashboardViewPath("/home")` is true and the tab bar shows the name there.
- The phone shell is covered by unit tests. Live, at 1440 the breadcrumb reads `"Dashboards"` on both `/home` and `/dashboards/:id`. At 768 and 375 the phone title still reads `"Helio / Eval4 Alpha"` and there is no tablist.
- No `hideDashboardBreadcrumb` reference is left.

**5. The pin count is true.** `find frontend/src -name '*.css' | wc -l` = 143, and `git ls-files 'frontend/src/**.css' | wc -l` = 143. Both guards pin 143, and neither guard's scan logic changed.

**6. CONSTRAINTS C1-C7:** no regression in this cycle's diff. C6 holds: no new tokens, no new dependencies, no motion.

**7. DB note: verified.**
- The shared `helio` DB's `flyway_schema_history` holds 133, 134 and 136, with no 135.
- I created the private `helio_hel1575` and passed the same `DATABASE_URL` to both `start-servers.sh` and Playwright. The backend migrated it to V135 (135 rows).
- I dropped it afterwards; `pg_database` has no `helio_hel1575` row. The shared DB was only read (`max(version)` is still 136).

Issues: none.

### Phase 2: Code Review — FAIL

**Gates, run fresh on b91b45476:**

| gate | result | transcript |
| --- | --- | --- |
| `npm run lint` | exit 0 | `eval4/static.txt` |
| `npm run typecheck` | exit 0 | `eval4/static.txt` |
| `npm run format:check` | exit 0 ("All matched files use Prettier code style!") | `eval4/static.txt` |
| `npm --prefix frontend run build` | exit 0 (`precache 41 entries`) | `eval4/static.txt` |
| `HELIO_JEST_MAX_WORKERS=2 nice -n 19 npm test` | exit 0: root 55 suites / 485 tests; frontend 641 suites / 7634 tests (load 10.7 at start) | `eval4/jest.txt` |
| full e2e: `flock e2e.lock nice -n 19 npx playwright test --workers=2` | **exit 1: 332 passed, 1 skipped, 1 failed** (334 tests, 19.7 min; load 13.3 at start, 9.7 at end) | `eval4/e2e-full.txt` |
| re-run under the lock, `-g overlays --repeat-each 4`, with trace (load 10.3 at start, 10.5 at end) | **exit 1: 7 passed, 1 failed** | `eval4/e2e-overlays-rerun.txt` |
| `sbt testFull` | not re-run by me, as the driver allowed. Since the cycle-3 PASS (`d42a3936f`), backend changes have come only from `origin/main` merges. This branch's own backend files are unchanged since cycle 3. `b91b45476` adds only two HEL-1610 test files (`ClaudeRoutesChatGateSpec.scala`, `InFlightTracker.scala`). The executor's transcript of the merged tree, `scratchpad/hel1575/sbt.txt` (this worktree's paths), shows `Tests: succeeded 8161, failed 0`. Re-run it fresh in the next cycle. | n/a |

**The failure is caused by this branch, not by load.** The failing test is `e2e/state-surface-contrast-guard.spec.ts:760` › overlays (light). It failed at `:829` with `getByRole('button', { name: 'HEL-866 Guard Dashboard', exact: true })` not found. The page snapshot shows the dashboard list alert "Failed to load dashboards."
- The traces show `429 GET /api/dashboards`: the user has hit the general `/api` rate limit (`RATE_LIMIT_REQUESTS_PER_WINDOW`, default 120 per 60 s per user; CI uses the default too).
- Durable evidence:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1575/evidence/test-results/state-surface-contrast-gua-a5194--from-their-backdrop-light--repeat1/trace.zip`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1575/evidence/test-results/state-surface-contrast-gua-a5194--from-their-backdrop-light--repeat1/error-context.md`
- The request counts per test, parsed from the 9 traces (`eval4/rate-limit-counts.txt`), are all in about 25 s:

| run | total `/api` | prefs PATCH | `/api/dashboard-changes` | without those two | 429s |
| --- | --- | --- | --- | --- | --- |
| dark x4 | 117-121 | 14-18 | 11 | 92-93 | 0 |
| light (full suite) | 122 | 19 | 10 | 93 | `GET /api/dashboards` -> **fail** |
| light rerun 0 | 121 | 19 | 11 | 91 | 0 |
| light rerun 1 | 122 | 20 | 10 | 92 | `GET /api/dashboards` -> **fail** |
| light rerun 2 | 123 | 19 | 11 | 93 | 2 (passed by luck: non-gated requests) |
| light rerun 3 | 123 | 18 | 11 | 94 | 2 (passed by luck) |

- `/api/dashboard-changes` is new on this branch (`git grep dashboard-changes origin/main -- frontend/src backend/src` has zero hits). Before this branch nothing sent the preferences PATCH on page load or leave.
- Without those two, the test makes about 93 requests, well under 120. With them it makes 117-123, right at the limit. In 6 of 10 runs one or more requests were rejected with 429, and 2 of 10 failed outright.
- This is a count-per-window effect, not a timing one. The ~25 s burst fits inside one 60 s window at any runner speed, so CI is exposed in the same way.
- The executor's green full run passed at this boundary by chance.

**Root cause in product code** (`frontend/src/features/dashboards/tabs/tabsBrowserTriggers.ts:26-36,45-50`):
- `handlePageHidden` runs on **both** `visibilitychange`->hidden **and** `pagehide`. Each run dispatches `tabViewed` with a fresh `serverNowIso()` stamp, which makes a new pending write, and then calls `flushTabsWrite({ keepalive: true })`.
- So one navigation away sends **two** keepalive PATCHes with the same tab set; the `lastViewedAt` values differ by 1-3 ms.
- It also runs on every page, including `/sources`, `/pipelines` and `/settings`, where the dashboard is not on screen.
- Probe `eval4/probe-writes.json` (one dashboard, sequence `/home, /home, /sources, /pipelines, /settings, /home`, 3 s each) recorded 9 PATCHes for 5 page leaves: three leaves sent 2 and two sent 1. Every PATCH was `dashboardTabs` with only `lastViewedAt` changed.
- The duplicate is redundant by construction. It doubles a server write on every reload or tab-hide, and together with the per-load signals refresh it is what pushes an existing CI gate onto the rate limit.

**Code review of this cycle's diff, apart from the above:**
- **Tokens and DESIGN rules:** compliant. Token-only CSS, DESIGN.md rung table followed, and the CSS-source test pins the four rules (`DashboardTabBar.css.test.ts:57-71`).
- **DRY:** the predicate fold removes a competing conditional. Good.
- **Type safety:** no escape hatches added.
- **No dead code:** `hideDashboardBreadcrumb` is fully removed.
- **Tests meaningful:**
  - the new `planHydration` zero-dashboard test would catch a revert of `:76`;
  - the predicate tests cover the dashboard view, `/home` and the phone shell.

Issues:
1. The full e2e gate fails (see above). The cause is the duplicate leave flush plus the per-load signals refresh, introduced by this branch.

### Phase 3: UI Review — PASS

I started servers with `start-servers.sh ... 7007 9914 HEL-1575` (`PASS servers`) against the private DB. The probe is `eval4/probe.cjs` → `eval4/probe.json`, on page port 7007, with a throwaway user.

- **Happy path:**
  - the first dashboard is auto-selected into a tab;
  - the breadcrumb yields to the tab on `/home` and `/dashboards/:id`;
  - closing the last tab leaves an empty set that survives a reload.
- **Unhappy path:** a zero-dashboard user gets no spurious write (the defect this cycle fixes).
- **Breakpoints:**
  - 1100: tablist visible, horizontal overflow 0;
  - 768 and 375: no tablist (phone switcher), phone title shows the dashboard name, overflow 0;
  - 1440: screenshots `eval4/tabs-1440.png`, `eval4/tabs-375.png`.
- **Console errors:** `[]` across the whole probe.
- **Hover contrast:** both themes match the rung table (see Phase 1, item 3), and the rendered HEL-866 chrome guard passes in both themes.

Issues: none in the observable UI. The rate-limit exposure is recorded under Phase 2. A real user sees it as "Failed to load dashboards" after a burst of reloads or tab switches.

### Overall: FAIL

### Change Requests

1. **`frontend/src/features/dashboards/tabs/tabsBrowserTriggers.ts:26-50`: send at most one preferences PATCH per page leave.**
   - `visibilitychange`->hidden and `pagehide` both fire on a navigation, and `handlePageHidden` currently stamps and flushes on each.
   - Fix: make the second call a no-op when nothing changed since the first. For example, record the stamp of the hide that was just flushed, and skip the re-stamp and flush in `pagehide` if the document is already hidden and no other tab action has dispatched since. A simpler alternative is acceptable if it has the same effect.
   - Keep the design's guarantee: a real tab change made just before leaving must still be flushed with `keepalive`.
   - Add a unit test that fires `visibilitychange`(hidden) and then `pagehide`, and asserts exactly one `keepalive` fetch. It must be red on the current code.
2. **Decide and document, in `design.md` D7, whether the leave stamp applies off the dashboard view.**
   - Today leaving `/sources`, `/pipelines` or `/settings` stamps the active dashboard tab's `lastViewedAt` and PATCHes it, even though the dashboard was not on screen.
   - If the stamp is meant only for a dashboard actually being viewed, gate `handlePageHidden`'s `tabViewed` and flush on `isDashboardViewPath(location.pathname)`.
   - Either way, the request budget in item 3 must hold.
3. **Prove the gate.** Do not raise the rate limit or change the guard spec. Re-run `e2e/state-surface-contrast-guard.spec.ts -g overlays --repeat-each 5 --workers=2 --trace=on`, under the e2e lock.
   - Report the per-trace `/api` request count and the number of 429s.
   - Required: every run is green with **0** 429s, and the per-test count leaves clear headroom under 120 (it is 117-123 today).
   - Then re-run the full e2e suite and report its counts.

### Non-blocking Suggestions

- `hydrateTabs.ts:76` also suppresses the prune write when saved tabs were all pruned and no dashboard remains. The stale ids then stay in the server pref until the next dirty write. This is harmless, because they are pruned again on every load and auto-select still works, but it is worth a one-line comment.
- The duplicate PATCH also fires on every browser-tab switch (`visibilitychange`). Item 1 fixes that path as well.

### Critical Path

`CYCLE` (4) is past the default `EXECUTION_CYCLES` (3); this is an owner-approved extra cycle.
- **The one blocking issue** is Change Request 1: the duplicate hide/pagehide flush, together with the new per-load signals request, puts an existing CI guard test at the 120 requests/min/user rate limit, and it fails intermittently (2 of 10 locally, 429s in 6 of 10).
- Everything the orchestrator asked to verify holds:
  - the locators;
  - the hydration fix;
  - the contrast rungs;
  - the predicate fold;
  - the 143 pin;
  - the static gates and jest.
- **Recommendation for the human:** approve one more small executor pass limited to Change Requests 1-3. The fix is local to `tabsBrowserTriggers.ts` plus a test. Do not merge PR #1032 on a green re-run alone: the green full run the executor reported was luck at this boundary.
