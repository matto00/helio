## Skeptic Report — design gate (round 4, skeptic-design-8.md)

Cold read of design.md D10 (incl. new D10-3a), skeptic-design-5/6/7, ticket.md,
proposal.md, tasks.md, HANDOFF.md, then every cited line checked against branch
HEAD `61cba49a`.

### What I verified (with evidence)

- **Branch state.** `git diff --stat origin/main...HEAD` = 34 files, +4433. The
  filtering feature is implemented; the D10 reframe is not. D10's refs are against
  this HEAD, which is the correct frame. Judged the design only.
- **D10-7's `--full` claim, at source.** `DataGrid.css:40-42` = `.ui-data-grid--full
  { width: 100%; height: 100% }`; `DataGrid.css:1-4` = `overflow: auto`;
  `DataGrid.tsx:402` = the root `<div role="region" ref={scrollRef}>`. So
  `.ui-data-grid` is the nearest scrolling ancestor for the `thead` rows and is
  height-capped. D10-7's conclusion (sticky machinery is LIVE) is correct.
- **D10-7's `--preview` correction is real, not papered over.** `DataGrid.css:36`
  caps preview at 320px, but the three preview consumers (`StepCard.tsx:382`,
  `SourceDetailPanel.tsx:288`, `SqlTab.tsx:223`) pass no `filterable`, and
  `stickyOffsets.columns` is only emitted at `DataGrid.tsx:556` under the
  filterable/expanded branch. Recording the bullet as giving no support is the
  accurate statement.
- **The governing panel CSS — this is where D10-3a breaks.**
  `PanelContent.css:1-8` is `.panel-content` (row flex, `align-items: center`,
  `justify-content: center`), but `PanelContent.css:110-116` **overrides it for this
  exact surface**:
  `.panel-content--table { padding: var(--space-2) var(--space-3); flex-direction:
  column; justify-content: flex-start; align-items: stretch; min-height: 0 }`.
  D10-3a and D10-7 both cite only `:1-8`.
- **The frame will have a flex sibling.** `TableRenderer.tsx:431` renders `<DataGrid
  variant="full" …>` and `TableRenderer.tsx:448-449` renders
  `{showTruncationWrapper && <div className="panel-content__disclosure">}` as its
  **sibling** in that column flex; `TableRenderer.css:18-25` gives it
  `flex-shrink: 0`.
- **Preview parents are auto-height blocks** (`PipelineDetailPage.css:689-693`,
  `sql-tab__schema-preview`, `source-detail-panel` preview region), so an
  unconditional frame `height: 100%` is layout-neutral for them — D10-3's "the frame
  takes no modifiers" and D10-3a's variant-specific height are **not** in conflict.
  Checked deliberately and found clean; not a finding.
- **Modal chain holds.** `PanelDetailModal.css:61-65` `__view-body` is
  `flex: 1; display: flex; flex-direction: column; min-height: 0`, so `.panel-content`
  resolves a definite height there identically to the panel surface.
- **Line references.** Spot-checked every D10 ref against HEAD:
  `DataGrid.css` 1-4/16-30/36/40-42/62/185-190/260-262/274-279/402-405 ✓;
  `DataGrid.tsx` 267/376-388/383/402/554-559 ✓;
  `DataGrid.test.tsx` 405/421/730/749/805/840/880/915/936/948 — all ten land on
  exactly the described `it(...)` ✓; `StepCard.tsx:382`, `SourceDetailPanel.tsx:288`,
  `SqlTab.tsx:223` ✓; `TableRenderer.tsx:451-454` (provisional-labelling comment) ✓.
  Three minor drifts, all editorial: `TableRenderer.tsx:444` is 5 lines above the
  disclosure wrapper (actual 448-449); `PanelDetailModal.tsx` now lives at
  `features/panels/ui/detailModal/PanelDetailModal.tsx`; D10-2 cites
  `filter-row--columns (:554-559)` and `__empty-wrap (:383)` as if CSS — both are
  `DataGrid.tsx` lines (the CSS `__empty-wrap` rule is `DataGrid.css:161`).

### Verdict: REFUTE

One structural finding (CR1) and one premise correction (CR2). CR1 is the ninth
assumption and is the reverse face of the eighth exactly as the pattern predicts:
round 3 fixed "the grid loses its cap" by moving the definite height **outward**,
without noticing the outward position has a **sibling** the inner position did not.

### Change Requests

1. **STRUCTURAL — D10-3a's premise CSS is overridden; rewrite it against
   `.panel-content--table`, and give the frame `flex: 1; min-height: 0`, not
   `height: 100%`.**

   D10-3a (design.md:569-573, and the same sentence in D10-7 at :644-648) justifies
   itself from `.panel-content` at `PanelContent.css:1-8`. On this surface that rule
   is overridden by `.panel-content--table` at `PanelContent.css:110-116`:
   `flex-direction: column`, `justify-content: flex-start`, `align-items: stretch`.
   Three consequences the executor is currently instructed wrongly on:

   - `width: 100%` on the frame is unnecessary — `align-items: stretch` on a column
     flex already gives the frame full width. D10-3a's stated reason
     ("`justify-content: center` likewise does not stretch it horizontally") is wrong
     twice: `justify-content` is `flex-start` here, and it acts on the **vertical**
     main axis, not the horizontal one. Drop the declaration or restate why it is kept.
   - "Confirm the short-table case top-aligns rather than vertically centre"
     (design.md:591) targets a non-risk: `justify-content: flex-start` already
     top-aligns. Replace this verification item with the real one, below.
   - **The real hazard, which D10-3a never names:** after the reframe the frame is a
     flex sibling of `.panel-content__disclosure` (`TableRenderer.tsx:448-449`,
     `TableRenderer.css:24` `flex-shrink: 0`) inside that column. A frame at
     `height: 100%` consumes the entire panel-content box; the layout only survives
     today because the item's default `flex-shrink: 1` lets it give the disclosure its
     space back. Any executor who writes `flex: 1 0 auto`, or who applies D10-3's
     "every ancestor flex/height rule that used to land on `.ui-data-grid` now lands
     on the frame" to a shrink-disabling rule, pushes the disclosure — the element
     carrying this ticket's own partiality message and the Load-more control — below
     the fold of `.panel-content--table`'s `overflow-y: auto`. That is the same
     failure mode D10-2 elevates to an invariant, in the one element D10-2's
     invariant does not cover (it is stated about *frame chrome* only).

   Required revisions, mechanical:
   (a) Correct D10-3a's and D10-7's cited premise to `PanelContent.css:110-116`
       (`.panel-content--table`), keeping `:1-8` only as the base being overridden.
       Both sections' **conclusions survive** — a column-flex item still has
       `flex-grow: 0`, so the definite height is still load-bearing — but the stated
       mechanism must be the correct one.
   (b) Change the frame's prescribed sizing for the `full` variant from
       `height: 100%; width: 100%; min-height: 0` to **`flex: 1; min-height: 0`**
       (dropping `width: 100%`), which is shrink-safe by construction and mirrors
       exactly what D10-3a already prescribes one level in for `.ui-data-grid--full`.
   (c) Extend D10-2's invariant to read: no frame chrome **and no
       `.panel-content__disclosure`** may require scrolling `.panel-content--table` to
       become visible; add "the disclosure remains visible without scrolling, panel
       and modal, both themes" to the live-verification list, replacing the
       vertical-centring check.
   (d) Mirror (a)–(c) into `tasks.md` in the same pass, per D4c.

2. **EDITORIAL — three stale references.** `TableRenderer.tsx:444` → `:448-449`
   (`showTruncationWrapper` / `.panel-content__disclosure`); `PanelDetailModal.tsx` →
   `features/panels/ui/detailModal/PanelDetailModal.tsx`; D10-2's
   `filter-row--columns (:554-559)` and `__empty-wrap (:383)` are `DataGrid.tsx`
   lines, not `DataGrid.css` — say so, or cite `DataGrid.css:161` for the latter.
   Would not produce a defect; would cost the executor a lookup each.

### Non-blocking notes

- D10-3 ("the frame takes no modifiers") and D10-3a (variant-specific frame height)
  read as a contradiction, but I checked all three preview parents and they are
  auto-height blocks, so an unconditional frame rule is layout-neutral for them. No
  change needed; noting it so round 5 does not re-open it as a finding.
- D10-9's retarget-don't-delete instruction for `DataGrid.test.tsx:840` is the right
  call — I confirmed that test is mutation-failable and guards machinery D10 keeps.
- With CR1(b) applied, `.ui-data-grid--full`'s existing `width: 100%`
  (`DataGrid.css:41`) can stay as-is; it resolves against the frame unchanged.
