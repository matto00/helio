## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Reviewed HEAD `d42a3936f1fe1bb208e0cc53f1e6ac46630b1c2b`. The review base was resolved live with `resolve-review-base.sh`: `cd64409ad`. origin/main is one commit ahead (`60086f02b`, HEL-1605), and `git merge-tree --write-tree HEAD origin/main` is clean. `frontend/src/app/hidesBreadcrumbItemName.ts` is still absent on origin/main, so the HEL-1578/HEL-1579 merge-order note still applies.

Durable evidence directory: `/home/matt/Development/helio/.concertino/runs/HEL-1575/evidence/skeptic-final-3/`. Every probe and screenshot cited below is in it. All browser work ran in my own launched Chromium. I did not use the shared MCP browser.

### What I verified (with evidence)

**Round-3 diff (`3d8287176..d42a3936f`), read in full.**
- `snapshotActiveTab` no longer dispatches `tabViewed`. It calls `captureTab(..., { retain: false, viewedAt: serverNowMs() })`.
- `buildWarmEntry` writes `max(saved stamp, viewedAt)` into the IndexedDB copy only.
- The heartbeat in `tabsBrowserTriggers.ts` and the debounced while-open listener in `dashboardTabsListeners.ts` both go through `snapshotActiveTab`, so neither can reach the D2 persist listener.
- These paths still write the server: tab leave, first arrival (`dashboardTabsListeners.ts:107-116`), hidden/pagehide with `keepalive` (`handlePageHidden`), and tab actions. That matches the owner's scope exactly.
- `hydrateTabs.boundedRestore` adopts the copy's `lastViewedAt` for the target only when the copy is later than the saved stamp **and** `applyWarmEntry` accepted it. The adopted stamp is not persisted: `persist: plan.dirty` is unchanged.

**The owner-required `clobber-probe.cjs` rerun.** The script was run unmodified from `skeptic-final-2/`, twice on each side, on ports 7007/9914.

| Code | Run | Server tab set after B saved 1 tab | Idle device A's PATCHes in 150 s |
| --- | --- | --- | --- |
| NEW `d42a3936f` | `clobber-new-run1.txt` | `["e690e243"]` at +30/60/90/120/150 s | 0 |
| NEW | `clobber-new-run2.txt` | `["e690e243"]` at every check | 0 |
| OLD `3d8287176` (throwaway worktree) | `clobber-old-run1.txt` | reverted to A's 5-tab set at +120 s | 1 (`08:12:24.215Z`) |
| OLD | `clobber-old-run2.txt` | reverted to A's 5-tab set at +120 s | 1 (`08:15:08.070Z`) |

- **How the old code was run.** I created a throwaway `git worktree add --detach` at `3d8287176` (`HEAD` confirmed as `3d828717600f…`) and started it with `start-servers.sh`.
- **Which code served each run.** `lsof` showed the 7007/9914 listeners' cwd under the throwaway worktree for the old runs and under the HEL-1575 worktree for the new runs.
- **Cleanup.** The throwaway servers were stopped with `stop-servers.sh`, the worktree was removed (`git worktree remove --force`, then `prune`), and it is gone from `git worktree list`.
- **Verdict on the probe.** It is a stable red on the old code and a stable green on the new code.

**Owner-scope unit test, red on the old code.**
- I copied the new `activeTabSnapshot.test.ts` and `hydrateTabs.test.ts` into the throwaway worktree (old product code) and ran them: 3 failed, 17 passed (`red-unit-oldcode.txt`).
- The key failure: "an idle, visible active tab sends 0 preferences PATCHes over 2x the heartbeat" received **2** `patchDashboardTabsRequest` calls, with stamps 60 s apart.
- The other two failures are the browser-copy-only stamp test and the stamp-adoption test.
- The same files pass on the new code (inside the full run below). This matches the executor's claim: 2 of 4 failures in `activeTabSnapshot` and 1 of 16 in `hydrateTabs`.

**Executor's two-device e2e claim.**
- `exec-final-2/e2e-two-device-RED.txt` shows B's set had 2 reverted tabs by +25 s, at this worktree's path `:681`.
- In my own run on the new code, `:652` passed (2.2 m).

**Heartbeat is live but local only, and adoption is real** (`adopt-probe.cjs`, `adopt-run1.txt`). The probe is non-vacuous: the initial load made 3 panel/rows requests.
- **IndexedDB stamp moves, server does not.** The copy's `lastViewedAt` went from `07:58:59.860Z` to `07:59:57.387Z` over 65 s of idling, with 0 PATCHes. So the heartbeat runs, and it writes only to IndexedDB.
- **Adoption makes the reload warm.**
  - Setup: A's preference PATCHes were blocked to simulate a lost keepalive, and every server stamp was aged to 60 minutes old.
  - Result: the reload made **0** panel/rows requests, the server stamp stayed aged, and the dot count was 0 before and 0 after.
- **Control: no copy means cold.** With the same aged stamps and IndexedDB `helio-warm` deleted, the reload made **3** requests (`/panels` plus 2 `/rows`).

**Adoption cannot surface stale data or a wrong dot (code).**
- **Content.** Adoption happens only after `applyWarmEntry` returns true. It still rejects content when `contentUpdatedAt > max(contentCapturedAt, ownWriteAt)`, and it drops any row window whose Output has `dataUpdatedAt > capturedAt`.
- **The heartbeat does not move the validity basis.** It never advances `contentCapturedAt`; `captureTab` keeps `max(prior, ownWriteAt)`.
- **Dot.** The adopted stamp touches only the target, which is the active tab and never shows a dot. The stamp is replaced by the leave-time stamp when the user switches away.
- **Ranking.** Adoption only moves the target's stamp forward, so it cannot push another tab out of the warm 8 by aging it.

**Round-1 fixes still hold.**
- **Warm reload of the never-left tab.** `pagehide-run1.txt`, the round-1 probe rerun: RUN 1 made `[]` requests after the reload, and the left-and-returned control also made `[]`.
- **Ask from /chat.** `ask-run1.txt`, the round-1 probe rerun:
  - from `/home`: 1 create POST;
  - already on `/chat`: 1 create POST, with `history.state.usr` null;
  - after a reload of `/chat`: 0 POSTs.
  - The e2e tests at `:922` and `:961` pass.

**Gates, re-run fresh on this head in this worktree.**

| Gate | Result |
| --- | --- |
| Full frontend jest (3 workers, nice 19) | 631/631 suites, 7481/7481 tests, 0 failed, exit 0 (`jest-full.json`). Its paths include `.../HEL-1575/frontend/src/features/dashboards/tabs/activeTabSnapshot.test.ts` and `hydrateTabs.test.ts` |
| lint, typecheck, format:check | all exit 0 (`static.txt`) |
| `e2e/hel1575-dashboard-tabs.spec.ts` (2 workers, 7007/9914) | **21 passed (2.9 m)**, 21 throwaway users deleted (`e2e-run.txt`) |

- **Backend.** `git diff 4adba1ebc..HEAD -- backend schemas` is empty. Round 2 ran the three backend specs (39 tests) on this unchanged backend, and round 1 verified C5 against NOBYPASSRLS. I did not re-run sbt.

**AC trace.**
- **AC1, tablist.** Checked in the live DOM (`shots-run.txt`):
  - `tablist` is labelled "Open dashboards" and uses `aria-selected`.
  - After ArrowRight, the roving tabindex moves (0 on the focused tab, -1 elsewhere) and focus lands on "Helio Roadmap (copy)".
  - The active tab carries `aria-controls`, and the tabpanel's `aria-labelledby` points to the active tab.
  - The mouse and keyboard e2e passes.
- **AC2, survives reload and a second device.**
  - The e2e passes and the backend is unchanged.
  - The two-device clobber is now fixed: the probe table above, and the e2e at `:652`.
- **AC3, warm switch makes no refetch.** The e2e tests for warm/expired switching pass, and the adoption probe shows 0 requests warm against 3 cold.
- **AC4, TTL and timings recorded.** `measurements.md` records a 15 min TTL, a warm median of 297 ms and a cold median of 615 ms. It still has to be copied into the PR.
- **AC5, palette ask.** In both themes the palette lists `Ask the assistant: "revenue trend"` under an "Ask" group (`*-1280-palette-ask.png`).

**Owner rulings and constraints.**
- **Rulings 1 to 4 and C1 to C5, C7.** These are unchanged from round 2's verification except for the heartbeat. The heartbeat now meets the owner's revised scope. C1's warm-copy rules are unchanged: `clearAuth` handling, the per-user build guard and the size bound are untouched by this diff.
- **C6.** `workflow-state.md` `CONSTRAINTS` has no C6. The list is C1 to C5 plus C7, so there is nothing to check.

**Visuals (screenshots taken and looked at).**
- Screenshots: `light|dark-1280.png`, `-1280-tabbar-zoom.png`, `-1280-tab-focus.png`, `-820.png`, `-768.png`, `-375.png`, `-1280-palette-ask.png`.
- Each one matches round 2's accepted state:
  - The active tab's raised surface has its accent top edge and no hairline under it.
  - The accent appears only on the active top edge and the focus ring, and the focus ring is closed and visible in both themes.
  - At 820 the search box collapses to the icon plus the shortcut keys.
  - At 768 and 375 the phone shell shows no strip.
  - Light/dark parity holds.
- No UI file changed this round.
- **Not this ticket:** the near-black "SkepticOrders" card in the light screenshots is that panel's own stored appearance, seen when the theme is forced through `dataset.theme`. The round-2 light shot shows the same thing with a different dev dashboard, and no panel-card file is in this change's diff.

**Console.**
- The two 401s are `GET /api/auth/me` before login.
- One run showed a 502, matching vite's `http proxy error ... /run-events ECONNRESET` when a context closed with an SSE stream open. It did not reproduce in `s502.txt`. It is a teardown artifact.

### Verdict: CONFIRM

### Non-blocking notes

- **A hide event still writes the device's whole in-memory set.** This is by the owner's scope, but worth knowing:
  - `visibilitychange`→hidden (a browser-tab switch, minimising, and on many platforms locking the screen) runs `handlePageHidden`, which PATCHes the device's in-memory tab set with `keepalive`.
  - On becoming visible again, a device refreshes only the change signals, never the saved tab set.
  - So a stale device that is hidden after another device's edit still reverts that edit once, as does any explicit action on it.
  - This is the accepted last-write-wins on user and lifecycle events, and it is no longer a continuous writer. A follow-up could re-read `dashboardTabs` on visible, or send a conditional write.
- **Round-2 notes still stand:**
  - At 820 the active tab's close "x" can sit past the strip edge on a fresh load: `scrollIntoView` targets the label button.
  - The tabpanel sits on a `display: contents` element.
- **Merge order.** Whichever of HEL-1578/HEL-1579 merges second must fold `hideDashboardBreadcrumb` into `app/hidesBreadcrumbItemName.ts`.
- **The PR body needs** the TTL (15 min), the warm/cold medians (297/615 ms), the C7 behaviour-change callout, and a line that the idle heartbeat is local-only. AC4 is not complete until that PR exists.
- **No evaluator report covers `d42a3936f`**: `evaluation-3.md` predates it. I re-ran the frontend gates and the e2e myself, as listed above.
- **Gate defect check (CON-160):** no evidence used here relies on mtime ordering. The red/green pairs are content-based: commit SHAs, server tab-set contents and request counts.

### Residue

- Each probe restored the dev user's original `dashboardTabs` (`restored 200`), and the e2e deleted its 21 throwaway users.
- The `ask-probe` create POSTs were route-fulfilled with 500, so no conversations were created.
- The throwaway worktree has been removed.
- The HEL-1575 worktree and the main checkout `git status` are clean.
- The servers are stopped (`STOPPED ports=7007,9914`).
