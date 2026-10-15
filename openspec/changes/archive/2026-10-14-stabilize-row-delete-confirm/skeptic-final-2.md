## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed head: `27e76ad063b62ebf4d9f0821ee7e16b1e7f4e4a2`. Base resolved live with `resolve-review-base.sh`: `cd64409ad828d9024074f907a7ea32800ab71ff3` (exit 0). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/overview-row-delete-confirm/HEL-1605`.

Evidence prefix used below: `EV=/home/matt/Development/helio/.concertino/runs/HEL-1605/evidence/openspec/changes/stabilize-row-delete-confirm/skeptic-final-evidence-2/`. Each file listed below was persisted with `persist-evidence.sh` and returned `READY`.

### What I verified (with evidence)

**Ground truth**
- I read `git diff cd64409ad...HEAD`, which covers 32 files, and the full `useNow.ts` and `rowDeleteFocus.ts`. I also read the call sites in both tables and both pages, the `ConfirmInline` guard, `formatRelativeTime`, `App.css`, both e2e specs, `e2e/support/rowDeleteGesture.ts` and the spec delta.
- The only source change in cycle 3 (`27e76ad06`) is `useNow.ts`. `subscribe` and `getSnapshot` are now created once per interval and cached on the ticker object. The commit also adds one unit case and changes the I8/I14 precondition to use the confirm row's height.

**Round-1 CR1 (useNow resubscribes on every render) is fixed: unit level**
- I copied `e04ddb348:frontend/src/hooks/useNow.ts` (the old code) and the new `useNow.test.ts` into a scratch directory and ran jest there. The worktree was not touched.
  - Old code: `Tests: 1 failed, 4 passed, 5 total`, with `Expected: 1767225660000 / Received: 1767225600000`.
  - New code: `Tests: 5 passed, 5 total`.
  - So the new case really is red first, and it exercises the resubscribe path.
- I read the code to confirm the mechanism. `useSyncExternalStore(subscribe, getSnapshot)` now receives identities that stay stable per `intervalMs`, so a re-render no longer tears the interval down. Under StrictMode the mount runs subscribe, unsubscribe, subscribe once; that only restarts the interval at mount.
- Related jest suites in this worktree (`--json`): 12 suites, 107 tests passed, 0 failed. Every path is under `.../HEL-1605/frontend/src/`. Per-suite counts: useNow 5, rowDeleteFocus 19, ConfirmInline 7, formatRelativeTime 3, and the four Page/Table suites 3–14 each.
- eslint on the changed files: exit 0. `npm run typecheck`: exit 0. `prettier --check` on the e2e and helper files and `useNow.ts`: clean.

**Round-1 CR1: live, with the label ticking while I interact** (`EV/tick.log`, `EV/tick.spec.ts`)
- Setup: a real wall clock (no fake clock), rows created at t0, and a Delete click followed by Cancel every 20s (each one re-renders the table), for 200s.
- 375 /sources light and 1280 /pipelines dark gave identical sequences. The label read:
  - `just now` at 1s, 22s and 42s;
  - `1 minute ago` at 62s, 82s and 102s;
  - `2 minutes ago` at 122s, 142s and 162s;
  - `3 minutes ago` at 182s and 202s.
- The tick fires on the 60s cadence from mount despite interaction every 20s. Round 1 measured the opposite: a frozen "3 minutes ago" on a row 6m13s old. The first-minute "just now" is D1's accepted staleness.

**E2E (this worktree, `DEV_PORT=7037`, the servers' cwd is this worktree's `frontend/` and `backend/`, and the Vite server serves the new `useNow.ts`)**
- Both specs, all cells, run once: **25 passed (1.1m), exit 0**. The teardown deleted 25 users. The list shows `e2e/hel1605-row-delete-confirm.spec.ts`, which exists only on this branch (`EV/e2e-full.log`).
- The re-enabled 375 test plus all HEL-1605 cells, `--repeat-each=5`: **45 passed (2.2m), exit 0**. The teardown deleted 45 users (`EV/e2e-rep2.log`).
- The HEL-1604 double-click test at 820/400 and 375, `--repeat-each=15`: **30 passed (2.2m), exit 0**. The teardown deleted 30 users (`EV/e2e-1604-rep.log`).
- My instrumented copy of the 820/400 HEL-1604 flow, on both pages, `--repeat-each=10`: 10 passed. All 20 gestures had both presses on the button (`EV/flake-run1.log`, `EV/flake.spec.ts`).

**The 1-in-33 HEL-1604 820px failure: root cause measured** (`EV/reflow2.log`, `EV/reflow2.spec.ts`, `EV/p768.log`)
- I sampled row 15's rect each animation frame from page load, together with `document.fonts` `loading`/`loadingdone` events.
  - On the first page load of a document, every row shrinks from 55px to 53px when the web fonts (`Schibsted Grotesk 400 900 | JetBrains Mono 500`) finish loading.
  - The examples were 820/pipelines at 785ms (rect) / 845ms (fontdone) and 375/pipelines at 817 / 845 and at 864 / 900.
  - This happens about 100–250ms after the rows first paint. Row 15 moves up by 34px (17 rows × 2px) and the Delete button moves right by 1–2px.
  - The second navigation in the same document (/sources) shows no shift, because the fonts are already loaded.
- **Why that produces "both presses on a TD".**
  - `settledRowTop` finishes after a single 150ms-stable pair, and that is often *before* the font swap.
  - The cycle-1 change removed base's second `settledRowTop(target)` after placement (the design's "removes the settledRowTop wait between placement and the gesture").
  - If the swap lands between Playwright computing the dblclick point and the first mousedown, the point is about 34px below the button. That is the padding of the next row's actions cell, a TD, for both presses. This matches the executor's observation exactly.
  - `handleRowClick` ignores the actions cell, so nothing navigates; the test fails on `pressTargets`.
- A second probe at 768 /pipelines did the same thing *after* a gesture: the button moved 28px (14 rows × 2px) 172–473ms after both presses landed correctly on the button (`EV/p768.log`, 4 of 6 runs). Calling `document.fonts.ready` right after `goto` does not prevent it, because no font load is pending until the rows render.
- **Judgment: not blocking.**
  - It is not caused by this change's product code. It is a document-level font-swap reflow that exists on base too; round-1's note recorded the 55→53px re-flow on base.
  - It only fails when the swap lands in a window of a few milliseconds inside the `dblclick` action. I saw 0 failures in about 100 gestures (30 + 45 + 20 + 6), and the executor saw 1 in 33.
  - Calibration excludes a defect I cannot reproduce on demand from a REFUTE. CI uses `retries: 0`, though, so I expect a low-single-digit-percent red rate on each of the two exposed tests (the HEL-1604 820/375 test and the re-enabled 375 test, which uses a bare `page.goto`).
  - The deterministic fix is in the notes below. I recommend folding it in before merge, because it is a test-only change of a few lines.

**AC trace**
- **AC1 (375 and 820/400 double-click on fresh rows, both pages, delta < 2px, no waiting for labels).**
  - Code: `useNow(60_000)` in both tables, plus the pin in `rowDeleteFocus.ts` `applyPin`.
  - E2E: `hel1574-shell-rail.spec.ts:477` (820/400 and 375, both pages, `FRESH_LABEL` asserted right before the gesture, and a `pressRowTops` delta < 2) and `:351` (375 /sources), both green above.
  - My probes: delta 0 at 375 light /sources, 768 light /sources, 820/400 light /pipelines and 1280 dark /sources (`EV/shots.log`).
- **AC2 (keyboard and pointer reveal at 375 clear the BottomNav).**
  - Code: `App.css` `scroll-padding-bottom: var(--bottom-nav-height)` in the ≤768 block.
  - Probes: 375 /sources dblclick, group bottom 632 = nav top 632; 375 /pipelines keyboard, group bottom 479 with the nav at 632, focus on `Confirm delete SK Shot 05` (`EV/shots.log`).
  - E2E: `hel1605-row-delete-confirm.spec.ts:82`, both modes, green.
- **AC3 (pointer Delete on a bottom row reveals after the window).**
  - Code: `REVEAL_DELAY_MS` timer in `arm()`.
  - E2E: I4 and I17 green.
  - Probe: 820/400 /pipelines pointer, group bottom 798 ≤ 800 at 900ms.
- **AC4 (375 `test.fixme` re-enabled, passes on CI).**
  - `test.fixme` has been removed (diff at `hel1574-shell-rail.spec.ts:351`), and the test passed locally 1 + 5 times.
  - I cannot observe CI. The font-swap exposure above is the residual risk.
- **Owner rulings.**
  - Delete is still overview-only: the diff adds no detail-page Delete.
  - The confirm is still a row under the clicked row (screenshots).
  - The button is secondary at rest (`rgb(100,94,86)` on transparent) and danger on hover (`EV/1280-light-pipelines-hover-hover.png`).
  - The 44px expander is untouched: the diff changes no table or ConfirmInline CSS.
  - Focus returns to the row's Delete after Cancel at all five probed widths and pages (`FOCUSBACK` lines in `EV/shots.log`).
  - `handleRowClick` guards are unchanged, and the M0 cell still covers them.

**Visual judgment** (screenshots read, both themes)
- `EV/375-light-sources-dbl.png` and `EV/375-dark-pipelines-keyboard.png`: the confirm sits directly under the row and clears the nav. The focus ring is visible on the keyboard path.
- `EV/768-dark-pipelines-dbl.png`: the full-width confirm row matches the sibling rows' rhythm.
- `EV/820-light-pipelines-dbl.png`: the sticky confirm content is visible with the table scrolled to its end. It sits flush on the viewport bottom (the same polish note as round 1).
- `EV/1280-light-pipelines-hover-hover.png`: the danger hover recipe.
- Cycle 3 changed no styles. Nothing is off-pattern relative to the sibling screens.

### Verdict: CONFIRM

### Non-blocking notes
1. **Font-swap flake in the double-click e2e (recommended fold-in).**
   - Make the placement deterministic: after the rows render and before `placeBottomNearViewportEdge`, wait for `document.fonts.status === "loaded"`. For example, in `gotoSettled` and in `placeBottomNearViewportEdge`, use `await page.waitForFunction(() => document.fonts.status === "loaded")` once a row is visible (not `document.fonts.ready` right after `goto`, which resolves before any load starts).
   - The re-enabled 375 test at `hel1574-shell-rail.spec.ts:372` uses a bare `page.goto("/sources")` and needs the same wait.
   - This waits on fonts, not on labels, so it does not conflict with AC1's "must not wait for the labels to settle".
2. **Product-level residual.** A real user who double-clicks within about 0.3s of the first page load can still be hit by the 2px-per-row font-swap reflow (one shift per document). Candidates for a follow-up are a font preload or `size-adjust`/metric-matched fallbacks. This is outside HEL-1605's relabel scope.
3. At 820/1280 the pointer reveal stops flush with the viewport bottom (a `scroll-margin-bottom` would look less cramped). This is polish, carried from round 1.
4. After a pointer double-click, focus stays on the row's Delete rather than on the group, the same as base (an a11y follow-up candidate, carried from round 1).

### Gate-chain notes
- No report I relied on depends on mtime ordering. All evidence here is self-authenticating: content logs with timestamps measured in the page, and pass counts. There is no gate defect to record.
- Throwaway data: every probe and e2e user was registered through `registerAndLogin` and deleted by recorded id in the global teardown ("deleted N recorded throwaway user(s)": 25, 30, 45, 10, 6, 4, 2, 8, 6). The dev account was not touched. The servers on 7037/9944 were left running and were not restarted.
- Evidence copies live under the untracked `openspec/changes/stabilize-row-delete-confirm/skeptic-final-evidence-2/` (like `eval-evidence-c*`). No tracked file was modified.
