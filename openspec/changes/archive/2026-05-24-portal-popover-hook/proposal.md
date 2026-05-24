## Why

ActionsMenu and DashboardAppearanceEditor were fixed by rendering via `createPortal` to `document.body`
with positions from `getBoundingClientRect()`. UserMenu still uses `position: absolute` within a
relatively-positioned parent, leaving it susceptible to clipping. Duplicating the portal/positioning
pattern per component is also unsustainable; a shared hook is needed.

## What Changes

- Extract the trigger-ref + open/close + position-calculation pattern into a `usePortalPopover` hook
  in `frontend/src/hooks/`
- Port `UserMenu` to use the hook and render its popover via `createPortal` to `document.body`
- `Select` already uses portals but duplicates the same logic — it will adopt the hook to reduce
  duplication
- `ActionsMenu` and `DashboardAppearanceEditor` already use the portal pattern; they will adopt the
  hook to eliminate their own inline duplications

## Non-goals

- Changing the visual design or interaction model of any popover
- Addressing keyboard focus management beyond what already exists per component
- Migrating Toast (already a fixed-position portal independent of the popover pattern)

## Capabilities

### New Capabilities

- `portal-popover-hook`: A `usePortalPopover` hook that encapsulates trigger ref, open/close state,
  portal target resolution (dialog-aware), and position computation from `getBoundingClientRect()`.

### Modified Capabilities

- `user-menu-popover`: The UserMenu popover positioning changes from `position: absolute` within a
  relatively-positioned container to a portal-rendered, `position: fixed` panel — it must not clip
  in any stacking context.

## Impact

- `frontend/src/hooks/usePortalPopover.ts` — new file
- `frontend/src/features/auth/ui/UserMenu.tsx` — adopt hook, portal-render popover
- `frontend/src/features/auth/ui/UserMenu.css` — remove `position: absolute` popover rule
- `frontend/src/shared/chrome/ActionsMenu.tsx` — adopt hook (behavior-preserving refactor)
- `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.tsx` — adopt hook (behavior-preserving refactor)
- `frontend/src/shared/ui/Select.tsx` — adopt hook (behavior-preserving refactor)
- No backend changes; no schema changes; no API contract changes
