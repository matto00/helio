## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `804d4f6036…` (`804d4f603`), one commit on top of the cycle-1 head `dade51b70`. The review base, resolved live, is still `cd64409ad`. The cycle-2 diff touches 17 files and no `backend/` path, so `sbt testFull` was not re-run. The cycle-1 run (8145 tests, 0 failed) still covers the backend.

### Gates (fresh runs, this worktree)

| Gate | Result |
| --- | --- |
| `npm run lint` / `format:check` / `typecheck` | exit 0 / exit 0 / exit 0 |
| `npm test` (3 workers, nice 19) | helio-mcp 51 suites / 469 tests; frontend 629 suites / 7469 tests (5 more than cycle 1), exit 0 |
| `npm --prefix frontend run build` | exit 0 |
| `check:tokens`, `check:openspec`, `check:schemas` | exit 0 (check:tokens names this worktree's `frontend/src`) |
| `e2e/hel1575-dashboard-tabs.spec.ts` (2 workers, nice 19, run from this worktree, `start-servers.sh` 7007/9914) | 17 passed (1.1m); teardown deleted 17 throwaway users; dev DB `hel1575%` users = 0 afterwards |

Mutations, run in a throwaway detached worktree at `804d4f603` and removed afterwards:

| Mutation | Result |
| --- | --- |
| Remove `if (!warm) expireTab(dashboardId)` from `showDashboardPanels.ts` | "after the TTL the tab's held rows are void too" fails, 1 of 19. The red-first claim is confirmed |
| Remove the tablist `onBlur` reset | "returns the tab stop to the active tab once focus leaves the tablist" fails, 1 of 15 |
| Revert `sweepWarm`'s `expireTab` to `releaseTab` | **All 195 tabs tests still pass.** The sweep half of the fix has no unit guard (non-blocking, see below) |

Rendered-file rule: no `scripts/concertino/**`, `.concertino/laws/**` or `.claude/**` path is in the diff, and `scripts/concertino` is identical to the main checkout's render.

### Phase 1: Spec Review — PASS

- **CR4 (dot colour).** The dot is now `--app-text`. `ui-decisions.md` and DESIGN.md §9 state the Yellow-preset reason accurately. Measured live: the dot is rgb(242, 239, 233) in dark, which no accent preset is near.
- **The extra defect fix.** "Expired tab refetches ... and rows" is now asserted in the e2e (a rows request after expiry) and implemented by `expireTab`. The record in `evidence-red-first.md` agrees with my mutation result.
- **e2e: "A run refreshes a warm panel ... shows the new data".** The test now adds a source row ("North", 70) and asserts the new cell is visible.

Issues: the CR2 rationale in `ui-decisions.md` (cycle-2 section) is factually wrong. It is folded into Change Request 1.

### Phase 2: Code Review — PASS

- **CR3 (casts).**
  - `main.tsx` now calls `startTabsBrowserTriggers(store)` with no cast.
  - `StoreLike.dispatch` is `AppDispatch`.
  - `hydrateTabs.ts` takes `Dispatch<UnknownAction>` with no cast.
  - `warmListeners.ts:169` keeps one cast, with a comment justifying it and pointing to the test table that covers each shape. Accepted.
- **CR1 (focus ring) code.** `.dashboard-tab__button:focus-visible { outline-offset: -2px; }`, guarded by `DashboardTabBar.css.test.ts`.
- **`expireTab` is correct.** It bumps the generation of each retained Output before releasing, so the 30 s remount grace can no longer serve held rows past the TTL.
  - Cost: `invalidateOutput` notifies no mounted card (`outputFreshness.ts:47-50` only bumps counters), so the expiry triggers no requests by itself.
  - One side effect: an Output shared with another *warm* tab loses its row reuse there too, so that tab refetches its rows on return. This is safe; it makes nothing stale.
- **Roving tab stop.** It resets on the tablist's `onBlur` when focus leaves the tablist, and that path is tested.

### Phase 3: UI Review — FAIL

The live probe ran against `:7007` signed in as `matt@helio.dev`. It used Playwright Chromium with `hasTouch: true`, under which `matchMedia("(pointer: coarse)")` is true, and bisected `elementFromPoint` at 0.25px steps. The script and its output are at `/home/matt/Development/helio/.concertino/runs/HEL-1575/evidence/evaluation-2/close-hit-region-probe.cjs` and `close-hit-region-probe.json`.

- **Focus ring (CR1): fixed.** `outline-offset` is -2px, `:focus-visible` matches, and the ring is closed on all four sides (`/home/matt/Development/helio/.concertino/runs/HEL-1575/evidence/evaluation-2/dark-1280-tab-focus-c2.png`).
- **Close control (CR2): the expander leaks into the next tab.**
  - Base size is now 24px, and the 44px expander is present: the hit width is 44.75px.
  - But on **every adjacent pair of tabs** the expander reaches **2px into the next tab**.
  - Example: close box 488-512, own tab's right edge 520, next tab starts at 520, hit region runs 477.25-521.75.
  - `elementFromPoint(nextTab.left + 0.5)` returns the **previous tab's close button**.
  - The same result holds at x=727 and x=904.
- **Changed dot:** neutral `--app-text`, rendered (see the screenshot above).
- **Breakpoints and console:** this cycle changed only the bar's CSS. 768/375 render no strip (the cycle-1 checks stand), and no console errors came from the flows exercised by the probe or the e2e.

### Overall: FAIL

### Change Requests

1. **A tap on a tab's left edge closes the previous tab** (`DashboardTabBar.css`, `@media (pointer: coarse)` block; DESIGN.md §3 "Expander tiling", [mechanical]).
   - **Cause.** The expander extends `(44 - 24) / 2 = 10px` per side. The close has only `margin-right: var(--space-2)`, which is 8px. Tabs abut with no gap, so 2px of every following tab's left padding is captured by the previous tab's close. Measured live, as above.
   - **Why it matters.** A touch user tapping a tab's left edge closes the neighbouring tab instead of activating the tab they touched. That is a destructive mis-tap.
   - **The rationale is wrong.** The new comment in `DashboardTabBar.css` and `ui-decisions.md` (cycle-2 section, "Close control size and touch floor") both say the expander "ends at its own tab's right edge (the 8px margin)". That holds only for a 28px box.
   - **Fix.** Pick one:
     - restore `width/height: var(--control-sm)` (28px) on `.dashboard-tab__close` inside the coarse block, so the expander extends exactly 8px and tiles against the 8px margin (the 24px base stays for fine pointers); or
     - give the close a 10px right margin under coarse pointers (`calc(var(--space-2) + 2px)`).
   - **Correct the text.** Fix the CSS comment and the `ui-decisions.md` sentence.
   - **Test.** The new `expectTapExpander` check cannot see this (DESIGN.md §3: "box-vs-box ... cannot detect this"). Add a CSS-source assertion that the close's coarse size and margin satisfy `(44 - size) / 2 <= margin-right`. Alternatively, add an e2e with `hasTouch: true` that asserts `elementFromPoint(nextTab.left + 0.5, y)` is inside the next tab. The probe script above is a ready template.

### Non-blocking Suggestions

- **The sweep half of the expiry fix has no unit test.** Reverting `sweepWarm`'s `expireTab` back to `releaseTab` leaves all 195 tabs tests green. Add a `warmCache` test: retain a tab, sweep with `isWarmTab` false, and assert that `currentGeneration` advanced.
- **Shared Outputs lose reuse on expiry.** `expireTab` invalidating an Output that another still-warm tab also binds costs that tab its row reuse. Worth one line in the PR's warm-cache notes.
- **Servers.** I stopped them with `stop-servers.sh` (`STOPPED ports=7007,9914`).
