## Why

Deleting a panel while its detail modal is open crashes the whole app with an uncaught
`TypeError` (`panel.id` on `undefined`), caught only by the top-level `ErrorBoundary`. The modal
renders via a non-null-asserted `.find()` on the panels list, which lies to TypeScript when the
backing panel has just been deleted out from under it. High priority, user-facing, pre-existing on
`main` (HEL-651).

## What Changes

- Guard the panel detail modal's panel lookup in `DesktopPanelGrid.tsx` so that when the panel
  backing `detailPanelId` is no longer present in the panels list, the modal closes automatically
  instead of rendering with `undefined` and crashing.
- Applies regardless of *why* the panel disappeared: local delete action, another actor deleting it
  (second tab / MCP apply / proposal apply), or the parent dashboard being removed with the modal
  open.
- No change to the modal's own dismissal semantics (Escape/backdrop/Cancel) — this is a new,
  additional auto-close trigger for the "backing panel vanished" case only.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `panel-detail-modal`: add a requirement that the modal closes automatically (rather than
  crashing) when its backing panel is removed from the panels list while it is open.

## Impact

- `frontend/src/features/panels/ui/grid/DesktopPanelGrid.tsx` — panel-detail-modal render guard.
- `frontend/src/features/panels/hooks/usePanelData.ts` — crash site; guarded transitively once the
  modal stops rendering with an undefined panel (no `panel === undefined` call path reaches it).
- New Playwright regression test exercising the real open-modal → delete-panel interaction path.

## Non-goals

- No change to how/where panels are deleted from (existing delete surfaces are unchanged).
- No change to the modal's Escape/backdrop/Cancel/discard-warning behavior for the ordinary case
  where the panel still exists.
