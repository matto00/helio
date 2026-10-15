## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `3d828717600fd4c9755d0a1437abc699a047d910`. The review base was resolved live with `resolve-review-base.sh`: `cd64409ad`. origin/main is one commit ahead (`60086f02b`, HEL-1605), and `git merge-tree --write-tree HEAD origin/main` is clean. Neither HEL-1578 nor HEL-1579 has merged: `frontend/src/app/hidesBreadcrumbItemName.ts` does not exist on origin/main. The `hideDashboardBreadcrumb` merge-order note from round 1 still applies to whichever branch merges second.

Durable evidence directory: `/home/matt/Development/helio/.concertino/runs/HEL-1575/evidence/skeptic-final-2/`. It holds the probe scripts, their raw output, the e2e transcript and the screenshots.

### What I verified (with evidence)

**Gates, re-run fresh in this worktree:**

| Gate | Result |
| --- | --- |
| Frontend lint, typecheck, format:check | exit 0 for each |
| Full frontend jest (3 workers, nice 19, `--json`) | 631 suites, 7480 of 7480 passed, 0 failed, exit 0 |
| Backend `UserPreferencesRoutesSpec`, `DashboardChangesRoutesSpec`, `AuthServiceSpec` (run from `.../HEL-1575/backend`) | 3 suites, 39 tests passed |
| `e2e/hel1575-dashboard-tabs.spec.ts` (2 workers, servers on 7007/9914) | 20 passed (1.4m), 20 throwaway users deleted |

- The jest result paths include `.../HEL-1575/frontend/src/features/dashboards/tabs/activeTabSnapshot.test.ts` and `.../assistant/ui/ChatPage.autoSend.test.tsx`.
- The backend has not changed since round 1: `git diff 4adba1ebc..HEAD -- backend` is empty.
- The e2e transcript is in `e2e-run-skeptic.txt`.

**Round-1 CR1 (cold reload of the active, never-left tab): fixed.** I re-ran `pagehide-probe.cjs` from round 1 twice.
- Both runs: "RUN 1 (active tab only, never left) panel/rows requests after reload: []".
- The IndexedDB copy existed before the reload, and its `lastViewedAt` advanced across the reload.
- The new e2e at `:629` passes.
- Red-first is recorded in `red-run-final1.txt`: 0 entries after 15 s with the fix stashed.

**Round-1 CR2 (Ask from /chat): fixed.** I re-ran `ask-probe.cjs` twice. In both runs:
- **A:** asking from the dashboard view made 1 create POST.
- **B:** asking while already on `/chat` made 1 create POST, and `history.state.usr` was null.
- **C:** a reload of `/chat` made 0 POSTs.

**C1, logout.** `logout-probe.cjs` switches tab and signs out after 0, 700, 1300, 1600 and 3000 ms, so it straddles the 1.5 s snapshot debounce.
- At every delay, 6 s after sign-out: IndexedDB `helio-warm` does not exist, and no preferences, panels or rows request is made (`logout-run1.txt`).
- By code: `clearAuth` resets `dashboardTabs` to its initial state, so `activeTabIsLoaded` is false and both the heartbeat and the snapshot are no-ops. `captureTab`'s `build()` also returns null on a user mismatch.
- C1 holds.

**C2, C4, C5 and C7.** These are unchanged since round 1, which verified C5 against NOBYPASSRLS and C7 by mutation. The round-2 diff does not touch the slice, the backend, `PanelGrid` or `usePanelUpdatesFlush`, and the full suite passes. The dot selector is unchanged. The new stamp only moves `lastViewedAt` forward on the active tab and leaves `ownWriteAt` and the signals alone (`activeTabSnapshot.test.ts` case 5).

**AC trace.**
- **AC1, tablist.** Checked in the live DOM (`palette.cjs` output):
  - `role=tablist` is labelled "Open dashboards".
  - Selection uses `aria-selected`, with a roving tabindex: 0 on the active tab, -1 on the others.
  - The active tab has `aria-controls="dashboard-tabpanel"`, and the tabpanel's `aria-labelledby` points to the active tab.
  - ArrowRight moves a visible, closed focus ring (`light-1280-tab-focus.png`, `dark-1280-tab-focus.png`).
  - The mouse and keyboard e2e (`:324`) passes.
- **AC2.** Covered by the e2e and the backend specs, but see CR1 below.
- **AC3.** Covered by the e2e `:533` and `:585`.
- **AC4.** `measurements.md` records the TTL (15 min), the warm median of 297 ms and the cold median of 615 ms. It still has to be copied into the PR.
- **AC5.** In both themes, the palette offers `Ask the assistant: "revenue trend"` under an "Ask" group (`*-1280-palette-ask.png`).

**Design (screenshots I took and looked at).**
- **Hairline:** gone in both themes.
  - `light-1280-tabbar-zoom.png` and `dark-1280-tabbar-zoom.png` are taken at 3x. The active tab's raised surface flows into the command bar with no line, while inactive tabs keep the bar border.
  - In the live DOM, the active tab's bottom is 49 and the bar's border-box bottom is also 49; the active tab is 41px high against 40px for inactive tabs.
  - Labels sit on one baseline.
- **Accent:** the accent appears only on the active tab's top edge and the focus ring.
- **820:** the search box collapses to the icon plus the shortcut keys.
- **768 and 375:** the phone shell shows no strip.
- **Both themes are consistent with round 1's accepted judgement**, including the neutral dot.
- **Note on the shared browser:** the shared Playwright MCP browser was taken over mid-check by another lane's session on port 7011. I discarded that screenshot and took every later capture in my own Chromium (`shots.cjs`, `palette.cjs`).

### Regression found in the new heartbeat: an idle device overwrites the other device's tab set every minute

**Probe:** `clobber-probe.cjs`, reproduced twice (`clobber-run1.txt`, `clobber-run2.txt`).
- Device A (a browser context) signs in as the dev user and sits idle and visible on a dashboard.
- Device B (an API request context, same user) saves a different tab set via `PATCH /api/users/me/preferences`: it keeps only the first tab, as if the user had closed the others on B.

**Result in both runs:**
- At t+30s, the server holds B's set: `["e690e243"]`.
- Between t+30s and t+60s, A sends its first heartbeat PATCH and the server reverts to A's stale 5-tab set. Each later minute brings another PATCH.
- A's PATCH times are exactly 60 s apart: `07:21:19.043Z` and `07:22:19.042Z` in run 1, `07:25:53.693Z` and `07:26:53.689Z` in run 2. That interval matches `ACTIVE_HEARTBEAT_INTERVAL_MS`.

**Cause:** `tabsBrowserTriggers.ts` (added in `3d8287176`) calls `snapshotActiveTab` every 60 s while the page is visible.
- `snapshotActiveTab` (`activeTabSnapshot.ts:49-51`) dispatches `tabViewed` whenever 60 s have passed since the last stamp.
- The D2 persistence listener (`dashboardTabsListeners.ts`, "persist every change to the tab set") turns that into a whole-key `dashboardTabs` PATCH of the device's in-memory set.
- The same applies to the debounced post-refresh snapshot at most once a minute.

**Before this commit, an idle session never wrote.** The only paths to `tabViewed` were a tab leave, a first arrival and hide/pagehide, and `flushTabsWrite` sends nothing when nothing is pending.

**Why the accepted last-write-wins does not cover this:** design.md accepts last-write-wins on the whole key (lines 29, 63, 263). That trade-off assumed writes are user actions. The heartbeat makes every open, visible session a continuous writer, so with two sessions open the one the user is not touching wins within 60 s. Examples are a desktop beside a laptop, or a dashboard left up on a wall display, which is a natural use of this product.
- **AC2** ("the tab set and order survive … a sign-in on a second device") then fails in that configuration. The tabs opened, closed or reordered on the second device are reverted server-side, and its next reload shows the idle device's set.
- **Last-viewed stamps:** the second device's stamps are reverted too, so tabs it viewed can show the dot again after a reload (C4).

**PATCH volume while sitting on one tab:** one preferences PATCH per minute per visible session, indefinitely. That stays well inside the rate limit, but it is a steady `users` row write and the root of the overwrite above.

**Dot rule:** apart from the overwrite, stamping the active tab while it is open is semantically right. The user is seeing it, the stamp only moves forward, and it never touches `ownWriteAt` or the signals.

### Verdict: REFUTE

### Change Requests

1. **Stop the while-open snapshot paths from writing the server tab set.** The paths are the 60 s heartbeat in `tabsBrowserTriggers.ts` and the debounced snapshot in `dashboardTabsListeners.ts`, both through `activeTabSnapshot.ts:49-51`.
   - **What to change.** The active tab's browser copy should carry a local "seen now" instant, for example an override passed into `captureTab`/`buildWarmEntry` for the IndexedDB entry's `lastViewedAt`. It should not dispatch the server-persisted `tabViewed`.
   - **What stays.** The server-side stamp stays on the existing user-driven and lifecycle paths: tab leave, first arrival, and hide/pagehide with the `keepalive` fetch. The keepalive fetch does survive unload; only the IndexedDB write did not.
   - **What this keeps.** The round-1 fix (a warm reload of the never-left tab, with the TTL running from when the user last saw it) is kept, and an idle device makes no writes.
   - **Tests to add.**
     - A unit test: a hydrated, visible active tab advanced by more than 2 × `ACTIVE_HEARTBEAT_INTERVAL_MS` with no user action makes 0 `patchDashboardTabsRequest` calls, while the IndexedDB entry's `lastViewedAt` still advances.
     - Optionally, an e2e mirroring `clobber-probe.cjs`: B's saved set is still on the server after A has idled for 90 s.
   - **If the executor believes the server stamp while open is required:** it must say which AC or ruling requires it. It should then also explain how that coexists with AC2 when two sessions are open. Without that, this is the fix.

### Non-blocking notes

- **Active tab not fully in view on a fresh load at 820px** (`inview.cjs`). The strip spans 316 to 631 and the active tab 471 to 663, so its close "x" is hidden. Cause: `DashboardTabBar.tsx:129-134` scrolls the `[data-tab-id]` element into view, and that element is the label button, not the whole tab including its close. After clicking or activating by keyboard, the tab is fully in view. Ruling 2's "active tab kept in view" is met for the label. Polish.
- **Tabpanel with `display: contents`.** The tabpanel still sits on a `display: contents` element (live DOM). Round 1's assistive-technology caveat stands.
- **Merge order with HEL-1578/HEL-1579.** Neither has merged. Whichever merges second must fold `hideDashboardBreadcrumb` into `app/hidesBreadcrumbItemName.ts` rather than keep a parallel prop.
- **AC4 is not done until the PR exists.** The TTL and the warm and cold switch times must be copied from `measurements.md` into the PR body, alongside the C7 behaviour-change callout.
- **No evaluator pass on this head.** `evaluation-3.md` predates `3d8287176`, so no evaluator report covers this head. I re-ran every gate myself, as listed above.

### Residue

- The worktree and the main checkout `git status` are clean.
- The dev DB has 0 `hel1575%` users, and the dev user has 0 assistant conversations from the last 40 minutes.
- The probes changed the dev user's active tab, and the clobber probe restored its original set. I re-set the active tab to `e690e243`, the round-1 state, and confirmed it in the DB.
- The servers were stopped with `stop-servers.sh` (`STOPPED ports=7007,9914`).
