## Skeptic Report — design gate (round 5, skeptic-design-9.md)

Cold read. Every claim below was derived from source at HEAD (`61cba49a`), not from
the design's or the prior rounds' narrative.

### What I verified (with evidence)

**Round 4 CR1 (the ninth assumption) — applied, and applied correctly.**

- `.panel-content__disclosure` is `flex-shrink: 0` — `frontend/src/features/panels/ui/renderers/TableRenderer.css:18-25`
  (`flex-shrink: 0` at `:24`). The sibling hazard D10-3a now names is real at source.
- The frame really will be a direct flex child alongside it:
  `TableRenderer.tsx:429` renders `<div className="panel-content panel-content--table">`
  containing `<DataGrid variant="full" …>` and, at `:449`, `<div className="panel-content__disclosure">`.
  No intermediate wrapper — D10-3's "the frame becomes the flex item of `.panel-content--table`" holds.
- The withdrawn claims are correctly withdrawn. `PanelContent.css:110-116`
  (`.panel-content--table`) sets `flex-direction: column; justify-content: flex-start;
  align-items: stretch`, overriding `.panel-content`'s `align-items: center;
  justify-content: center` (`:1-8`). So (i) `width: 100%` on the frame is indeed
  unnecessary — a column flex with `align-items: stretch` already gives full width —
  and (ii) vertical centring of a short table was indeed a non-risk. Both withdrawals
  are sound, and D10-3a states the correct mechanism.
- The prescribed replacement is the right one. `flex: 1; min-height: 0` on the frame is
  shrink-safe against the `flex-shrink: 0` sibling by construction, where `height: 100%`
  survives only on default shrink. And `.ui-data-grid--full` moving from `height: 100%`
  (`DataGrid.css:40-42`) to `flex: 1; min-height: 0` **inside** the frame is required, not
  optional: chrome now shares the frame, so a 100%-height grid would overflow it.
- The extended no-scroll invariant now covers `.panel-content__disclosure`. That was the
  substantive half of CR1(c) and it is present.

**D10-7's conclusion still holds under the D10-3a rewrite.** Its liveness argument needs
only that `.ui-data-grid` be height-capped and `overflow: auto` on both axes. `DataGrid.css:1-4`
gives both-axis `overflow: auto`; under D10-3a the cap arrives via `flex: 1` inside a
definite-height frame instead of `height: 100%`. Sticky therefore still engages, and
`stickyOffsets.columns` is still consumed. D10-7's own instruction to confirm this by live
measurement per surface remains the correct handling — I am not asserting it as proven.

**Line references checked against HEAD** (I checked all of them, not a sample):

- Accurate: `DataGrid.css:1-4`, `:36` (`--preview max-height: 320px`), `:40-42`
  (`--full`, `height: 100%` at `:42`), `:185-190` (`.ui-data-grid__filter-row th`),
  `:260-262` (truncation-group reset selector list — exactly the three removed cells,
  so D10-5's "fully dead CSS" is correct), `:274-279` (`.ui-data-grid__filter-toggle-row th`),
  `:402-405` (`.ui-data-grid__empty-row`); `DataGrid.tsx:267-297` (`stickyCellMaxWidth` +
  its effect; deps confirmed `[filterable, filterExpanded, resolvedColumns.length,
  resolvedDensity, scrollRef]`, none width-tracking), `:376-388` (un-filtered empty
  early-return, bare `<p>` at `:382`), `:402` (scroll-container root with `ref={scrollRef}`,
  `role="region"`), `:554` (`.ui-data-grid__filter-row--columns`);
  `PanelDetailModal.tsx:400` (`__view-body` → `PanelContent`), `PanelDetailModal.css:61-66`.
- Off by a few, harmless: `__empty-wrap (:383)` is `DataGrid.tsx:384`;
  `.panel-content__disclosure (TableRenderer.tsx:444)` is `:449` (`:444` is the comment above it);
  `PanelContent.css:109-115` is `:110-116`. Cited as notes, not findings.

**D10-3's load-bearing selector claim is true.** `grep -rn "ui-data-grid" --include=*.css`
outside `DataGrid.css` returns three hits, all inside comments (`MobilePanelStack.css:76`,
`PipelineListTable.css:24`, `SourceListTable.css:84`). Nothing outside `DataGrid.css`
selects `.ui-data-grid`, so nothing breaks by selector when the frame is interposed.

**Tenth-assumption hunt (the part you asked me to weigh honestly).** I went looking
specifically for the reverse face of the ninth — the ninth made the frame shrinkable, so I
asked what now absorbs height pressure. Four candidates, each chased to source:

1. *Frame chrome has no declared `flex-shrink`.* With `.ui-data-grid--full` at
   `flex: 1` (basis 0), its scaled shrink factor is 0, so under negative free space
   **all** shrinkage falls on the chrome, not the grid. This is a genuine gap in the spec.
   But it only bites when the chrome's own basis exceeds the frame's height, and it does
   not at reachable sizes: `panelGridConfig.itemHeights.min = 4` at `rowHeight: 52` +
   `margin: [18,18]` is a ~262px card, leaving ~200px of `.panel-content--table` box
   against a chrome stack (toolbar + quick-filter + message) on the order of 140px. I could
   not construct a defect at an achievable panel size, so this is a hardening note below,
   not a Change Request.
2. *Mobile.* `MobilePanelStack.css:79-83` caps `.panel-content--table` at `max-height: 60dvh`
   with an intrinsic-height item, and `TableRenderer` is shared verbatim, so the reframe
   lands there too on a surface D10 never names. But it is not a regression: today the grid's
   `height: 100%` against an auto-height parent already resolves to intrinsic, and
   `flex: 1; min-height: 0` behaves the same or better under the cap. Verification-coverage
   note, not a defect.
3. *`--full`'s surviving `width: 100%` (`DataGrid.css:41`), unmentioned by D10-3a.* Inside a
   column frame with default `align-items: stretch` it is a no-op either way. Non-issue.
4. *`--preview`'s `margin-top: var(--space-3)` (`DataGrid.css:33`) now sitting inside the
   frame.* Margins do not collapse in flex layout and did not collapse in the block parents
   either; the offset is preserved and the frame's box grows by it. Layout-neutral, and
   D10-3 already requires this be verified rather than assumed at the three preview call sites.

**So: no tenth structural assumption.** I did not find one, and I am not manufacturing one
for symmetry. D10-3a is correct and, as far as I can derive from HEAD, sufficient. The design
is closed.

### Verdict: CONFIRM

D10 is sound enough to implement. The flex chain is right, the shrink-safety is right, the
withdrawn claims were correctly withdrawn and for the correct reason, the deletions in D10-5
are provably dead code, the invariants in D10-10 are the right ones, and D10-9(a)–(c) give the
reframe failable guards rather than assertions. Nothing below blocks execution.

### Non-blocking notes

1. **Chrome hardening (worth doing, not worth a round).** Give the frame's chrome
   (`filter toolbar`, quick-filter row, filtered-empty message) `flex-shrink: 0` in
   D10-3a's CSS. Per candidate 1 above, without it the chrome is the only thing that can
   shrink under negative free space, and the failure mode is squashed/overlapping controls
   rather than a scroll. Cheap, and it removes the last unpinned flex property in the new frame.
2. **Add the mobile stack to D10-3a's live-verification list.** It currently says "on **both**
   surfaces" (panel and modal); `MobilePanelStack` is a third, and it is the one whose parent
   height is indefinite (`max-height: 60dvh`). I expect it to be fine (candidate 2), which is
   exactly why it should be looked at once rather than reasoned about again.
3. **D10-7 still carries the premise round 4 CR1(a) asked to correct.** It reads "since
   `.panel-content` is a row flex with `align-items: center` the child is not stretched"
   (design.md, D10-7 first bullet). D10-3a now correctly says the opposite for this surface.
   The *conclusion* of D10-7 survives untouched, and the executor's instruction comes from
   D10-3a, so this cannot produce a defect — but it is a stale sentence a future reader could
   re-derive from. One-line fix while editing.
4. **Residual stale line refs** (round 4 CR2, still open): `TableRenderer.tsx:444` → `:449`;
   `PanelContent.css:109-115` → `:110-116`; `__empty-wrap (:383)` → `DataGrid.tsx:384`.
   D10-2's `filter-row--columns (:554-559)` and `__empty-wrap (:383)` are `DataGrid.tsx`
   lines cited in a paragraph otherwise discussing CSS — worth saying which file.
5. **A11y observation, not a finding.** The filter toolbar and quick-filter move outside the
   `role="region" aria-label="Data grid"` element (`DataGrid.tsx:402`), which stays on the
   scroll container per D10-3. That is defensible (they are chrome about the grid, not grid
   content) but it is a change in the accessible grouping and is currently unstated. Worth one
   sentence in D10-2 so it reads as decided rather than incidental.
