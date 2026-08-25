# HEL-651: Deleting a panel while its detail modal is open crashes (pre-existing)

## Description

Found live during HEL-553's final-gate skeptic review (see PR #319) — reproducible on `main`, unrelated to that PR's diff. Deleting a panel while its detail modal is still open crashes with `TypeError: Cannot read properties of undefined (reading 'id')` at `frontend/src/features/panels/hooks/usePanelData.ts:39` (`state.panels.paginationState[panel.id]` with `panel === undefined`), caught by the app's `ErrorBoundary`.

Root cause traced to `frontend/src/features/panels/ui/grid/DesktopPanelGrid.tsx:309`:

```tsx
panel={panels.find((p) => p.id === detailPanelId)!}
```

The non-null assertion (`!`) lies to TypeScript when the panel backing `detailPanelId` has just been deleted out from under the open modal (`panels.find(...)` genuinely returns `undefined` in that case) — the modal then renders with an `undefined` panel and `usePanelData` crashes trying to read `panel.id`.

(Note: file paths above reflect current `main` post HEL-632 repo-structure-cleanup; original ticket cited `frontend/src/features/panels/state/usePanelData.ts:36` and `frontend/src/features/panels/ui/DesktopPanelGrid.tsx:294` — same code, moved. See `.concertino/runs/HEL-651/evidence/premise-validation.md`.)

## Reproduction

1. Open any panel's detail modal.
2. While the modal is open, delete that same panel (e.g. via another surface, or a second window/tab updating the same dashboard).
3. The app crashes with the `TypeError` above, caught by `ErrorBoundary`.

Confirmed via `git diff main...HEAD --name-only` on HEL-553's branch that this bug pre-dates that ticket (`DesktopPanelGrid.tsx`, `PanelCard.tsx`, and the base `PanelDetailModal.tsx` are untouched by it) — this is reproducible on any panel type, not specific to metric binding.

## Scope

Guard `DesktopPanelGrid.tsx`'s panel lookup (e.g. close the detail modal automatically when its backing panel is deleted, or render a graceful empty/closed state instead of asserting non-null).

## Acceptance Criteria

- Deleting a panel while its detail modal is open (from any deletion surface, including via another actor updating the same dashboard state) no longer crashes the app.
- The detail modal closes gracefully (or renders a graceful empty/closed state) when its backing panel disappears from the panels list.
- A reproduction of the crash is captured as evidence (console error/stack trace) BEFORE the fix, and a regression test exists that is RED before the fix and GREEN after.
- Adjacent trigger paths are probed and reported: deleting from a different surface while the modal is open; the panel being deleted by another actor (second tab / MCP apply / proposal apply) while the modal is open; the parent dashboard being deleted with the modal open; the panel's bound DataType/pipeline being deleted while the modal is open.

## Triage

`ac_relevant=no`, `effort=small` (a null-check/guard fix, not a redesign) — recommended `standalone` by `scripts/concertino/triage-followup.sh`.

Relates to HEL-553 (matto00/helio#319).
