## Evaluation Report — Cycle 5 (evaluation-5.md)

This cycle is owner-approved fix cycle 2. I reviewed head `e07eaaa5ca5621552c2eecbe9faa854f5202dd3a`; the worktree was clean. The review base, resolved live, is `7fd2f4f29` (= `origin/main`), and `origin/main` is an ancestor of HEAD. The scope is commit `e07eaaa5c`, which answers evaluation-4 Change Requests 1-3.

Spawn guard: `READY ambient=/home/matt/Development/helio branch=feature/persistent-dashboard-tabs-palette/HEL-1575`.

Transcripts are in `/home/matt/Development/helio/.concertino/scratch/HEL-1575/eval5/`, called `eval5/` below. Each one starts with this worktree's path and HEAD sha. The DB is the shared `helio` (flyway `max(version)=135`, 135 rows). The backend (`backend/.env`) and Playwright both used the same `DATABASE_URL`.

### Phase 1: Spec Review — FAIL

**CR1 (at most one PATCH per leave): met.**
- `tabsBrowserTriggers.ts:68-72` handles a leave once. `left` is re-armed on visible and on `pageshow`.
- The leave stamp is skipped when the stored stamp is less than 5 min old (`:47-51`).
- `flushTabsWrite({ keepalive: true })` is still called on every leave from any page (`:55`), so a real pending tab change is still flushed. The unit test "still flushes a pending real tab change off the dashboard view, once" pins this.
- Live, every overlays trace shows `prefPATCH=1` (see CR3).

**CR2 (decide D7): met.**
- `design.md` D7 records that the leave stamp applies only on the dashboard view.
- The code gates the stamp and the capture on `isDashboardViewPath` (`:46`). Mutant E below shows a test catches removing that gate.

**CR3 (prove the gate): met.**
- Command: `flock e2e.lock nice -n 19 npx playwright test e2e/state-surface-contrast-guard.spec.ts -g overlays --repeat-each 5 --workers=2 --trace=on`. Result: **10 passed**, light and dark x5, exit 0. Load was 6.5 at start and 6.0 at end (`eval5/overlays.txt`).
- I counted `/api` requests per trace (`eval5/api-counts.txt`):
  - all requests: 102, 103, 102, 102, 103 (dark) and 104, 102, 103, 103, 102 (light);
  - `dashboard-changes`: 10-11 per run;
  - preferences PATCH: 1 per run;
  - **HTTP 429s: 0 in all 10 runs.**
- That is 16-18 requests under the 120 limit, against 117-123 in cycle 4. This matches the executor's 102-103.
- Counting method: the raw resource snapshots from both trace contexts. Same-millisecond duplicates are real requests (dev StrictMode double fetches), so they are counted. Deduplicating them gives 80-88, which would understate the load.

**Red-first: confirmed independently.**
- I made a throwaway detached worktree at e07eaaa5c and replaced `tabsBrowserTriggers.ts` with the b91b45476 version plus the 2 exported constants.
- On that tree, `tabsBrowserTriggers.test.ts` gives **5 failed / 8 passed** (`eval5/red-repro.txt`), which matches `red-run-fix2.txt`.

**`/api/dashboard-changes` limits: confirmed.**
- The visible and 2-minute refreshes fire only on the dashboard view, and the visible refresh at most once per 30 s.
- Mutant C (view gate removed) and mutant D (30 s gap removed) each turn the burst test red (`eval5/mutants.txt`).

**Regressions on the listed behaviours** (full e2e green; details in Phase 2):
- warm reload (C1): "reload within the TTL is warm" and "reload of the only, never-left dashboard is warm";
- the changed dot (C4): "a run while the tab is away marks it with a dot", "own edit, leave, then a run", "another user's edit would mark";
- two devices: "an idle, visible device never overwrites the tab set another device saved (125 s idle)";
- other-device restore: "a second context restores the tabs".

All of these pass. **One C1 regression is not covered by any test** (the issue below).

**Issue 1: C1 regression. A page leave now pushes the browser copy's `lastViewedAt` back by up to 5 minutes, so warm survives a reload for 10-15 min instead of 15.**
- `handlePageHidden` (`tabsBrowserTriggers.ts:53`) calls `captureTab(store.getState, activeId, { retain: false, immediate: true })` with no `viewedAt`.
- `buildWarmEntry` then writes `lastViewedAt = laterOf(<store tab stamp>, null)`, which is just the store stamp (`warmCapture.ts:79,115`).
- `boundedWarmStore.write` does a plain `put` (`boundedWarmStore.ts:50`). It replaces the entry, including the fresher stamp the 60 s heartbeat had written (`activeTabSnapshot.ts:43` passes `viewedAt: serverNowMs()`).
- Before this commit the leave first dispatched `tabViewed(now)`, so the copy always held "now". Now the re-stamp is skipped whenever the store stamp is less than 5 min old, so the copy is written back to that older stamp.
- Probe (`eval5/probe-leave-copy-stamp.txt`; a scratch test in a throwaway worktree, since removed): store stamp 4 min old, leave on `/home`. Result: `captureTab options: {"retain":false,"immediate":true}`, copy `lastViewedAt` age **240003 ms**.
- `hydrateTabs.ts:98-100` uses the copy's stamp for the TTL check. Example: view a dashboard for 4 min, close the tab, reopen it 11.5 min later. The last view was 11.5 min ago, under the 15-minute TTL, but the copy says 15.5 min, so the dashboard loads cold.
- C1 (binding) says warm "surviv[es] reload within 15 min TTL". D7 now calls this an accepted trade-off ("shortens it by at most 5") and labels the section "owner-approved". Evaluation-4's CRs did not ask for any TTL change, and I found no owner ruling for it.
- The shortening is also unnecessary. The browser copy's stamp costs no request, so it can be fresh on every leave without any extra PATCH.

### Phase 2: Code Review — PASS (gates); the code finding is under Phase 1, Issue 1

**Gates, run fresh on e07eaaa5c:**

| gate | result | transcript |
| --- | --- | --- |
| `npm run lint` | exit 0 | `eval5/static.txt` |
| `npm run typecheck` | exit 0 | `eval5/static.txt` |
| `npm run format:check` | exit 0 | `eval5/static.txt` |
| `npm --prefix frontend run build` | exit 0 (`precache 41 entries`) | `eval5/static.txt` |
| `HELIO_JEST_MAX_WORKERS=2 nice -n 19 npm test` | exit 0: root 55 suites / 485 tests; frontend 641 / 7640 | `eval5/jest.txt` |
| overlays `--repeat-each 5`, under the lock | 10 passed, 0 429s, 102-104 `/api` per run | `eval5/overlays.txt`, `eval5/api-counts.txt` |
| full e2e: `flock e2e.lock nice -n 19 npx playwright test --workers=2` | **exit 0: 333 passed, 1 skipped** (opt-in `hel1575-switch-measurement`), 20.9 min; load 6.6 at start, 4.9 at end | `eval5/e2e-full.txt` |
| `flock sbtfull.lock nice -n 19 sbt -J-Xmx3g testFull` | **exit 0: `Tests: succeeded 8162, failed 0, canceled 4`** (the 4 cancelled are opt-in `HELIO_MEASURE` / timing measurements). Load 6.1 at start | `eval5/sbt.txt` |

The first `sbt` attempt failed to bind sbt's boot socket because the dev server's `sbt run` was live in the same `backend/` (`eval5/sbt-attempt1-socket-conflict.txt`). This is environmental. I re-ran after `stop-servers.sh`, and that run is the one in the table.

**Mutation checks** (`eval5/mutants.txt`, throwaway worktree):

| mutant | result |
| --- | --- |
| A: `left` dedupe removed | 13/13 pass (not caught; see suggestions) |
| B: 5-minute skip removed | 1 red |
| C: refresh view gate removed | 1 red |
| D: 30 s gap removed | 1 red |
| E: leave-stamp view gate removed | 1 red |

**Review:**
- **Token and design rules:** this cycle has no CSS or UI markup change.
- **Imports:** clean, and there are no inline FQNs.
- **Types:** no escape hatches in product code. The test's `as never` casts follow the existing pattern in the file.
- **Dead code:** none.
- **Readability:** the constants are named and documented (`LEAVE_STAMP_REFRESH_MS`, `SIGNALS_VISIBLE_MIN_GAP_MS`).
- The C1 finding is recorded once, as Phase 1 Issue 1, and repeated as Change Request 1.

### Phase 3: UI Review — PASS

I started the servers with `start-servers.sh ... 7007 9914 HEL-1575` (`PASS servers`) and stopped them with `stop-servers.sh` (`STOPPED ports=7007,9914`).
- This cycle's change is behavioural, with no visual change. It is covered by the full e2e run on port 7007, including every `hel1575-dashboard-tabs.spec.ts` test: tabs, palette, warm and dot, two devices, assistant handoff, and breakpoints/touch.
- The HEL-866 chrome and overlay guards pass in both themes.
- No new UI states were introduced.

### Overall: FAIL

### Change Requests

1. **`frontend/src/features/dashboards/tabs/tabsBrowserTriggers.ts:53`: keep the browser copy's stamp fresh on every leave.** This restores C1's full 15-minute TTL and needs no extra PATCH.
   - Change the call to `captureTab(store.getState, activeId, { retain: false, immediate: true, viewedAt: serverNowMs() })`. This uses the same mechanism as the D5 heartbeat (`activeTabSnapshot.ts:43`). The server-pref re-stamp stays throttled by `LEAVE_STAMP_REFRESH_MS`.
   - Add a unit test that is red on e07eaaa5c. Store stamp 4 min old, leave on `/home`, then assert that the captured copy's `lastViewedAt` is within a few seconds of now. Asserting the `captureTab` `viewedAt` option, or the `buildWarmEntry` output, is enough.
   - Update `design.md` D7: drop "shortens it by at most 5" and state that the browser copy is stamped "now" on every leave, while only the server stamp is throttled.
   - Re-run jest. The full e2e is not required for this one-line change unless the executor touches more.

### Non-blocking Suggestions

- The `left` dedupe (`:66-72`) is not failable by any test. Mutant A leaves 13/13 green, because the 5-minute skip already makes the second event's flush a no-op.
  - It still prevents a second `captureTab` (IndexedDB write) per leave.
  - Either pin it, for example by asserting one `captureTab` call per hidden+pagehide, or drop it as redundant.
- `lastRefreshAt` is set only by this module's `refresh`, not by the hydrate refresh (`hydrateTabs.ts:155/183`). So the first `visibilitychange`->visible after a load can refresh again within 30 s. This is minor, at most one extra request.
- Returning to the dashboard view by SPA navigation after a long stay on `/sources` does not refresh the signals immediately; the next 2-minute tick does. This is acceptable under D7 as written. A refresh on entering the route would make the dot current at once.

### Critical Path

`CYCLE` 5 is past the default `EXECUTION_CYCLES` of 3; this is an owner-approved extra cycle.
- **Everything evaluation-4 asked for is met and independently verified:**
  - one PATCH per leave;
  - red-first reproduced (5/13);
  - overlays 10/10 green with 0 429s at 102-104 requests;
  - full e2e 333/0;
  - jest, the static gates and `sbt testFull` (8162/0) all green.
- **The only blocker** is Change Request 1. The new 5-minute stamp throttle also rewinds the browser copy's stamp, which quietly shortens C1's binding 15-minute warm TTL to as little as 10 minutes. The fix is a single `viewedAt: serverNowMs()` argument plus one red-first unit test.
- **Recommendation for the human:** approve one more minimal executor pass limited to Change Request 1. Alternatively, if you are content with a 10-15 minute effective TTL, record an explicit owner ruling amending C1. The PR could then merge on this head, since every gate is green.
