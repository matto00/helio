## Skeptic Report — design gate (round 4, skeptic-design-5.md)

Scope: stress-test D10 (the owner-authorized reframe) BEFORE implementation. D10a and the
authorization of the reframe itself are settled and not re-litigated.

### What I verified (with evidence)

- `DataGrid.tsx:402` — `<div className={rootClasses} role="region" ... ref={scrollRef}>` with
  `<table>` its only child. D10's premise is CORRECT.
- `DataGrid.tsx:267`, `:269-297` — `stickyCellMaxWidth` + the `useLayoutEffect`; deps
  `[filterable, filterExpanded, resolvedColumns.length, resolvedDensity, scrollRef]` track no width.
  D10's finding-3 description is CORRECT.
- `:481-497` toggle row, `:534-545` quick row, `:554-559` per-column row, `:580-587` filtered-empty
  `colSpan` `<td>`, `:263-265` the three row refs. All line refs in D10 check out at HEAD.
- `DataGrid.css:63` `table-layout: fixed` scoped to `--full`; `:75-81` thead-th truncation,
  `:122-128` `tbody td` truncation (`max-width: 240px` is tbody-only); `:260-267` the consolidated
  truncation-group reset from `73a2dd0c`, whose selector list is EXACTLY the three cells D10 removes;
  `:228-240` `.ui-data-grid__sticky-cell`.
- `DataGrid.test.tsx:405-455`, `:866-935` — the two mutation-failable guards `73a2dd0c` added
  (`sticky-cell` wrapper placement; JS-computed inline `maxWidth === "268px"`).
- `TableRenderer.tsx:430-443` renders `<DataGrid>` with NO `className`; `PanelContent.css:50-52`,
  `:110-116` — `.panel-content--table` is itself `overflow-y: auto`, `flex-direction: column`,
  `min-height: 0`, and `.ui-data-grid` inside it has NO height cap.
- `DataGrid.tsx:376-388` — the un-filtered empty path early-returns a bare `<p>` (or an existing
  `.ui-data-grid__empty-wrap`), i.e. the table shell renders ONLY on the filtered-empty path.

### Answers to the seven probes

1. **Does the measurement die?** Yes — with the toggle, quick and empty cells gone, no `colSpan`
   cell remains, `table-layout: fixed` no longer produces any 12,160px-wide element, and the
   sibling chrome is naturally container-width. `stickyCellMaxWidth` genuinely ceases to exist.
   Residual measurement: `stickyOffsets.columns` (a HEIGHT, not a viewport width) survives — that is
   fine and is not the finding-3 class. So D10 is a real fix, not a relabelling — subject to the
   defects below.
2. **Vertical sticky.** REGRESSION as specified, for two compounding reasons — see CR1 and CR2.
3. **`--columns` stays in the table.** Confirmed correct: its `<th>`s are per-column and must align
   to `table-layout: fixed` column widths. `stickyOffsets.columns` is still needed, and after the
   toggle/quick rows leave it collapses to `headerRowRef` height alone; removing `toggleRowRef`
   does not break it (it stops being a term in the sum). Deps must lose `filterExpanded`? No —
   keep it, the row's existence is still gated on it; but see CR5 for the deps note.
4. **The `73a2dd0c` reset.** D10 is FACTUALLY WRONG here — see CR3.
5. **Owner condition.** Preserved in principle, but the specified placement defeats it — see CR1.
6/7. Covered by the CRs; everything else in D10 checks out against HEAD.

### Verdict: REFUTE

D10 is the right direction and its core claim (the measurement dies) holds. It has four concrete
defects and two unspecified branches that would each reach the final gate as a finding.

### Change Requests

1. **Placement is wrong: the toolbar and quick filter must render BEFORE the scroll container, not
   after.** D10's tree puts all three siblings after `.ui-data-grid`. In a dashboard panel the real
   vertical scroller is the ANCESTOR `.panel-content--table` (`PanelContent.css:50-52`,
   `overflow-y: auto`) and `.ui-data-grid` has no height cap — so chrome placed after a tall table
   is pushed below the fold and is invisible until the user scrolls to the bottom. That directly
   defeats D4d's owner condition ("collapsed MUST NOT hide an active filter"): a filtered table
   would look unfiltered on first paint. It also breaks reading/tab order — the `aria-expanded`
   toggle must precede the content it controls. Required: toolbar and quick-filter BEFORE the
   scroll container; only the filtered-empty message after it.
2. **D10 asserts a behaviour change it has not established: name the actual vertical scroll
   ancestor per surface.** D10 reasons as if `.ui-data-grid` is the vertical scroller. In the
   dashboard panel it is not (CR1). In `PanelDetailModal` it may be. Until that is established by
   measurement, the claim "sticky chrome becomes always-visible chrome" is unverified in one surface
   and possibly false in the other (where moving out of the scroller could make chrome scroll away
   that previously stayed pinned). Required: state, per surface, which element scrolls vertically,
   and state explicitly what the post-D10 vertical behaviour of the toolbar is. If the chrome must
   stay visible while rows scroll on BOTH surfaces, say so and specify how (e.g. the wrapper becomes
   the flex/height owner and `.ui-data-grid` gets the vertical scroll) — that is a second geometric
   decision D10 currently leaves implicit.
3. **The truncation-group reset becomes fully dead, not partially surviving.** D10 says "the reset
   remains ONLY where a `colSpan` cell still exists". At HEAD the reset's selector list
   (`DataGrid.css:260-262`) is exactly `.ui-data-grid__filter-row--quick th`,
   `.ui-data-grid__filter-toggle-row th`, `tbody .ui-data-grid__empty-row` — all three are removed
   by D10, so ZERO remain. Required: state that the whole reset rule AND `.ui-data-grid__sticky-cell`
   (`:228-240`) are DELETED, plus their explanatory comment blocks (`:193-227`, `:242-259`,
   `:393-411`). Also confirm explicitly that this cannot damage ordinary data-cell truncation: the
   reset never applied to `tbody td` generally, and the per-column filter `<th>`s were never in the
   group (`max-width: 240px` is `tbody td`-only), so ordinary truncation is untouched.
4. **D10 does not dispose of the two mutation-failable Jest guards from `73a2dd0c`.**
   `DataGrid.test.tsx:405-455` and `:866-935` assert the sticky-cell wrapper's existence and the
   inline `maxWidth === "268px"`. Under D10 they must fail or be deleted. A deletion with no
   replacement silently removes the only failable evidence on this surface. Required: name these
   tests, delete them, and specify the replacement guards for the new invariants — at minimum
   (a) no element inside `<table>` carries `colSpan`, (b) no inline `maxWidth` is computed anywhere
   in `DataGrid` (the failable form of the success criterion), (c) the toolbar renders as a sibling
   BEFORE `.ui-data-grid` in DOM order.
5. **Unspecified branch: what renders when `rows.length === 0 && filtering` after D10?** D5's whole
   point (`DataGrid.tsx:370-388`) was that a filtered-empty result falls through to the FULL grid
   shell so the per-column inputs stay visible and editable. D10 removes the message from the table
   but never says whether the shell still renders. An executor could reasonably restore the
   `<p>` early-return and thereby delete the per-column filter row exactly when the user most needs
   it. Required: state that the filtered-empty path still renders the grid shell (header row +
   per-column filter row, empty `<tbody>`), and specify what an empty `<tbody>` looks like (height,
   borders) so it is not a 0px sliver.
6. **The wrapper's contract with consumers is unspecified.** Required in D10: which element receives
   the `className` prop and the `--full`/`--condensed`/`--scroll-left`/`--scroll-right` modifiers
   (existing tests query `.ui-data-grid` for `--condensed`, e.g.
   `SourceDetailPanel.test.tsx:88`, `SqlTab.test.tsx:75`); that `.ui-data-grid--full
   .ui-data-grid__table` and the scroll-shadow/`border-radius` rules stay on the scroll container;
   and that the wrapper carries `min-width: 0` / `min-height: 0` so it is safe as a flex item.
   Also note the name collision risk: `.ui-data-grid__empty-wrap` already exists
   (`DataGrid.tsx:383`) — pick a wrapper name that cannot be confused with it.

### Non-blocking notes

- Invariants 1–6 are the right set for the NON-geometric surface, but the list protects nothing
  geometric, which is precisely the axis D10 changes. Consider adding a 7th: "no element inside
  `<table>` spans more than one column" — the single sentence that, if held, makes findings 1–3
  structurally unreachable.
- The `stickyOffsets` deps comment (`:290-296`) will need rewriting once `toggleRowRef` and the
  quick row leave; `filterExpanded` remains a legitimate dep only if the columns row's presence can
  change the header's measured height, which it cannot — keep it for correctness of the gate, but
  say why in the comment rather than leaving the stale rationale.
