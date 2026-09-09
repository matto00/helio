## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Fresh cold agent. HEAD `73a2dd0c`, merge-base with `origin/main` = `36a9c1cc` (note: `origin/main`
has since advanced to `3a0c0fe8`; branch is NOT rebased — see non-blocking notes).

### What I verified (with evidence)

**Ground truth / provenance**
- `git diff --stat origin/main...HEAD` (three-dot): 33 files, 4325+/64-. The two-dot diff is
  misleading here because main moved; I used the merge-base diff throughout.
- Content self-authentication BEFORE any observation: `curl http://localhost:5883/src/shared/ui/DataGrid.tsx`
  contains `ui-data-grid__filter-toggle-row` (1 hit) and the served `DataGrid.css` contains
  `ui-data-grid__filter-row--quick`; `git grep -c 'ui-data-grid__filter-row' origin/main -- frontend`
  returns nothing (0 files). The server on 5883 is serving THIS branch.
- `scripts/concertino/assert-phase.sh servers … 5883 8790` → `PASS servers`.
- `npm --prefix frontend test` (the arm that actually scans, not root `npm test`):
  280 suites / 2918 tests passed.

**The cycle-4 truncation-group reset — did it break what the group protects?**
- The reset (`DataGrid.css:261-267`) is scoped to exactly three selectors
  (`.ui-data-grid__table .ui-data-grid__filter-row--quick th`,
  `… .ui-data-grid__filter-toggle-row th`, `… tbody .ui-data-grid__empty-row`). Ordinary
  `tbody td` and `thead th` keep `white-space: nowrap` / `max-width: 240px` / `overflow: hidden` /
  `text-overflow: ellipsis` untouched — verified in the live DOM: data cells still ellipsize, header
  titles still truncate, `table-layout: fixed` + the resize handle are unaffected. No regression from
  the group reset. This part of the CR was answered correctly and at the class level.
- Round-1 and round-2 fixes still hold at their own fixtures: on the 75/82-column Output at
  `gridWidth 501`, the filtered-empty disclosure measures `right: 778` inside `gridRect.right: 798`,
  wraps to two lines, and both `Clear filters` / `Load more` are visible; the toggle row's badge and
  `Clear all` stay pinned at `scrollLeft` 0 and max.

**Coverage limits — checked, both honest**
- Density: `TableRenderer` never passes `density`; `resolvedDensity = density ?? DEFAULT_DENSITY[variant]`
  (`DataGrid.tsx:171`) and no call site on this surface supplies one. The limit is real, not an evasion.
- Single unbroken token: `overflow-wrap: anywhere` is present; no live content exercises it. Fairly
  declared as defence-in-depth.

**New data shape I chose (none of rounds 1-3 reached it): the SAME panel after a viewport/panel
WIDTH CHANGE.** Prior rounds all measured a freshly-mounted grid at a fixed width. That is where the
defect below lives.

### Verdict: REFUTE

This is a third defect on the empty-state/colSpan surface, and it is the SAME failure mode round 2
found (message clipped and unreachable because the sticky-pinned wrapper is wider than the scroll
viewport). Per the round-3 cap, I am reporting it plainly rather than softening it: the cycle-4 fix
is correct at mount and silently wrong afterwards.

### Change Requests

1. **`stickyCellMaxWidth` is measured once per dependency change and never re-measured when the
   scroll viewport's width changes, so the round-2 clipping defect returns on any resize.**
   `frontend/src/shared/ui/DataGrid.tsx:269-297`: the `useLayoutEffect` that sets
   `setStickyCellMaxWidth(viewportWidth - 32)` depends on
   `[filterable, filterExpanded, resolvedColumns.length, resolvedDensity, scrollRef]`. None of those
   track the container's width, and `DataGrid` registers no `ResizeObserver` and no `window` resize
   listener of its own (`grep -n "ResizeObserver|resize" DataGrid.tsx` → no hits). The sibling
   `useScrollEdges` hook — used a few lines above, for the same `scrollRef` element — has exactly that
   plumbing (`window resize` + `ResizeObserver` on the container and its children); the new
   measurement does not reuse it. The value therefore only refreshes by accident, when the visible
   column count happens to change.

   Reproduced live, three times, in different sequences (dev server self-authenticated as this
   branch, dashboard `SKF2-82col`, quick filter `zzzznomatch` → filtered-empty):
   - fresh load at vw 1440 → `maxWidth 469px`, grid 501px, cell right edge 20px INSIDE the grid (correct);
     resize to vw 800 → 398px (recomputed, still correct); resize to vw 480 → grid 366px but
     `maxWidth` still **398px**, cell overflows the grid's right edge by **+44px** at `scrollLeft: 0`;
   - vw 900 → vw 520: `maxWidth` stale at 414px, grid 406px, overflow **+20px**;
   - vw 1440 → 900 → 520: `maxWidth` stale at 494px, grid 406px, overflow **+100px**, and at
     `scrollLeft = max` the wrapper is still pinned at `left: 0` with the tail 88px outside the
     viewport — i.e. unreachable at EVERY scroll position, verbatim the round-2 finding.

   Screenshots (no programmatic scrolling in the second): the disclosure renders as
   `"No rows match your filter in the 200 rows loaded so far. More r"` / `"…so far"` with the tail cut
   at the panel edge, and the quick-filter input overflows the same edge.
   - `.concertino/runs/HEL-451/evidence/sk3-02-stale-clip.png` (vw 520, +100px overflow)
   - `.concertino/runs/HEL-451/evidence/sk3-03-stale-480.png` (vw 480, +44px, `scrollLeft: 0`)

   Real triggers, not contrived: browser window resize, the sidebar collapse (I observed the grid
   change from 430px to 582px at vw 700 from that alone), a react-grid-layout panel drag-resize,
   breakpoint changes, and device rotation — all change `.ui-data-grid`'s `clientWidth` without
   changing any dependency in that array.

   The existing guard does not catch this: `DataGrid.test.tsx:880-932` stubs `clientWidth` once and
   asserts the mount-time value (`300 - 32 → 268px`). Nothing exercises a width change after mount.

   **Required:** re-measure the viewport width whenever it changes (a `ResizeObserver` on `scrollRef`
   — ideally by extending/reusing `useScrollEdges`, which already observes exactly that element, rather
   than adding a second observer), plus a mutation-failable test that changes `clientWidth` after the
   first render and asserts the inline `maxWidth` follows. Note the CSS fallback cannot cover this:
   `max-width: 100%` on `.ui-data-grid__sticky-cell` resolves against the `colSpan` cell (the whole
   table width, measured at 12,160px on this fixture), not the viewport, so the inline measured value
   is the only bound that exists.

### Non-blocking notes

- Recommendation, offered as the round-3 conclusion the brief anticipated: this is the third
  iteration of the same geometric failure on the same wrapper, each fix correct against its prompting
  observation and wrong against a condition nobody had varied yet (scroll position → viewport width →
  viewport width OVER TIME). The remaining defect is small and well-localized, but the pattern
  suggests the sticky/colSpan/measured-width cascade deserves one human reading end to end rather
  than a fifth cycle.
- The branch is not rebased onto current `origin/main` (`3a0c0fe8`, HEL-441 motion tokens + guard).
  The new controls do use `var(--app-transition)`, so the guard should pass, but it has not actually
  run against this diff in this worktree. Re-run `motionTokenGuard.css.test.ts` after the rebase.
- Cosmetic: `DataGrid.css` and `DataGrid.tsx` now carry very long historical review-narrative
  comments (several 20+ line blocks recounting prior rounds). They document real root causes, but
  consider condensing to the mechanism and dropping the round-by-round chronology before merge.
