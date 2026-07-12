## Context

HEL-251 introduced the canonical `DataGrid` primitive (`frontend/src/shared/ui/DataGrid.tsx` +
`.css`) and migrated 5 table surfaces onto it: `TypeDetailPanel`, `SourceDetailPanel`,
`PipelinePreviewModal`, `StepCard` preview, `SqlTab`, and `TableRenderer` (the table-panel body).
`DataGrid.css` already sets `overflow: auto` (both axes) on `.ui-data-grid` and a sticky
`thead th` — this predates HEL-254 but was never formalized as a spec requirement, and this
ticket's DoD ("no `overflow: hidden` on any DataGrid wrapper", "scrolls cleanly in both
directions") reads as if the underlying primitive itself were still broken.

Auditing the actual ticket-listed surfaces against the current (post-HEL-251) codebase:

- `preview-table__wrapper` and `pipeline-detail-page__step-preview-table-wrapper` — **stale
  references**. Both were replaced by `DataGrid`'s own preview-variant box (`.ui-data-grid--preview`,
  `max-height: 320px`, `overflow: auto`) during HEL-251; grep confirms these class names no longer
  exist in `frontend/src/`.
- `panel-grid-card` — **still has `overflow: hidden`** (`PanelGrid.css:44`). Wraps `TableRenderer`'s
  `DataGrid` (via `.panel-content--table`, itself `flex:1`/`min-height:0`/`overflow-y:auto` per the
  `panel-content-sizing` spec). Under the current flex chain `DataGrid`'s own box is sized to exactly
  fill its parent (`height:100%`), so its internal overflow never needs to escape into the card — the
  card's `overflow: hidden` is provably inert today, but it is exactly the kind of ancestor the next
  two tickets in this chain (HEL-252 density, HEL-253 drag-resize) could destabilize, and it
  contradicts the ticket's literal DoD grep check.
- `panel-detail-modal__data-section` — the ticket names this class; the actual direct wrapper of
  `PanelContent` in view mode is `.panel-detail-modal__view-body` (`PanelDetailModal.css:129`), which
  also still sets `overflow: hidden`. Same rationale as `panel-grid-card`.
- `source-detail-panel__schema-table` — a genuine, still-live hit: a raw `<table>` (schema/field
  listing, not a `DataGrid` instance) with `overflow: hidden` directly on the element
  (`SourceDetailPanel.css:143`), used purely to clip square cell corners against the table's
  `border-radius`. This is the one surface where `overflow: hidden` is truly adjacent to a `<table>`
  and unaddressed by HEL-251.

## Goals / Non-Goals

**Goals:**
- Formalize the `DataGrid` scroll contract in the `data-grid` spec so HEL-252/HEL-253 build on a
  documented guarantee, not tribal knowledge.
- Remove the two remaining ancestor `overflow: hidden` wrappers named in the ticket
  (`panel-grid-card`, the panel-detail-modal view body) so the DoD's grep check passes and the
  contract holds even as later tickets touch this layout.
- Fix the one real non-`DataGrid` `overflow: hidden`-on-`<table>` hit (`SourceDetailPanel`).
- Manually verify the DoD's 30-column/200-row scroll scenario against the running app.

**Non-Goals:**
- No changes to `DataGrid.tsx`/`.css` rendering logic — its scroll/sticky-header behavior already
  matches the desired end state; only the spec catches up to it.
- No column density or resizable-width work (HEL-252/HEL-253).
- No changes to page-shell-level `overflow: hidden` that isn't a direct `DataGrid`/`<table>` wrapper
  (e.g. `.pipeline-detail-page`, `.pipeline-detail-page__step-card` — these bound an entire page/card
  layout, not specifically a table, and the `DataGrid` preview nested inside already scrolls
  independently via its own `max-height` + `overflow: auto`).

## Decisions

1. **Remove `overflow: hidden` from `.panel-grid-card` rather than changing it to `auto`.** The card
   is a flex-column shell (title / body / footer); giving the whole card its own scrollbar would
   scroll the title and footer along with the table. The inner `.panel-content--table` already owns
   vertical scroll and `DataGrid` owns both axes — the card should stay `overflow: visible` (i.e. no
   declaration) and rely on those inner containers. Checked against other panel types sharing this
   class: `ImagePanel` clips via its own `.image-panel { overflow: hidden }` (`ImagePanel.css:7`),
   `panel-content--text` clips via its own `overflow-y: auto` (`panel-content-sizing` spec) — neither
   depends on the card-level clip, so removing it is safe for every panel type, not just tables.

2. **Same treatment for `.panel-detail-modal__view-body`** — remove `overflow: hidden`, rely on
   `PanelContent`'s per-type containers (identical reasoning to #1; this wraps the same
   `PanelContent` component tree used in the dashboard grid).

3. **`SourceDetailPanel`'s schema table: move the clip to a wrapper `<div>` with `overflow: auto`,
   not `hidden`.** `overflow: auto` still clips the box to its `border-radius` (any non-`visible`
   overflow value participates in the corner clip), but offers a scrollbar instead of silently
   truncating a long field list. This keeps today's visual result identical for the common case
   (short field lists never overflow) while satisfying the ticket's literal audit bullet ("no
   `overflow: hidden` adjacent to a `<table>`") and being defensively correct for wide/long schemas.

4. **Spec delta on `data-grid`, not a new capability.** Scroll behavior is a natural extension of the
   primitive's existing rendering contract, and HEL-252/HEL-253 will extend the same spec next
   (density is already partially specified there) — keeping scroll requirements in the same file
   keeps the chain's spec history coherent.

## Risks / Trade-offs

- [Risk] Removing `overflow: hidden` from `.panel-grid-card` could let some future panel-type
  renderer paint outside the card's rounded corners if it doesn't manage its own overflow.
  → Mitigation: audited all current panel-type CSS (metric/text/table/chart/image/markdown/divider)
  — each either has no overflow risk (clamped fonts, fixed-height controls) or already scopes its own
  `overflow` locally. Evaluator/skeptic Playwright pass should visually check each panel type, not
  just table, after the change.
- [Risk] The 30-column/200-row DoD scenario is asserted via code-reading, not yet observed live.
  → Mitigation: explicit manual-verification task via the dev server (or Playwright) before this
  change is considered done; not just a lint/grep pass.

## Planner Notes

- Self-approved: treating the two ticket-named classes that no longer exist in the codebase
  (`preview-table__wrapper`, `pipeline-detail-page__step-preview-table-wrapper`) as already resolved
  by HEL-251, rather than escalating — this is a documentation/audit correction, not a scope change.
- Self-approved: leaving `.pipeline-detail-page` and `.pipeline-detail-page__step-card`
  `overflow: hidden` untouched — they bound page/card layout generally, not a table specifically, and
  the `DataGrid` preview nested inside already has its own independent scroll box.
