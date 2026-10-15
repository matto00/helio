## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Reviewed HEAD `8b19c277a207e4b031f2dbf02f69cc4ebd4ce688`.

- **Spawn guard:** `READY ambient=/home/matt/Development/helio branch=feature/shell-rail-context-list/HEL-1574`.
- **Review base:** resolved live with `resolve-review-base.sh` (exit 0) to `c5cc7eeeed83d296ebf33a5bc576d6e0bb2883b0` (origin/main, HEL-1386). The branch diff against it is 159 files, +8906/-1716.
- **Changes since the round-2 CONFIRM (`1f1c32aea`) that belong to this branch:**
  - `f980e0ce7`: Delete moved onto the overview rows.
  - `776b53aee`: the 44px expander and `rowDeleteFocus.ts`.
  - Two merges of main.
  - The shell, rail, folder, BottomNav, backend and schema code is unchanged since round 2. The only diffs in `frontend/src/app` are main's `draftAppearance` removal.

Durable evidence directory: `/home/matt/Development/helio/.concertino/runs/HEL-1574/evidence/.concertino/skeptic-final-3/`

### What I verified (with evidence)

**Gates, re-run by me on `8b19c277a`**
- **HEL-1386 merge.**
  - `npm run check:scala-quality` exit 0 ("clean (252 soft warning(s))").
  - `scripts/check-scala-quality.mjs` is byte-identical to `c5cc7eeee`'s, so main's stricter `${...}`-splice FQN guard is the one that ran.
  - `node scripts/check-scala-quality.selftest.mjs`: 95 passed.
- **Static gates:** `lint`, `typecheck`, `format:check`, `check:tokens`, `check:schemas`, `check:openspec` all exit 0.
- **Targeted jest** (`nice -n 19`, `--maxWorkers=3`): 41 suites and 554 tests passed. The run covered shell/, AppShell, AppRail, DashboardList*, the folders slice, authSlice, BottomNav, UserMenu, SourceDetailPanel, PipelineDetailPage, `PipelinesPage.delete`, `SourcesPage.delete`, the list tables, App and CommandBar.
- **Playwright** `e2e/hel1574-shell-rail.spec.ts` (`DEV_PORT=7006 BACKEND_PORT=9913`, 1 worker): **13 passed**. That includes both new row-Delete cases (1280 and 375). The 13 throwaway users were deleted.

**Acceptance criteria**
- **AC1:** MET. The rail is visible at 820 and 1280, and every section is one click away. The 768 boundary follows the owner's keep-768-as-phone ruling: at 768 I got the phone shell (`pipelines-768-dark.png`). Covered by e2e.
- **AC2:** MET. The separator works by keyboard and by drag, clamps, and persists. Code unchanged since round 2; e2e green.
- **AC3:** MET. Folders: create, rename, collapse and move, persisted with RLS. Code unchanged since round 2; e2e folder cases green.
- **AC4:** MET. The Pipelines context list is Recent/Scheduled, not a copy of the table (`pipelines-1280-a.png`).
- **AC5 and the phone Home ruling:** MET. At 768 and 375, BottomNav leads with Home and the active tab has an accent wash (`pipelines-375-light.png`).

**Owner ruling on Delete ("only on overview rows, not in detail pages")**
- The grep for Delete in `PipelineDetailHeader.tsx`, `PipelineDetailPage.tsx` and `SourceDetailPanel.tsx` finds no Delete control. The detail files are net-identical to main.
- The row Delete exists on every row of both tables. This matches main's retired sidebar, which also showed Delete on every row with the server enforcing ownership.
- The reference warning shows in the confirm (`sources-1280-dark-confirm.png`).
- **409 checked live.** Confirming "HEL-1189 Skeptic Orders" got a 409. The conflict notice rendered and named "HEL-1189 Skeptic Pipeline". The row stayed, and focus returned to "Delete HEL-1189 Skeptic Orders" (`sources-1280-dark-409.png`). No data changed: 77 sources and 4 pipelines before and after.

**Expander and focus (the fix-forward)**
- `::after` computes to 44px tall and 52.6px wide at 375.
- The CSS gate is `(max-width: 768px), (pointer: coarse)`.
- Cancel returns focus to the row's Delete.
- `rowDeleteFocus.ts` is sound.

**Visual check**
- I used the running app in both themes at 1280 (Sources light and dark, Pipelines light), 820 (dark), 768 (dark) and 375 (light), checked against the B2 board.
- Rail and chrome surfaces are correct. Accent discipline holds: only the active rail or tab item and the single primary button carry the accent.

**Defect found: the confirm panel sits above the table, so opening it moves the table under the pointer and pulls the page away from the row.** I reproduced this four times:
1. **Double-click hits a different source.** On `/sources` at 1280, scrolled to the top, I double-clicked "Delete Focus Test 2". The pending confirm named **"HEL-1027 live verify source"**, a different source (`sources-1280-dark-dblclick-retarget.png`). The first click inserts the ~37px confirm bar above the table and pushes every row down, so the second click lands on the previous row's Delete.
2. **Same result on `/pipelines`.** Double-clicking "Delete Profit (migrated)" left the confirm on "skeptic-pipeline".
3. **The page jumps on a long list.** On the 77-row Sources list, Delete on the last row ("Netflix") moved `.app-content` `scrollTop` from 2913 to 0. The clicked row ended up at y=3542, off-screen (`sources-1280-dark-lastrow-confirm.png`). Cancel then scrolled back to 2803.
4. **Same at 375.** After a tap on "Delete HEL-1189 Skeptic Orders", the pointer was over "Daily signups"' Delete, which now has the larger 44px hit strip (`sources-375-light-confirm.png`).

**Assessment.** The confirm text names the item, so a careful user is not silently hurt. Still, a destructive control should not move under the pointer, and a confirm should not open thousands of pixels away from the row it belongs to. The app already has a pattern that avoids both: the confirm opens inside the row (`AgentMemoryList.tsx:104-127`, which mirrors `MetricListTable`), and the retired `SidebarItemList` opened its confirm directly below the item. No test catches this: the jest and e2e cases click once and never check row positions.

**Design-standard divergence: the row Delete uses a new button style.**
- **The new style.** `PipelineListTable.css` and `SourceListTable.css` `__delete-btn` use `border: 1px solid transparent` with error-coloured text at rest. That is neither §5 Danger (an error hairline at 60%) nor Ghost (muted text).
- **What sibling tables do.** Their row actions use the secondary style at rest and switch to danger on hover:
  - `.agent-memory-list-table__delete-btn` (`AgentMemoryList.css:105-124`)
  - `.api-tokens-list-table__revoke-btn` (`ApiTokensSection.css:163-183`)
  - Share in this same cell does the same.
- **What it looks like.** The result is a column of 77 red "Delete" words next to a boxed Share (`sources-1280-light.png`, `pipelines-1280-a.png`).
- **The rule.** DESIGN.md §5 says "A new button style is a defect, not a variant."

### Verdict: REFUTE

### Change Requests
1. **Fix the confirm placement so opening it never moves the table under the pointer or scrolls away from the row.**
   - Files: `frontend/src/features/pipelines/ui/PipelinesPage.tsx` (the confirm `div` before `<PipelineListTable>`) and `frontend/src/features/sources/ui/SourcesPage.tsx` (the confirm before `<SourceListTable>`).
   - Render the confirm next to its row instead. One option is a full-width row inserted directly below the clicked row (`colSpan` = column count), keeping the row's Delete button in place. That fits the long HEL-1258 warning and leaves nothing at or above the pointer moving.
   - Do not swap the row's Delete for the Confirm button in place: a double-click would then confirm the delete.
   - Keep the existing focus contract: focus into the confirm on open, back to the row's Delete on Cancel or refusal, and to the neighbour or `h1` after success.
   - For the 409 notice, also show it next to the row, or at least make sure it does not shift rows under the pointer.
   - Add a regression test: double-clicking a row's Delete leaves the pending confirm naming **that** row. Today this fails at 1280 on both pages, as reproduced above. Also check that the clicked row's `getBoundingClientRect().top` does not change when the confirm opens.
2. **Restyle `.pipeline-list-table__delete-btn` and `.source-list-table__delete-btn` to the sibling row-action style.** At rest: `--app-border-subtle` hairline and `--app-text-muted`. On hover: `color-mix(in srgb, var(--app-error) 60%, transparent)` border, `--app-error-surface` and `--app-error` text, exactly as `.agent-memory-list-table__delete-btn` does. Delete then matches Share beside it and the other list tables, and no longer paints every row red. Keep the 44px `::after` expander unchanged.

### Non-blocking notes
- **Delete is off-screen at 820 and 375.** At these widths the Delete (and Share) column is only reachable by scrolling the table sideways (`pipelines-820-dark.png`, `pipelines-375-light.png`). This was already true of Share; HEL-1582 (pipelines on mobile) is the natural owner.
- **Header overlap at 375 on Sources.** The fixed-layout table's headers overlap ("Location", "Used by", "Updated"). Hiding the new Actions column still leaves "Used by" and "Updated" overlapping (46px cells, 60px labels), so this is mostly pre-existing. The Actions column only takes Location's spare width.
- **Duplicate names.** `rowDeleteFocus.ts` finds rows by accessible name, so with two rows of the same name focus goes to the first one. Minor; ids would be more robust.
- **Evaluator claims.** Evaluation-4's claims about the expander, the 409 focus and the detail pages matched what I measured.
- **No gate defect.** No report I relied on disclosed unsound evidence mtimes, and nothing here depends on mtime ordering.
- **Housekeeping.**
  - Dev data is unchanged: no delete succeeded, and the 409 was refused server-side.
  - The theme was toggled only through browser localStorage.
  - Servers stopped with `stop-servers.sh` (`STOPPED ports=7006,9913`).
  - The browser is closed.
