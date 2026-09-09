## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold agent. Every conclusion below is derived from the diff, the test suite I ran myself,
mutations I applied myself, and the running app at `:5883` (asserted). Screenshots are at
`/home/matt/Development/helio/skf-0*.png` (repo root — `.gitignore:42` ignores `*.png`; the
move into `.concertino/runs/` was blocked by the permission classifier, so they stay there).

### What I verified (with evidence)

**Ground truth.** `git diff origin/main...HEAD` = 31 files, +3633/−64; HEAD `2f409859` on
`4765bc66`, base `36a9c1cc`. Read the full bodies of `TableRenderer.tsx`,
`LoadedScopeDisclosure.tsx`, `DataGrid.tsx`, `tableFilterPredicate.ts`, `outputConfigTypes.ts`,
both CSS diffs, and the wiring diffs.

**Gates re-run by me, not inherited.** `npm --prefix frontend run lint` (0 warnings),
`typecheck` (clean), `format:check` (clean), `npm --prefix frontend test` →
**280 suites / 2912 tests passed**. Matches the executor's claim exactly.

**The design correction (the headline item) is right, and guarded.** I re-derived the
disclosure truth table from `TableRenderer.tsx:355-385` + `LoadedScopeDisclosure.tsx` myself:

| filtering | rowsTruncated | isEmpty | rendered |
|---|---|---|---|
| f | f | f | nothing (`showLoadedScopeNote=false`, `showLoadMoreBtn=false`) |
| f | t | f | "Sort covers only the loaded rows." + Load more iff `onLoadMore` |
| t | f | f | "N results." (unqualified — every row is loaded, so it is a true count) |
| t | t | f | "N of M loaded rows match." + Load more iff `onLoadMore` — **exactly one** message |
| f | any | t | unreachable in the grid branch (`normalizedRows` non-empty ⇒ `sortedRows` non-empty when not filtering) |
| t | f | t | "No rows match your filter." + Clear filters |
| t | t | t | "…in the N rows loaded so far. More rows may match…" + Clear filters (+ Load more iff present) |

No fourth wrong state. `showLoadedScopeNote = rowsTruncated || filtering` is correct and the
wrapper stays derived from its children. **Mutation-verified by me**: reverting it to the
original `rowsTruncated && !filtering` turns **3 tests red** in `TableRenderer.test.tsx`
(e.g. `:644` "1 of 2 loaded rows match."). Not a comment, a red.

**Sticky offsets are MEASURED, and correct live.** `useLayoutEffect` +
`getBoundingClientRect` per row (`DataGrid.tsx:216-249`). Live on `:5883`, 44-column Output:
`top` = **0 / 34.5 / 79.5 / 124.5px**, distinct and increasing. Scrolled to `scrollTop=120`
the four rows occupy 137–171.5 / 171.5–216.5 / 216.5–261.5 / 261.5+ — the column header is
**not** covered. **Mutation-verified**: forcing all three offsets to `0` turns 2 tests red in
`DataGrid.test.tsx`. The garbled `DataGrid.css` comment is gone, replaced by a rule stating
the scheme and carrying no `top`.

**Token typo fixed, no other dangling token.** `--weight-normal` survives only inside the
explanatory comment (`DataGrid.css:271`). Every `var(--*)` introduced by the two CSS diffs
(21 distinct tokens) resolves in `theme/theme.css`; all colour tokens are defined in both
`[data-theme="dark"]` and `[data-theme="light"]`.

**Tasks 2.3 / 4.5 have real coverage.** `rawRows` appears 31× in `TableRenderer.test.tsx`,
including the named `2.3 PROOF` filter-then-sort test (`:592`) and all five `4.5 rawRows:`
state tests (`:619-660`). Not checked boxes over nothing.

**D9a shared removal seam is real, not asserted.** `grep LoadedScopeDisclosure` returns one
component file, one import, one JSX site, plus one CSS rule (`.panel-content__loaded-scope-note`).
Both qualifier strings live inside that one component's `if`/`else` chain. Deleting the file +
its call site + that rule is the whole removal. The old `.panel-content__truncation-note` /
`.panel-content__load-more` class names have no residual references.

**D6 persistence, verified against REAL data the loop never touched.** I deliberately avoided
`hel904-output-e2ee1b2e-…`. I used Output `hel904-orphan-output-ae5b18b6-…` ("HEL-599 Sleeper
WR probe rows", 1000 `node_snapshots` rows, 44 columns, real Sleeper/rotowire data, nulls,
map-classified `player.metadata` stored as a JSON string, owned by `matt@helio.dev` so
`canWrite` is true). After typing a quick filter, `psql` shows:
`{"columnSort": {...}, "columnFilters": {"quick": "zzznomatch"}}` — the **minimal patch
preserved `columnSort`**, proving no `output.config` spread and no lost update. Re-opening the
panel in the detail modal re-seeded the filter and auto-expanded the chrome. (I restored the
row's original config afterwards — the `psql` UPDATE was blocked by the permission classifier,
so `columnFilters: {"quick":"wr"}` remains on that dev row as harmless residue.)

**HEL-448's re-gate genuinely fixed, live.** The detail modal now renders
"200 of 200 loaded rows match." (`skf-06-modal-light.png`) — that surface rendered *nothing*
before `4765bc66` — and renders **no** Load-more button there. On the dashboard grid,
"Sort covers only the loaded rows." + a live Load more (`skf-01-dashboard.png`).

**Filter chrome / toggle.** One toggle row, always rendered while `filterable`. Collapsed with
a filter active it shows `Filters (1)` in the accent treatment plus a reachable "Clear all"
(`skf-04`). Auto-expands on mount when a persisted filter is active (confirmed live in the
modal). Both the quick row and the per-column row sit behind that one toggle, as ruled.

**`usePanelData`'s `String(v)` is untouched** — the diff adds only `rowsTruncated`. HEL-1033
still owns it.

**No console errors** across the whole session (0 errors, 0 warnings).

---

### Verdict: REFUTE

One root cause, three user-visible symptoms, all found only by pointing the feature at a real
44-column Output. Every unit test stays green; jsdom has no layout engine, so nothing in the
suite can see any of this. It is the same evidence channel that caught the `top: 0` collapse
in cycle 1.

**Root cause.** `DataGrid`'s `<table>` is `table-layout: fixed` with `DEFAULT_COLUMN_WIDTH =
160px` per column, so on this Output the table is **12,160px wide** inside a 501px scroll
region. Every `colSpan={resolvedColumns.length}` cell this ticket adds — the filter-toggle
`<th>`, the quick-filter `<th>`, and the filtered-empty `<td>` — inherits that full 12,160px
width instead of being bounded to the visible scroll viewport. None of the three is
horizontally sticky.

### Change Requests

1. **The filtered-empty message is cut mid-word — the ticket's sharpest obligation fails on
   real data.** `DataGrid.tsx:479-484` (`.ui-data-grid__empty-row`). Measured live: the `<p>`
   is **12,136px** wide (`right: 12445px`) inside a region whose right edge is at `798px`. The
   user reads *"No rows match your filter in the 200 rows loaded so far. More rows may mat"* —
   the load-bearing half ("…match — load more to widen the search.") is off-screen and requires
   horizontal scrolling to discover. See `skf-04-empty-clipped.png` (dark) and
   `skf-05-light-empty.png` (light); identical in the detail modal. The whole point of D5 was
   that this state must not be a confidently-wrong answer; a sentence truncated exactly where
   it stops meaning "no results" and starts meaning "your sample is partial" is not the
   disclosure that was designed. Constrain the empty-cell content to the visible scroll
   viewport (the standard pattern: `position: sticky; left: 0` on the cell's inner wrapper,
   width bounded by the region rather than the table) so the message wraps and is fully
   readable at scroll-x 0 and at any scroll-x.

2. **The quick-filter input is 12,136px wide.** `DataGrid.tsx:518-529` — `width: 100%` inside
   the same `colSpan` `<th>`. Its right border and the focus ring's right edge never exist on
   screen (visible in `skf-03`/`skf-04`: the accent outline runs off the panel edge with no
   terminating stroke), and once the user scrolls right the input reads as an empty full-bleed
   box. This is not token-compliance — it is an off-pattern control an experienced eye rejects.
   Same fix as CR1: bound the quick input to the visible region rather than the table width.

3. **Horizontally scrolled, the active-filter indicator and "Clear all" vanish — defeating
   task 3c.2's own guarantee.** The toggle row's `<th>` is `position: sticky` on `top` only.
   Measured at `scrollLeft = 900` (a modest scroll on a 12,160px table): the `Filters (1)`
   button's rect is `left: -591 → right: -515.9` against a region spanning `297 → 798` —
   **entirely off-screen**. The per-column filter inputs remain visible, so what the user sees
   is a table that is silently filtered with no active-count cue and no reachable clear action.
   3c.2 states the requirement as unconditional ("MUST: indicate filters are active AND how
   many … make 'clear all filters' reachable WITHOUT expanding"), and horizontal scroll is the
   normal state for these tables, not an edge case. Making the toolbar content
   `position: sticky; left: 0` inside its cell resolves this and CR1/CR2 together.

None of these needs a design re-open: the markup shapes ruled in D4d/D5 are kept, only the
cell contents are bounded to the scroll viewport.

### Non-blocking notes

- `.ui-data-grid__filter-toggle-btn` has hover colour changes but no `transition`, while its
  sibling `.panel-content__clear-filters-btn` does. Minor inconsistency inside one feature.
- `.ui-data-grid__filter-toggle-btn` / `__filter-clear-all-btn` have no `:focus-visible` rule
  (the inputs do), so they fall back to the UA ring rather than `--app-focus-ring`.
- `readColumnFilters` (`outputConfigTypes.ts`) treats an array `columnFilters` as an object and
  returns `{}` rather than `undefined`. Harmless (`isFiltering({})` is false), but the
  docstring says "a non-object value yields `undefined`", which an array is not.
- **No test guards either `rowsTruncated` call site.** I mutated both
  `PanelDetailModal.tsx:417` and `PanelCard.tsx:118` to `rowsTruncated={false}` and all
  542 `src/features/panels` tests stayed green. The code is correct at both sites and no task
  required a call-site test (4.0d/4.0e are renderer-level and *are* mutation-failable), so this
  is not blocking — but it re-creates the exact unguarded seam that let HEL-448's inversion ship
  unnoticed, and this lane's round-2 lesson is about that class. Worth one assertion per site
  when CR1–CR3 are addressed.
- Light theme on a panel carrying an explicit dark appearance shows a light header/filter band
  over dark rows. Pre-existing — the HEL-448 sort header and the load-more button behave
  identically; this ticket's chrome matches its neighbours, so I am not treating it as a third
  variant. Flagging it only so it is not mistaken for new.
