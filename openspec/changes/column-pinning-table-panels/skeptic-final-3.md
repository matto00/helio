## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Cold review. Every conclusion below is derived from the running app, the actual
diff, or gate output I ran and read myself. Prior reports were read as claims only.

### What I verified (with evidence)

**Ground truth / environment**
- Worktree `pwd -P` and `git branch --show-current` both agree with the brief.
  `HEAD = 1bf4f34b`, on top of `21c0059e`/`f35a9d57`/`7bbc49d1`. `git status
  --porcelain` empty. `git rev-list --count HEAD..main` = 0 (branch base is
  current `main` at `7b872db9`; main has not moved).
- `start-servers.sh` reported "already healthy … reusing" for both ports, so I
  checked `/proc/<pid>/cwd` for every vite/sbt/java process: all resolve under
  this worktree (`…/HEL-465/frontend`, `…/HEL-465/backend`). Not a stale
  foreign server. `assert-phase.sh servers` → `PASS servers`.

**Gates (re-run by me, not taken from evaluation-*.md)**
- `npm run typecheck` — clean. `npm run lint` (`--max-warnings=0`) — clean.
- `npm run format:check` — "All matched files use Prettier code style!".
- `npx jest` — **299 suites / 3174 tests, all passing**, 28.3s.

**AC4 under REAL horizontal scroll — the round-1/round-2 defect class**
Verified by rendered pixels in screenshots I looked at, not by
`getComputedStyle` and not by the CSS declaration's existence.
- Dark, `scrollLeft = 600`, filter row expanded: a continuous 1px separator at
  the pinned boundary (right edge of `date`), spanning the header row, the
  per-column filter row, and body rows.
- Dark, `scrollLeft = 3000`: separator still exactly at the pinned boundary;
  the scrolling region behind it changed columns (`player.fantasy_positions` →
  `season_type`), proving real scroll occurred.
- **Negative control:** unpinned all columns (`.ui-data-grid__pinned-cell`
  count = 0) at `scrollLeft = 3000` → the line is gone and content scrolls
  freely. Rules out "some adjacent cell border happened to be there".
- Light theme (toggled through the real UI control, so derived tokens
  recompute — `data-theme=light`), `scrollLeft = 1500`: separator present at
  the boundary across header + filter row + body rows.
- Dark, full-size detail modal, `scrollLeft = 900` **and** `scrollTop = 100`
  (both axes at once): separator spans the full visible height; pinned cells
  are opaque with no bleed-through; sticky header + pinned-column corner cells
  layer correctly (z-index tiers behave as designed).
- Post-resize: after dragging `category` 160→260 the separator re-renders at
  the new boundary.
**Round-2's CR1 is genuinely fixed.** The `::after` moves with the sticky cell.

**AC1 / AC2**
- Three pinned columns stay frozen while the scrolling region moves, at
  `scrollLeft` 600/900/1500/3000, in both themes.
- Cumulative offsets after a live resize of column 1 to 260px: inline `left`
  values `0px / 260px / 420px`, and the measured on-screen `x` of the three
  pinned `th`s was 297 / 557 / 717 — contiguous, no gap and no overlap, at a
  non-zero scrollLeft. Offsets track `columnWidths`/`liveWidths` correctly.
- Density: `computePinnedOffsets` sums widths only, never padding — verified in
  source and by unit test; density is not reachable on the table panel surface
  (tasks.md 4.4), so this is correct by construction.

**AC3 persistence**
- Full page reload: the 3-column pin set survived (`Unpin column category /
  company / date`, `Pin column game_id`), with `left` back to `0/160/320` as
  widths correctly reset (Decision 2's accepted consequence).
- Panel-detail-modal open: pin state carried across the modal boundary.
- **No unsolicited PATCH on mount:** the post-reload network log shows only
  `GET` calls on `/api/outputs/**` — zero `PATCH`. skeptic-final-1 CR2's
  StrictMode mount-effect defect is confirmed fixed live.

**AC5 non-regression (against HEL-253/255/448/451/469)**
- Sort on a pinned column: `aria-sort` flips to `ascending`, rows re-order.
- Per-column filter on a pinned column: typing `zzzz` yields the correct
  filtered-empty state ("No rows match your filter in the 200 rows loaded so
  far"); Clear all restores 200 rows.
- Resize of a pinned column works and updates all subsequent pinned offsets.
- Cell content is unchanged by pinning: an apparently-blank `date` cell was
  probe-checked by unpinning and re-reading the same cell — identical output,
  so it is pre-existing data/formatting, not a pinning artifact.
- Console: **0 errors** over the whole session.
- No zebra/row-hover rules exist in `DataGrid.css`, so the opaque pinned-cell
  background cannot diverge from a row state.

**Scope / collision**
- Diff since round 2 (`21c0059e..HEAD`) is tightly scoped: the CSS separator,
  one static-source Jest test, and doc corrections. Nothing else.
- **HEL-520 collision: none.** All 12 `HEL-520` matches in the diff are report
  prose; no `e2e/focus-presence-guard*` files, no shared-focus changes.

**Doc/comment corrections — read, not assumed**
- `DataGrid.css` Decision-8 comment, `design.md` Decision 8, and `tasks.md` 2.6
  now describe both `border-collapse` interactions accurately and no longer
  claim a pixel verification that did not happen. The Jest test at
  `DataGrid.test.tsx` ("STATIC SOURCE: … not a border/box-shadow") explicitly
  scopes itself to the CSS shape and disclaims proving scrolled rendering —
  honest. `TableRenderer.test.tsx`'s reorder test likewise labels itself a
  correctness assertion rather than a proven-red guard. Good discipline.

### Verdict: REFUTE

One new, independently reproduced, user-facing defect — not a repeat of the
round-1/round-2 separator complaint (that is fixed). It is in this ticket's own
new affordance and was introduced by this change.

### Change Requests

1. **BLOCKING — the pin toggle is invisible and un-clickable on any column
   whose header content is wider than its column** (`DataGrid.tsx` header
   `<th>`, the `IconButton` with `className="ui-data-grid__pin-toggle-btn"`;
   `DataGrid.css:141-165` `.ui-data-grid__table thead th { overflow: hidden }`).

   The pin button is added as **inline flow content** at the end of a `<th>`
   that is `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`
   under `table-layout: fixed`. For long headers the button lays out entirely
   past the cell's right edge and is clipped away.

   Reproduced three independent ways on the running app (real dataset,
   82-column "Projections 2026 table", default 160px widths):
   - **Geometry:** 23 of 61 header cells (38%) have the button's box entirely
     outside the cell. Example `player.injury_notes`: th spans x 853–1013, the
     button lays out at x 1013–1037.
   - **Hit test:** `document.elementFromPoint` at that button's centre returns
     a neighbouring cell's `SPAN`, not the button — so it cannot be clicked.
   - **Rendered pixels:** the header reads `player.last_name ⇕ …` — the pin
     icon is replaced by the truncation ellipsis, while the fitting columns
     (`category`, `company`, `date`) show theirs.

   Two consequences, both blocking:
   - **Functional:** the feature's only affordance is unreachable by mouse on
     ~38% of columns in exactly the wide tables column pinning exists for.
     Ticket Scope requires "Pin toggle affordance in the column header".
   - **Accessibility:** the button still takes focus. I focused it
     (`document.activeElement` = "Pin through column player.injury_notes") and
     the cell did **not** reveal-scroll (`th.scrollLeft` stayed `0`) — the box
     remained fully outside the clipping cell. That is a keyboard-focused
     control with a completely invisible focus indicator (WCAG 2.4.7), in a
     repo that has just landed HEL-1046 / HEL-1050 / HEL-533 specifically on
     focus-indicator visibility, and against DESIGN.md §8.

   **This file already contains the fix's precedent.** The sibling control
   added by HEL-253 solves exactly this problem:
   ```css
   .ui-data-grid__resize-handle {
     position: absolute;
     top: 0; right: 0; bottom: 0;
   }
   ```
   It is absolutely positioned *precisely because* the `<th>` clips its inline
   content — the same reasoning the round-2 `::after` separator fix already
   relies on. Take the pin toggle out of inline flow the same way (e.g.
   `position: absolute` near the right edge, offset clear of the resize
   handle's own `right: 0`, with matching `padding-right` reserved on the `<th>`
   so the header label ellipsizes before it rather than under it), or adopt an
   equivalent shape that keeps the control inside the cell's painted box at
   every column width.

   Verify the fix the same way this round verified the separator: measure that
   **zero** header cells have the button laid out outside the cell across the
   82-column table, hit-test one long-header column's button centre, and
   confirm a visible focus ring on a focused long-header pin button — in both
   themes. A computed-style read or the CSS declaration's existence is not
   evidence.

2. **NON-BLOCKING (fix while in there) — undeclared widening of three
   pre-existing controls.** `DataGrid.css` coarse-pointer media query: the
   added `min-width: 44px` applies to the **whole shared selector list**, so it
   also newly constrains `.ui-data-grid__filter-input`,
   `.ui-data-grid__filter-toggle-btn` and `.ui-data-grid__filter-clear-all-btn`
   (HEL-451 elements), which previously had only `min-height: 44px`. The
   adjacent comment reads as if it affects the pin toggle alone. Either give
   `.ui-data-grid__pin-toggle-btn` its own rule for the `min-width`, or state
   explicitly that widening the three siblings is intended.

### Non-blocking notes

- `tasks.md` 4.1–4.4 and 5.3–5.5 are still unchecked. 4.1, 4.2 (spot-checked
  via the unpin/re-read probe), 4.3, 5.3, 5.4 and 5.5 are all satisfied by the
  evidence in this report and can be ticked at archive once CR1 lands.
- The `DataGrid.css` / `design.md` sentence "Verified live by the skeptic at a
  non-zero `scrollLeft` (600px) in both themes, spanning header, filter row and
  body rows" ran slightly ahead of skeptic-final-2's actual probe (which was one
  theme at `scrollLeft: 600`). It is **now true** — this round supplies exactly
  that evidence — so no edit is required, but note it was written before it was
  fully earned.
- `color-mix(in srgb, var(--app-text) 35%, transparent)` for the separator is
  the established in-repo scroll-affordance colour (PipelineListTable.css,
  ConnectorsPage.css, SourceListTable.css, …), theme-derived, and it reads
  correctly and subtly in both themes in the screenshots. Appropriate; no
  change wanted.
- Visual cohesion otherwise good: pinned pin icons use the accent-text token and
  sit consistently with the existing sort chevrons; the frozen region reads as
  panel chrome in both themes.
