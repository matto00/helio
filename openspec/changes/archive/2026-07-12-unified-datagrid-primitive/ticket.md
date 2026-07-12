# HEL-251: Build unified DataGrid primitive

**Project:** Helio v1.5 — Panel System v2 (parent: HEL-240 Data Grid Standardization)
**Status:** In Progress

## Description

Create one canonical data-grid component that replaces every table-shaped surface in the app.

### Required surfaces to migrate

- `PreviewTable` (used in TypeDetailPanel preview, SourceDetailPanel preview, PipelinePreviewModal)
- Inline step preview in PipelineDetailPage (`pipeline-detail-page__step-preview-table`)
- Schema preview tables in AddSourceModal / SqlTab
- Table panel rendering (`PanelContent` for type="table")
- Run history's row-count column

### Component API (sketch)

```tsx
<DataGrid
  rows={Record<string, unknown>[]}
  columns={ColumnDef[]}  // optional, derived from row keys if omitted
  variant="full" | "preview"  // preview = read-only + condensed default
  density="condensed" | "normal" | "spacious"  // controlled or default per variant
  className={string}
/>
```

`ColumnDef` carries `{ key, header?, render?, width? }`.

### Definition of done

- One component used by every listed surface
- Existing `PreviewTable` and inline tables deleted
- Tests cover: empty state, full mode, preview mode, custom column render

Subsequent tickets in this epic build features on top (density, draggable widths, scroll fix,
table-panel config).

## Restart-with-reuse context (orchestrator note, not part of the original ticket)

A prior session implemented this ticket on a now-deleted branch that went 32 commits stale. Per
explicit user decision, this is a fresh rebuild against current `main` (83ee240), reusing:

1. The finished `DataGrid` primitive (`DataGrid.tsx`/`.css`/`.test.tsx`) — ported as a starting
   point into `frontend/src/shared/ui/`.
2. The prior design thinking (proposal/design/tasks, 3 skeptic-design rounds, `CONFIRM` on round
   3) — re-derived (not copied blindly) against current `main`, since `StepCard.tsx`,
   `TypeDetailPanel.tsx`, and `SourceDetailPanel.tsx` (+ their CSS) all changed substantially this
   session (text-op step configs, HEL-217 content field types, connector changes).

The prior design's self-approved decisions (component lives at `shared/ui/DataGrid.tsx`, not the
ticket's literal `components/ui/` path; `RunHistoryModal`'s row-count is a flex-row summary field,
not a `<table>`, and is excluded from migration) carry forward and are re-verified against current
code, not re-litigated from scratch.

All current `PreviewTable` consumers must be re-grepped against current `main` before deletion —
the ticket text may be stale relative to current file/surface names.
