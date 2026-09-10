## Why

HEL-451's D10 reframe wrapped every `DataGrid` render path (including the three `preview`-variant consumers) in a new `.ui-data-grid__frame` element. The frame was designed to be layout-neutral for `preview`, but five prior attempts across four agents failed to reach any preview call site in the running app, so that neutrality has never been verified — including the specific named risk that `.ui-data-grid--preview`'s `margin-top` no longer collapses through the new flex frame parent.

## What Changes

- No behavior change is proposed up front. This is a regression check: reach each of the three `preview`-variant call sites (pipeline step preview, source detail preview, SQL schema preview) plus the `SourcePreviewSkeleton` hand-rolled markup, in the running app, in both themes, and measure rendered geometry (specifically the space above the grid) against `a6bde0d3^` (pre-HEL-451).
- **If** a real geometry regression is found, fix it with the minimal CSS/markup change and add a guard (visual or Jest) preventing recurrence.
- **If** none is found, record that explicitly (measured, not inferred) so the question is not re-litigated.
- Investigate first whether the dev user owning zero Outputs (HEL-904 residue) is what blocked the five prior attempts from reaching these call sites; if so, seed minimal fixture data as part of reaching them, and record that this was the actual blocker.

## Capabilities

No spec-level behavior is being introduced or changed by this ticket itself (`skip_specs: true`). If measurement uncovers a real regression, the fix is a bug-level correction to the existing HEL-451 DataGrid preview-variant behavior, not a new capability.

### New Capabilities
(none)

### Modified Capabilities
(none — see Why/What Changes)

## Impact

- `frontend/src/features/pipelines/ui/StepCard.tsx`, `frontend/src/features/sources/ui/SourceDetailPanel.tsx`, `frontend/src/features/sources/ui/forms/SqlTab.tsx`, `frontend/src/features/sources/ui/SourcePreviewSkeleton.tsx` — read/measured, possibly patched if a regression is found.
- `frontend/src/shared/ui/DataGrid.css` / `DataGrid.tsx` — possibly patched (`.ui-data-grid--preview` margin rule) if a regression is found.
- No backend impact. No API contract change.

## Non-goals

- Adding filtering to the `preview` variant (HEL-451's own explicit out-of-scope, unchanged).
- Any unrelated DataGrid full-variant behavior.
