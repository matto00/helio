## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `bce96c9a` (HEL-458 Virtualize DataGrid full-variant row rendering).
Base noise: `main..HEAD` also contains `dae1117e` (HEL-465) and `88c0b26b` (HEL-1064); those are
base commits, not this change, and were excluded from review.

### Phase 1: Spec Review — PASS

- AC1 (bounded/stable DOM node count while scrolling): implemented, and verified LIVE by this
  evaluator (see Phase 3) — the executor's honest gap on task 3.3 is now partially closed by my
  own measurement, at 200 rows rather than "several thousand" (see Non-blocking #1).
- AC2 (density, widths, resize, sort, filter, pinning under windowing): implemented; pinning +
  windowing verified live (Phase 3). No automated coverage of pinning-under-windowing exists
  (Change Request #2).
- AC3 (small-table bypass): implemented (`variant === "full" && rows.length >
  VIRTUALIZATION_ROW_THRESHOLD`, DataGrid.tsx:589) with boundary tests at the threshold and at
  threshold+1.
- AC4 (no horizontal-scroll / column-collapse regression): verified live (Phase 3).
- AC5 (Jest/RTL coverage + a11y semantics): present and meaningful (DataGrid.test.tsx:1539-1731).
- Design D1-D7 all implemented as written (hand-rolled hook, flow-layout spacer `<tr>`s, measured
  density row height with bounded pre-measurement estimate, exported threshold, aria-rowcount/
  aria-rowindex + `aria-hidden` spacers, spacer-cell geometry class + explicit `--no-border` on the
  true last mounted row, shared `useScrollEdges` ref).
- tasks.md accurately reflects reality: 3.3 is left unchecked and files-modified.md flags the live
  gap explicitly rather than claiming it. That honesty is the correct behavior and is noted, not
  penalised.
- No scope creep in the commit: only `DataGrid.tsx`/`DataGrid.css`/`DataGrid.test.tsx`/
  `useVirtualRows.ts` plus the change directory.

**Stray-directory deletion — verified harmless.** `openspec/changes/elevation-border-radius-
normalization/` was never tracked: `git log --all -- <path>` returns nothing, and the real change
exists on `main` as `openspec/changes/archive/2026-09-08-elevation-border-radius-normalization/`
(11 tracked files, identical on `main` and `HEAD`). The deleted directory was untracked debris of
an already-archived change; `git status` is clean and no commit records the deletion. Accepted.

### Phase 2: Code Review — PASS (with one behavioral finding carried to Phase 3)

Gates re-run fresh by me in `WORKTREE_PATH` (not trusting the executor's report):
- `npm run lint` — PASS (zero warnings)
- `npm run format:check` — PASS
- `npm test` — PASS (frontend 299 suites / 3191 tests; helio-mcp 25 suites / 248 tests)
- `npm --prefix frontend run build` — PASS (dist + PWA emitted)
- No `backend/**` files changed → `sbt test` not applicable.

Checklist: DRY (hook extracted, existing `useScrollEdges` ref reused per D7), readable (every
constant carries a design-citing comment; no magic values — `VIRTUALIZATION_ROW_THRESHOLD` and
`ROW_HEIGHT_ESTIMATE_PX` are named and derived from documented token values), modular, fully typed
(no `any`, no non-null escapes), no dead code, no TODO/FIXME, no over-engineering, no security
surface (pure rendering). CONTRIBUTING.md import/qualifier rules and DESIGN.md mechanical rules
(no new hardcoded colours/spacing; spacer CSS only zeroes inherited geometry) are satisfied.

Behavioral finding (root cause probed, detail and live evidence under Phase 3): `useVirtualRows`
reads `clientHeight` only on mount (`useLayoutEffect`) and on `scroll`
(`useVirtualRows.ts:57-72`). There is no `ResizeObserver`, so a container that grows taller
without an intervening scroll keeps a window sized for the OLD viewport. → Change Request #1.

Two pre-existing `// eslint-disable-next-line react-hooks/set-state-in-effect` directives were
removed (DataGrid.tsx:515, :547). Probed: re-adding them makes `npm run lint` fail with
"Unused eslint-disable directive" ×2, while `main`'s version of the file lints clean WITH them —
so the removal is forced by the zero-warnings policy, not gratuitous. Accepted, with a
documentation nit (Non-blocking #2).

### Phase 3: UI Review — FAIL

Servers: `start-servers.sh` READY, `assert-phase.sh servers` → `PASS servers`. Console errors
during every flow tested: **0**.

Verified working, live, against a real windowed table panel ("Projections 2026 table",
`aria-rowcount=201`, 75 columns):

- **AC1 — stable, bounded DOM node count.** At scrollTop 0 / 1711 / 3422 / 5132 / 6843 the mounted
  data-row count was 26 / 26 / 26 / 26 / 15 (15 only because the bottom of the list was reached),
  out of 200 rows. `scrollHeight` stayed constant at 7034px at every position — no scrollbar drift,
  confirming the D6 spacer-geometry decision works in a real browser.
- **aria-rowindex** advanced correctly and window-independently (2→27, 40→65, 89→114, 138→163,
  187→201); spacer rows carried `aria-hidden="true"` and no `aria-rowindex`.
- **AC2 — pinning under windowing (the sharpest interaction per the brief).** With two columns
  pinned and the grid scrolled to `scrollLeft=3000, scrollTop=2000` (i.e. on rows mounted *after*
  the pin), body cells kept `position: sticky` with `left: 0px` / `left: 160px` and rendered at
  x=297 / x=457 — exactly matching the header cells' offsets. No drift, no unstyled cell.
- **AC2 — sort** re-windowed correctly (62 rows mounted, `aria-rowcount` and `scrollHeight`
  unchanged). Scrolling after sort updated the window (firstIdx 33).
- **AC4 — no horizontal-scroll / column-collapse regression.** 75 columns × 160px = `scrollWidth`
  12000 against `clientWidth` 731; widths held identically while windowed.
- **Breakpoints** 1440 / 1100-equivalent / 768 / 430: grid renders correctly at each, window
  recomputes on breakpoint change (33 rows for a 432px viewport = ceil(432/35)+20, correct), and
  `document.documentElement.scrollWidth` never exceeds the viewport at 430 (no page-level
  horizontal overflow).
- HEL-1065's two known pin-toggle defects were not re-checked as in-scope; nothing new was
  introduced on that surface.

**Failing check — in-place panel resize leaves a blank strip (Change Request #1).** Dragging the
panel's `react-resizable-handle` to grow the grid from `clientHeight` 121px → 1451px, with no
scroll event in between, left the mounted window at 36 rows: the last mounted row's bottom edge
sat **159px above** the grid's bottom edge — a visible blank strip inside the scroll region while
~150 rows remained below. A single 1px scroll (`scrollTop 2 → 3`) immediately corrected it to 62
rows and gap 0. This is a windowed-vs-unwindowed divergence (unwindowed rendering can never show
one), so it violates `specs/data-grid/spec.md`'s "Windowing SHALL NOT change the externally
observable behavior" requirement, and panel resize is a first-class dashboard interaction.

### Overall: FAIL

### Change Requests

1. **`frontend/src/shared/ui/useVirtualRows.ts:57-72` — re-measure the viewport on container
   resize, not only on mount and scroll.** Attach a `ResizeObserver` to `scrollRef.current` (created
   in the same `useEffect` that adds the `scroll` listener, gated on `enabled`, disconnected in the
   same cleanup) calling the existing `measure()` callback. Probe-confirmed root cause:
   `viewportHeight` is captured once at mount and thereafter only inside the `scroll` handler, so a
   grow-without-scroll leaves `visibleCount = ceil(oldViewportHeight / rowHeight)`. Live repro on
   this branch: enlarge a >150-row table panel via its grid resize handle from ~121px to ~1451px
   without scrolling → 159px blank strip below the last mounted row; one scroll event fixes it.
   Add a Jest/RTL guard that stubs the container's `clientHeight`, renders above the threshold,
   then increases `clientHeight` and fires a `ResizeObserver` callback (or the hook's own
   `measure` path), asserting the mounted row count grows to cover the new viewport — confirm it
   is red against the current tree first.

2. **`frontend/src/shared/ui/DataGrid.test.tsx` — add automated coverage for pinning under
   windowing (AC2's sharpest interaction).** Today every pinning test uses a small (bypassed)
   table and every windowing test uses unpinned columns, so no test would catch a regression that
   drops `ui-data-grid__pinned-cell` / the `left` offset on windowed rows. Add a case rendering
   `variant="full"` with several thousand rows AND pinned leading columns at a deep scroll
   position, asserting the mounted rows' leading cells carry `ui-data-grid__pinned-cell` and the
   same cumulative `left` offsets as the header cells. (I verified this live and it is correct
   today — the request is for the guard, not a fix.)

3. **`openspec/changes/virtualize-table-rows/tasks.md` task 3.3 — close out the live pass.** My
   Phase-3 run above supplies the live evidence for AC1/AC2/AC4 at 200 rows across scroll positions,
   pinned columns, sort, and four breakpoints; cite it (evaluation-1.md, Phase 3) rather than
   leaving 3.3 open, and state explicitly that the largest live table available in the dev
   environment was 200 rows, not "several thousand" — do not mark it done as if the several-
   thousand-row case were measured.

### Non-blocking Suggestions

- The live table available in the dev DB has 200 rows (just above the 150 threshold). Nothing in
  the windowing math is row-count-sensitive beyond what was measured, but the ticket's literal
  "several thousand" figure remains unmeasured in a real browser; the Jest suite does cover 5,000
  rows.
- `DataGrid.tsx:512-515` and `:544-547` still carry comments explaining why the (now removed)
  `set-state-in-effect` disable was justified. Reword them, and note that the rule stopped
  reporting these two sites after this change — a small, silent loss of lint coverage on
  pre-existing code that is worth a sentence so a future reader does not re-add the directive.
- `useVirtualRows`'s `overscan = 10` default is the only un-cited tunable in the new code; a
  one-line comment on why 10 (it is also what masks smaller resizes) would match the standard set
  by every other constant in this diff.
