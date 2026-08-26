## Why

`DESIGN.md` §6 requires feature code to use the canonical shared primitives (`TextField`, `Textarea`, `Select`,
`Modal`, `DataGrid`, etc.) rather than hand-rolling equivalents, and tags this as a `[mechanical]` rule — but no
mechanical guard currently enforces it. Four feature views hand-roll a bespoke inline-rename text input,
reimplementing focus/border/sizing `TextField` already provides. This bounded slice migrates the three of those
four that are exclusively HEL-440's to own (the fourth, `DashboardList.tsx`, is reconciled to HEL-708 — see
`design.md`) and adds the guard the DESIGN.md tag implies but that doesn't exist yet.

## What Changes

- Migrate three hand-rolled inline-rename `<input>` usages to the shared `TextField` primitive, preserving
  click-to-rename interaction, behavior, and current visual appearance exactly (zero visual diff — see
  design.md): `PanelCard.tsx`, `PipelineDetailFooter.tsx`, `TypeDetailPanel.tsx`.
- Add a scoped raw-element regression guard test covering these three (now-migrated) files, closing the gap
  between DESIGN.md §6's `[mechanical]` tag and actual enforcement for this slice.
- Normalize any non-recipe button styling encountered in the touched files to the DESIGN.md §5 recipes.
- Verify loading/empty/error states in touched views already go through `EmptyState`/`StatusMessage`/`InlineError`
  per §7 (no expected changes; confirm only).

## Capabilities

### New Capabilities
- `raw-element-guard`: a regression test asserting the three migrated files render no raw `<input>` for their
  rename control, only the shared `TextField` primitive.

### Modified Capabilities
(none — this slice is behavior-preserving; no existing spec's requirements change)

## Impact

- `frontend/src/features/panels/ui/PanelCard.tsx`
- `frontend/src/features/pipelines/ui/PipelineDetailFooter.tsx`
- `frontend/src/features/dataTypes/ui/TypeDetailPanel.tsx`
- New test file for the raw-element guard.
- No backend, API, or schema impact.

## Non-goals

- `DashboardList.tsx`'s rename input (ceded to HEL-708 — see reconciliation in `design.md`).
- Raw `<table>`, ad-hoc dropdown/menu markup, non-rename raw `<input>` fields, `Modal`-vs-bespoke-overlay
  review, and `FormField` adoption — all deferred to follow-up tickets HEL-831 through HEL-836 (see `design.md`).
- Building a new shared `Button` component.
