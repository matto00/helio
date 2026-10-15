## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed head: `94521a80fceeacb48826ece0b4beb922b31edb67` (base `cd64409ad`, resolved live via resolve-review-base.sh).
Evidence dir (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1605/evidence/openspec/changes/stabilize-row-delete-confirm/eval-evidence-c1/`.
The matrix measurements are content (JSON dumps from getBoundingClientRect/scrollTop/mousedown targets). No claim here depends on file mtimes.

### Phase 1: Spec Review — FAIL

| Check | Result |
|---|---|
| AC1 (375 and 820/400, fresh rows, both pages, both presses on the row, one confirm, top delta < 2px, no settle wait) | PASS. E2E is green (below). Live, with fresh rows on both pages, light and dark: top delta 0 at 375, 768, 820/400 and 1280 (I2, I5, I7, I17). |
| AC2 (keyboard and pointer reveal at 375 clear the BottomNav, e2e asserts it) | PASS. E2E I4/I6. Live at 375: the group bottom is 632 and the nav top is 632, in both themes and on both pages. |
| AC3 (pointer Delete on a bottom row comes into view after the window) | PASS. Live at every width: no scroll at 300ms, and the confirm is fully in view by 1s. |
| AC4 (375 fixme re-enabled, passes on CI) | PASS. See judgment 2. |
| No AC silently reinterpreted | PASS. The fake-clock deviation is disclosed and judged acceptable (judgment 2). |
| Tasks done and matching | FAIL (minor). Task 2.9 (live matrix probe) is unchecked. This evaluation ran it, and it found the defect in CR1. |
| Scope creep | PASS. C4 holds: the table files have call-site edits only, with no stylesheet change. |
| Regressions / owner rulings (C1) | PASS. See judgment 5. |
| Spec delta reflects behaviour | FAIL. The "Switching the confirm to another row" scenario (page can compensate, so both presses land on B's Delete) does NOT hold at 768 on /sources (CR1). |
| CONSTRAINTS C1-C4, C6, C7 | C1, C3, C4, C6 and C7 honoured. C2 (every matrix cell at 375/768/820-400/1280, both themes) was not met by the executor. This evaluation ran it, and the 768 width fails I14 (CR1). |

### Phase 2: Code Review — FAIL

Fresh gates, run by me in `/home/matt/Development/helio/.claude/worktrees/bug/overview-row-delete-confirm/HEL-1605`:
- `npm run lint` exit 0. `npm run format:check` exit 0. `npm run typecheck` exit 0. `npm run check:e2e-types` exit 0. `npm --prefix frontend run build` exit 0.
- `npm test` (3 workers): root suite 51/51 suites and 469 tests passed. Frontend suite 611/611 suites and 7263 tests passed. Exit 0.
- Targeted `--json` run listing this worktree's paths: `frontend/src/hooks/useNow.test.ts` 4 tests, `shared/chrome/rowDeleteFocus.test.ts` 18, `shared/ui/ConfirmInline.test.tsx` 7, `utils/formatRelativeTime.test.ts` 3. All passed.
- E2E, `DEV_PORT=7037`, `--workers=2 --repeat-each=2`, `e2e/hel1574-shell-rail.spec.ts` + `e2e/hel1605-row-delete-confirm.spec.ts`: **48 passed**, exit 0. Teardown deleted 48 recorded users.
- No backend files changed, so `sbt testFull` was not required.

Findings:
- **CR1 (blocking, spec-divergence): `verticalScroller()` picks a table scroller that overflows by 1px, so the pin compensates the wrong element.**
  - Location: `frontend/src/shared/chrome/rowDeleteFocus.ts:65-72` (`verticalScroller`) and `:74-80` (`applyPin`).
  - Live at 768x900 on /sources (22 rows), `.source-list-table__scroll` measures `scrollHeight 998 > clientHeight 997`. `verticalScroller` returns it, and `scrollTop += delta` lands on an element that can scroll only 1px.
  - `.app-content` stays at scrollTop 48. It had room to compensate the -42px shift, but nothing moves it. B's Delete moves up 42-49px between the presses (`i14-768-sources-diagnosis.txt`).
  - In the I14 matrix cell at 768 /sources (light and dark), press 2 lands on **"Confirm delete P1605 Src 06"**, with `dTop=-49` and `stPress=55,55`, on a page with scrollTop 55 > the 49px row (`768-light.json`, `768-dark.json`, `matrix-summary.txt`).
  - D2b held: no DELETE request was sent. But the design invariant and the spec scenario "page can scroll far enough … both presses land on the second row's Delete" are violated at a matrix width.
  - Design Context assumed "table scrollers never overflow vertically". That is false by 1px (sub-pixel or row geometry) in this layout.
- **CR2 (blocking, mechanical dead code): `frontend/src/shared/chrome/rowDeleteFocus.ts:107-108`.**
  - `requestAnimationFrame(() => {});` schedules a no-op.
  - Its comment ("Deferred: a switch … detaches and attaches in one commit") describes behaviour this line does not have.
  - CONTRIBUTING "Comments" / no dead code.
- Non-blocking: `cancelReveal` (`rowDeleteFocus.ts:32-34`) is a pure alias of `clearTimer`. `clearTimer` could itself be the listener.
- Everything else checks out:
  - DRY: the e2e helpers moved to `e2e/support/rowDeleteGesture.ts`.
  - Types: no `any`. Security: no new boundaries.
  - Tests: they are meaningful, and the pin, reveal, StrictMode and switch orders are unit-covered per C6.
  - `useNow` snapshot is stable (`useSyncExternalStore` returns the stored value).
  - D2b is opt-in and set only on the two overview confirms.
  - App.css uses the same `--bottom-nav-height` token, inside the existing `max-width: 768px` block.

### Phase 3: UI Review — FAIL

Servers: started via `start-servers.sh`, `assert-phase.sh servers` printed PASS. Ports 7037 and 9944 are served by processes whose cwd is this worktree's `frontend/` and `backend/`.

Live matrix (task 2.9 / C2): `probe.cjs`, 8 configs = {375x700, 768x900, 820x800 with contextListWidth 400, 1280x700} x {light, dark}, on both /sources and /pipelines.
- Setup: one fresh throwaway user per config, with 22 sources and 20 pipelines seeded seconds earlier. The browser clock is installed 1.5s before the earliest row.
- Each double-click cell is aged 8s between render and press. This is the same stress the e2e uses, and the rows read "just now".
- Full per-cell measurements are in `matrix-summary.txt`.

| Cell | 375 L/D | 768 L/D | 820/400 L/D | 1280 L/D |
|---|---|---|---|---|
| I1 single click mid row | top delta 0 at 100ms and 1s; scroll unchanged; confirm is the next row; focus on the group | same | same | same |
| I2 fresh double-click | both presses on the row; dTop 0; one confirm; URL unchanged | same | same | same |
| I4 pointer, last visible row | scrollTop unchanged at 300ms (group still below the fold, bottom 656 / 645); by 1s the group bottom is 632 = nav top | at 300ms bottom 838 (src) / 823; by 1s 832 = nav top | by 1s 800 = viewport | by 1s 700 = viewport |
| I5 double-click, last visible row | dTop 0, then revealed above the nav | same | same | same |
| I6 keyboard Enter near bottom | group bottom 632 ≤ nav 632; focus on the group | ≤ 832 | ≤ 800 | ≤ 700 |
| I7 table at its end, I2 + I6 | scrollLeft unchanged (10 / 340); content inside the table rect; dTop 0 | no h-scroll | scrollLeft 11 / 351 kept | no h-scroll |
| I8 switch, compensable | src scroll 297→218, pipe 289→218; dTop 0 | /pipelines dTop 0. /sources: page at scrollTop 0 (not compensable), press 2 on B's Confirm, no DELETE (D2b, the expected D2 limit) | dTop 0 | dTop 0 |
| I9 Cancel / Confirm / 409 | focus returns to the row's Delete; to the neighbour's Delete after Confirm; 409 notice under the row, focus on the row's Delete | same | same | same |
| I10 row click / near-miss / detail-2 | navigates / stays / stays; detail page has no row Delete | same | same | same |
| I11 delete last row at bottom | scroll 660→607 (one row) | 449→396 | kept | kept |
| I13 recipe | rest: muted text, transparent background; hover: `--app-error` text and the error surface; `::after` 44px, hits at ±20px | 44px | n/a (> 768) | n/a |
| I14 switch, A above | dTop 0, both pages | **/sources: dTop -49, press 2 on "Confirm delete …"** (CR1); /pipelines dTop 0 | dTop 0 | dTop 0 |
| I16 click A then B within 500ms | one scrollIntoView call, on B's connected group | same | same | same |
| I17 last row at max scroll | dTop 0; revealed; URL unchanged | same | same | same |
| I18 assistant `block:"end"`, 375 | composer bottom 569 and Send above nav 632; latest message fully visible; scroll stops 38px short of max (the padding) | — | — | — |
| I20 stale pin | no jump (beforeEnter = afterEnter) | same | same | same |
| I21 wheel during the window | zero reveal calls; scroll equals the wheel delta only | same | same | same |

Light and dark are identical in geometry. The dark theme applies its own tokens: muted `#aaa49c`, error `#f17b67`.

Console:
- The only errors are an expected 409 (refused delete, /sources) and one 404 on the pipeline detail page after the I10 navigation (a detail-page fetch, not the overview).
- No page errors, and no DELETE except the deliberate I9/I11 confirms.

### Judgments requested by the orchestrator

1. **Live matrix (768, dark):** done, see above. It found CR1 at 768 on /sources only. I18 passes (screenshots `i18-375-light.png` / `i18-375-dark.png`).
2. **`page.clock` deviation:** acceptable.
   - It does test the real defect: labels recomputed from the wall clock on a re-render between a fresh render and the press.
   - It does that deterministically, by starting every row at "just now" and moving time 8s without firing the 60s tick.
   - I verified this independently with an in-browser M1 mutation (the Vite module `SourceListTable.tsx` served with per-render `Date.now()`; no worktree file touched; `m1-in-browser-mutation.txt`):
     - With the clock: red 3/3 (row moves 9-10px between presses, caught by the restored < 2px delta).
     - Without the clock: green 3/3, which confirms the executor's claim that real time is not red locally.
     - The fix with the clock: green 3/3.
   - It still honours the AC: the rows are really created seconds earlier, freshness is asserted on the target row immediately before the gesture, and no step waits for labels.
   - `placeBottomNearViewportEdge` still runs `settledRowTop`, but that waits for row layout (the late references fetch), not labels. With the fix, labels cannot change during it.
   - CI: the outcome no longer depends on runner timing, and the test is deterministic. The only residual is a `useNow` tick landing inside the ~100ms gesture, which would need more than about 50s between page load and the press. Expected to pass on CI.
3. **I19 reaching only Cancel:** adequate.
   - `ConfirmInline.test.tsx` covers the guard on both buttons with detail 2, plus the default-off case.
   - This evaluation's live 768 /sources run landed press 2 on the real Confirm button twice, and no DELETE request was sent. That is live evidence for the Confirm half.
4. **"New pipeline" press-2 hazard:** non-blocking follow-up.
   - It is in the D2 limit region, where the page cannot compensate.
   - It is non-destructive: it opens a dismissible create modal, and it neither deletes, cancels nor navigates, so D2b and the spec's "deletes nothing" scenario hold.
   - Recommend a follow-up ticket: suppress `detail > 1` on the toolbar's create button, or a broader "ignore the second press of a gesture that started on a row Delete" guard.
   - Note that CR1 widens how often the D2-limit outcomes occur, so fix CR1 first.
5. **Owner rulings:** intact. Delete appears on the overview rows only, and the detail page has none. The confirm is the next `<tr>`. Secondary at rest, danger on hover. The 44px expander is present at ≤768. Focus returns after Cancel, Confirm and refusal. The `handleRowClick` near-miss and detail-2 presses do not navigate.

### Overall: FAIL

### Change Requests
1. **`frontend/src/shared/chrome/rowDeleteFocus.ts:65-80`: make the pin compensate on a scroller that can actually move.**
   - Today a 1px overflow of `.source-list-table__scroll` (scrollHeight 998 / clientHeight 997 at 768x900, /sources, 22 rows) captures the pin.
   - Recommended fix: in `applyPin`, apply the delta to the nearest scroll ancestor, measure how much `scrollTop` actually changed, and pass the remaining delta to the next scrollable ancestor, up to `document.scrollingElement`.
   - A larger overflow threshold would only move the failure to a 2px case.
   - Add a unit test with an inner scroller that overflows by 1px inside an outer scroller with room, and assert that the outer `scrollTop` absorbs the delta.
   - Add an e2e or recorded live check of I14 at 768 on /sources (the geometry in `i14-768-sources-diagnosis.txt`: 22 sources, A = row 2 open, B = row 15 placed 75px above the bottom) asserting press 2 on B's Delete and dTop < 2.
   - Then re-run the I8/I14 cells at 768 in both themes.
2. **`frontend/src/shared/chrome/rowDeleteFocus.ts:107-108`:** delete the no-op `requestAnimationFrame(() => {});` and its comment.
3. **`openspec/changes/stabilize-row-delete-confirm/tasks.md`:** mark 2.9 done only once the 768 /sources I14 cell passes. Cite this report's matrix plus the re-run cells.

### Non-blocking Suggestions
- File the "New pipeline" toolbar press-2 follow-up (judgment 4).
- `rowDeleteFocus.ts:32-34`: drop the `cancelReveal` alias and register `clearTimer` directly.
- After a pointer double-click, focus sits on the row's Delete (press 2 refocuses it) rather than on the confirm group, at every width. This is the same as base, so it is not a regression, but it is worth a note for the a11y follow-ups.

Throwaway data: 22 probe users, recorded by exact id in the scratch registry, were deleted with `buildUserDeleteSql` (e2e/support/userCleanupCore.cjs) via `db.cjs psql`. A follow-up `SELECT count(*)` over those ids returned 0. The dev account was not touched. The servers were left running for the next gate.
