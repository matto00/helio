## Skeptic Report — final gate (round 4, skeptic-final-4.md)

Reviewed HEAD `a78f5987ee38365584b636ca5256a9a7fa7fba0f`.

- **Spawn guard:** `READY ambient=/home/matt/Development/helio branch=feature/shell-rail-context-list/HEL-1574`.
- **Review base:** resolved live with `resolve-review-base.sh` (exit 0) to `c5cc7eeeed83d296ebf33a5bc576d6e0bb2883b0`. The branch diff against it is 161 files, +9367/-1807.
- **Changes since round 3 (`8b19c277a..a78f5987e`):**
  - Cycle 5 (`28bbefe42`) changed `PipelineListTable.{tsx,css}`, `SourceListTable.{tsx,css}`, `PipelinesPage.tsx`, `SourcesPage.tsx` and `rowDeleteFocus.ts`, plus their tests and two e2e cases.
  - `a78f5987e` only adds the report files.
  - The shell, rail, folders, BottomNav, backend and schema code is unchanged since the round-2 CONFIRM.

Durable evidence directory: `/home/matt/Development/helio/.concertino/runs/HEL-1574/evidence/.concertino/skeptic-final-4/`

### What I verified (with evidence)

**Gates I re-ran**
- Targeted jest (`nice -n 19`, `--maxWorkers=2`), covering PipelinesPage, SourcesPage, both list tables, rowDeleteFocus, AppShell, AppRail, BottomNav, DashboardList, ConfirmInline and shell/: **18 suites, 210 tests passed**, exit 0.
- `npm run typecheck`: exit 0.
- `eslint --max-warnings=0` on `features/pipelines/ui`, `features/sources/ui` and `rowDeleteFocus.ts`: exit 0.
- I relied on evaluation-5's pasted results for the full suite: 7229 jest, 293 Playwright, and backend unchanged since cycle 4.

**Test data**
- I tested against a throwaway user (`skeptic-hel1574-r4-…@example.test`, id `2affaea1-…`) with 24 static sources, 6 pipelines (two on R4 Src 05, to force a 409) and 3 dashboards.
- Afterwards I deleted the user by exact id with `userCleanupCore.buildUserDeleteSql`. Post-checks returned 0 rows for the user and for sample source, pipeline and dashboard ids.
- The dev account was never touched.

**Round-3 CR1 (confirm placement): fixed for the cases it named.**
- **Double-click.** At 1280 (dark), a double-click on "Delete R4 Src 18" while another row's confirm was open above it left exactly one group, "Confirm delete R4 Src 18". Row count stayed 24 and nothing was deleted.
  - I probed this cross-row case specifically: the confirm moves from row A to row B, so B shifts up under the pointer. The second click lands in B's confirm row at x≈1142, which is empty cell space. The confirm buttons sit at the left of that row (x 442–562).
- **Last row.** On "R4 Src 00" at `scrollTop` 432 (max), `scrollTop` stayed 432 and the row stayed at top 693.5. The confirm rendered in view at y 744–769 of 800.
- **409.** Delete, then Confirm, on R4 Src 05 got a 409. The HEL-989 notice rendered as the very next `<tr>` (`source-list-table__extra-row`) and listed R4 Pipe A and R4 Pipe B. The row stayed at top 483.5 and focus returned to "Delete R4 Src 05". Evidence: `sources-1280-dark-409.png`, `sources-1280-dark-confirm-referenced.png`.
- **375 (light), Sources.** A double-click on "Delete R4 Src 20" left the confirm for that row, in view at x 22–333 (`sources-375-light-dblclick-confirm.png`).

**Round-3 CR2 (button style): the recipe matches, but see CR 1 below.**
- At rest: `border rgba(33,29,25,0.11)` (subtle hairline), `color rgb(100,94,86)` (muted), transparent background.
- On hover: `--app-error-surface`, a 60% error border, and `#af3325` text. This is token-for-token `.agent-memory-list-table__delete-btn`.

**Light-theme hover contrast (the evaluator's 1.169): re-derived, and I accept it.**
- While the pointer is on the button, the row computes `rgb(255,255,255)`, because it is in hover. I measured `rowBg` live.
- The wash is 10% `#af3325` over white, about (247, 234.6, 233.2), which works out to 1.168:1. That is above the 1.1 guard floor.
- Border and text colour also change on hover.
- Keyboard focus never triggers `:hover`, so the resting-row backdrop (1.04–1.05) is not the relevant pair.

**Acceptance criteria and owner rulings (re-checked live; code unchanged since round 2)**
- **AC1, rail:** MET. At 1280 and 820 the rail shows Home, Dashboards, Data, Pipelines, Connectors, Assistant, then Settings and the avatar. With the list collapsed and the page reloaded, the rail is intact and "Expand list" sits at the rail foot (`dashboards-820-dark-collapsed-reload.png`).
- **AC2, resize:** MET.
  - Separator values are 200, 248 and 400.
  - Real `End` reached 400 (both `aria-valuenow` and the width), and `Home` reached 200.
  - `Enter` collapsed the list, and the collapsed state survived a reload.
  - (A synthetic burst of 20 dispatched keydowns only reached 312. That was my measurement artifact, re-run with real key presses.)
- **AC3, folders:** MET. I created a "Daily" folder through the UI and moved "R4 Ops Daily" into it with "Move to…". Counts went 1 and 2, and the folder survived a reload (`dashboards-820-light-moveto.png`, `dashboards-820-dark-folders.png`).
- **AC4:** MET. The Pipelines and Sources context lists show Recent and Scheduled plus "View all", not a copy of the table.
- **AC5, keep-768-as-phone, and phone Home:** MET.
  - At 768 and 375 the phone shell renders and BottomNav leads with Home (`sources-768-dark.png`, `home-375-dark.png`).
  - On `/home`, Dashboards is the active tab. That is consistent with home-points-to-dashboards.
- **Delete only on overview rows:** MET. `PipelineDetailHeader.tsx`, `PipelineDetailPage.tsx` and `SourceDetailPanel.tsx` have an empty diff against the base and no Delete control.
- **Accent discipline:** holds. Only the active rail or tab item, the active-dashboard dot, the one primary button (New pipeline / Add panel), the logo and the avatar carry the accent.
- **keep-surfaces:** no surface token was changed by cycle 5.

### Verdict: REFUTE

### Change Requests

1. **Share and Delete now touch with a 0px gap, so the pair reads as one fused segmented control.** This affects `frontend/src/features/pipelines/ui/PipelineListTable.tsx` (the actions `<td>`, around lines 220–241) and `PipelinesPage.css` / `PipelineListTable.css`.
   - **What I measured.** At 1280, `Share R4 Pipe C` has right = 1193.40625 and `Delete R4 Pipe C` has left = 1193.40625: exactly abutting.
   - **Cause.** The two `<button>`s are adjacent JSX elements with no whitespace, margin or flex gap. Before cycle 5, Delete's border was transparent, which hid this. CR2 gave it the subtle hairline, so it is now plainly visible in both themes and at every width: `pipelines-dark-actions-cell-zoom4.png` (4x zoom), `pipelines-1280-light-confirm.png`, `pipelines-375-light-scrolled-confirm.png`.
   - **Sibling pattern.** `.connectors-page__row-actions` uses `display: flex; gap: var(--space-2)`.
   - **Fix.** Separate the two buttons with a spacing token, for example a flex wrapper with `gap: var(--space-2)`, or `margin-left: var(--space-2)` on the delete button. Keep the actions column right-aligned.
   - **Touch gate.** DESIGN.md §3 "Expander tiling" applies only to clusters where both controls carry expanders. Share's expander is HEL-1602, so no extra touch-gated gap is needed now. Do not widen the gap past `--space-2` to compensate.

2. **When the Pipelines table is scrolled sideways to reach Delete, the confirm's label (the item name and the warning) is scrolled out of view.** Files: `PipelineListTable.tsx:244-249` (`__extra-row`/`__extra-cell`) and `PipelineListTable.css:94-97`. The same applies to `SourceListTable`'s extra cell.
   - **Cause.** The inserted row's cell spans the whole scrolled table (`colSpan` 7), and its content starts at the table's left edge. Delete is the last column, so a user at a narrow content width must scroll the table right to reach it, which pushes the confirm text off the left edge. Round 3's confirm sat outside the scroll container, so this is a regression introduced by the CR1 fix.
   - **375, light theme.** The Pipelines scroller is 327 wide against a 681 table (`scrollLeft` 354). After a click on "Delete R4 Pipe C", the confirm group's rect is x −314 to 334, so the user sees only "…s will stop working. [Delete] [Cancel]" (`pipelines-375-light-scrolled-confirm.png`).
   - **820, dark theme, desktop shell.** With the context list at its 400 max, the scroller is 316 wide against 681 (`scrollLeft` 365). The confirm reads "…will stop working. [Delete] [Cancel]" (`pipelines-820-dark-scrolled-confirm.png`).
   - **Why it matters.** The name is the user's confirmation of which item they are deleting, and the clipped sentence is visibly broken.
   - **Fix.** Pin the extra-row content to the visible part of the scroller. For example, wrap the content in an element with `position: sticky; left: 0;` and a `max-width` equal to the scroller's visible width, so it wraps instead of extending. Apply this to both tables, so the 409 notice and the error banner are covered too.
   - **Regression test.** At 375 on `/pipelines`, scroll `.pipeline-list-table__scroll` to its end, open a row's confirm, and assert that the group's `getBoundingClientRect().left` is at least the scroller's `left`. Today it is −314 against 24.

### Non-blocking notes
- **Stale CSS comment.** `SourceListTable.css:112` still reads "an error-toned text button; the confirm is the page's.". Both halves are now false; the Pipelines file's comment was updated.
- **Sources at 820 with the list at 400.** The Sources table is badly crowded: the "Updated" text wraps to three lines and the hovered Delete overhangs the row (`sources-820-dark-confirm-referenced.png`). This is mostly the pre-existing fixed-layout squeeze already noted in round 3 (HEL-1582 territory), but the max list width makes it worst-case.
- **"Move to" bar.** Its Cancel renders smaller than the Daily and Unfiled chips (`dashboards-820-light-moveto.png`). The code is unchanged since round 2; polish only.
- **Transient spinner in screenshots.** Twice a viewport screenshot caught a full-screen loading spinner after the page had already rendered (`performance.timeOrigin` unchanged, so no reload). I could not reproduce it by polling for 3 s, so I record it only as unexplained and possibly a tooling artifact.
- **Duplicate names.** `rowDeleteFocus` still matches rows by accessible name (carried from rounds 3 and 5).
- **No gate defect.** No report I drew on disclosed unsound evidence mtimes, and nothing here rests on mtime ordering. All measurements are live `getBoundingClientRect` and computed-style values.
- **Housekeeping.**
  - Throwaway user deleted by exact id; the dev account was untouched.
  - The theme was toggled only through browser localStorage.
  - Servers stopped with `stop-servers.sh` (`STOPPED ports=7006,9913`).
  - The browser is closed.
