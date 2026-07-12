## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Diff scope matches the proposal exactly.** `git diff b59545c...318cce2 --stat` shows only the
   4 named source files (`PanelGrid.css`, `PanelDetailModal.css`, `SourceDetailPanel.tsx`/`.css`)
   plus the spec delta and change-management docs. `git diff` content confirms: two one-line
   `overflow: hidden` deletions (`PanelGrid.css:44`, `PanelDetailModal.css:134` pre-change) and a
   mechanical wrapper-div extraction in `SourceDetailPanel` moving `border`/`border-radius`/
   `overflow` from the `<table>` rule to a new `.source-detail-panel__schema-table-wrapper` rule
   with `overflow: auto`. No `DataGrid.tsx`/`.css` changes, matching the stated non-goal.

2. **Gates re-run myself, not trusted from the report:**
   - `npm run lint` (frontend/) — clean, zero warnings.
   - `npm run format:check` — clean.
   - `npx jest` — 81 suites / 873 tests passed (includes `DataGrid.test.tsx`, `PanelContent.test.tsx`,
     `SourceDetailPanel.test.tsx`).
   - `npx openspec validate datagrid-scroll-overflow-fix --strict` — "Change ... is valid".

3. **Ticket DoD bullet 1 (30-col/200-row scroll, both directions, header pinned) — verified live,
   independent of the executor's/evaluator's probe evidence**, using the same
   `HEL-254 Scroll Verification` dashboard / `HEL-254 30x200 Table` panel already on the running app
   (dev servers were already up on 5427/8334; `assert-phase.sh servers` → PASS):
   - Dashboard grid card: `getComputedStyle('.panel-grid-card').overflow` = `"visible"`; grid
     `scrollWidth 1989 / clientWidth 433`, `scrollHeight 1784 / clientHeight 150` — real overflow
     both axes. Set `scrollLeft=400, scrollTop=200` programmatically and screenshotted
     (`dash-scrolled.png`): header row showed `col_14…col_2x` pinned at the top while body rows
     updated to `r6…r8`, no clipped content, rounded card corners intact.
   - Panel detail modal view mode: `.panel-detail-modal__view-body` computed `overflow: visible`;
     grid `scrollWidth 1989/clientWidth 1159`, `scrollHeight 1784/clientHeight 786`. Scrolled
     (`scrollLeft=500, scrollTop=300`) and screenshotted (`modal-scrolled.png`): header row
     (`col_16…col_4`) stayed pinned while body showed `r9…r29`, both scrollbars visible, no cut-off
     content.

4. **Grep-level DoD (no `overflow: hidden` on any DataGrid wrapper) — traced every live `DataGrid`
   consumer's ancestor chain myself**, not just the two named classes:
   - `TableRenderer.tsx` → `.panel-content--table` / `.panel-grid-card` — fixed (this change).
   - `TypeDetailPanel.tsx` → `.type-detail-panel__preview` — grepped `TypeDetailPanel.css`, no
     `overflow` declared on any ancestor of the `DataGrid`.
   - `SqlTab.tsx` → `.sql-tab__schema-preview` inside `AddSourceModal` — grepped `AddSourceModal.css`,
     no `overflow: hidden` hits at all.
   - `PipelinePreviewModal.tsx` → grepped `PipelinePreviewModal.css`, no `overflow` hits.
   - `StepCard.tsx` → `.pipeline-detail-page__step-preview` (no overflow declared) wrapped by
     `.pipeline-detail-page__step-card` (`overflow: hidden`, `PipelineDetailPage.css:315`, left
     untouched per design's non-goal). Confirmed `.ui-data-grid--preview` has its own
     `max-height: 320px` + `overflow: auto` (`DataGrid.css:8-14`) and `.pipeline-detail-page__step-card`
     has no fixed height (grows to fit content) — so the ancestor clip is provably inert, matching
     the design's Decision/Non-Goal #(pipeline-detail-page). Confirms audit item 6 from my brief.
   - Full `grep -rn "overflow: hidden" frontend/src --include=*.css` (26 hits) manually triaged: none
     are an undiscovered DataGrid-adjacent ancestor clip — all are cell-level `text-overflow:
     ellipsis` truncation, unrelated fixed-size decorative boxes, or the two explicitly-scoped
     page-shell non-goals (`.pipeline-detail-page`, `.pipeline-detail-page__step-card`).

5. **`SourceDetailPanel` schema table** — navigated to `HEL-254 Wide Table Source` in the running app.
   `getComputedStyle('.source-detail-panel__schema-table-wrapper')`: `overflow: auto`,
   `border-radius: 6px`, `border: 1px solid rgba(...)`; the `<table>` itself: `overflow: visible`.
   30 rows render without truncation. Matches the design's Decision #3 exactly.

6. **No regression to other panel types** sharing `.panel-grid-card`, now that its `overflow: hidden`
   is gone. Screenshotted `HEL-293 Full UI Check` (chart, metric, divider, markdown panels) and
   `skeptic-e2e-dash` (chart, metric, table) — all render with clean rounded corners, no visual
   bleed. Image panel type was not live-tested (no image-panel dashboard readily available in this
   worktree's data), but `ImagePanel.css:7` (`.image-panel { overflow: hidden }`) confirms it
   self-clips independently of the card — low risk, consistent with the design's own audit and the
   evaluator's finding.

7. **Light/dark parity.** Toggled to light theme on the same 30×200 table dashboard
   (`dash-light.png`): rounded corners intact, no bleed, no layout regression. Toggled back to dark
   without issue.

8. **Console errors.** `browser_console_messages(all: false)` scoped to the current navigation
   returned 0 errors after all the above interactions (scrolling, theme toggle, dashboard/modal
   navigation). A large batch of unrelated errors surfaced only under `all: true` — those all
   reference `localhost:5416` (a different worktree's dev server port from an earlier browser
   session in this same persistent browser tab), not this session's `5427`; correctly out of scope
   for this diff.

9. **Clean seam for HEL-252/HEL-253.** The diff is two CSS-property deletions and one mechanical
   wrapper-div extraction on an unrelated component (`SourceDetailPanel`, not a `DataGrid` consumer).
   `DataGrid.tsx`/`.css` are untouched, so HEL-252 (density) and HEL-253 (drag widths) inherit a
   primitive whose scroll/sticky-header contract is now explicit in `specs/data-grid/spec.md`
   without any new coupling introduced by this ticket.

10. **AC traceability.** All four DoD bullets trace to real, independently-observed evidence above
    (no `overflow: hidden` on a live `DataGrid` wrapper; bidirectional scroll; sticky header; the
    literal 30-col/200-row scenario). No AC is left unaddressed, and no scope drift beyond the
    ticket (diff touches exactly the files named in the proposal's Impact section).

### Verdict: CONFIRM

Ground truth (diff, gates, and live Playwright verification against the running app) matches the
executor's and evaluator's claims in every place I checked, including several ancestor chains
(`TypeDetailPanel`, `SqlTab`, `PipelinePreviewModal`, `StepCard`) neither report enumerated in
detail. No placeholder work, no missed DataGrid-adjacent clip, no visual regression, no scope
drift, and the change leaves a clean, minimal seam for the HEL-252/HEL-253 follow-ons.

### Non-blocking notes
- Image panel type's non-regression claim rests on code-reading (`ImagePanel.css:7` self-clips)
  rather than a live screenshot, in both this review and the prior evaluation — low risk given the
  explicit self-contained `overflow: hidden` on `.image-panel`, but a future ticket touching image
  panels should spot-check this live once a convenient image-panel dashboard exists.
