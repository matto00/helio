## Why

Keyboard users lose their place in two shared popovers (HEL-1756 follow-up). A failed save in the dashboard appearance editor drops focus to the page body because Save becomes `disabled` while saving, so the next focus move closes the editor and discards the picked preset. Shift+Tab from the first item of the appearance editor or the shared actions menu closes the popover and leaves focus wherever the portalled panel's DOM predecessor is (in practice the page body), not on the trigger the user came from.

## What Changes

- `usePortalPopover` (shared hook): when a keyboard Tab/Shift+Tab moves focus from inside an opted-in panel (`panelRef` attached) to outside both trigger and panel, the popover closes **and** real focus returns to its trigger. Additive: consumers without `panelRef` are untouched; focus that leaves from the trigger itself (e.g. a virtual-focus `Select` combobox) and focus moved by the pointer keep today's behavior (close, focus stays where it went).
- `DashboardAppearanceEditor`: Save uses `aria-disabled` (not `disabled`) while a save is in flight, and the submit handler ignores submits while saving, so a keyboard user's focus stays on Save through a failed save; the editor stays open with the picked preset and the error shown.
- New e2e spec proving each case red-first, keyboard only, light + dark, desktop + phone.
- Re-verify the HEL-1756 spec's throwaway emails are plain addresses (already true on main; no change expected).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `portal-popover-hook`: adds return-focus-to-trigger on keyboard focus-out from the panel.
- `popover-viewport-fit`: adds the appearance editor's failed-save focus retention.

## Impact

- `frontend/src/hooks/usePortalPopover.ts` (shared; every `panelRef` consumer: ActionsMenu, Select, ProvenanceTrigger/ProvenancePopover, DashboardAppearanceEditor, OutputSchemaDisclosure - executor re-enumerates).
- `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.tsx` and its CSS if a `[disabled]` style needs an `[aria-disabled="true"]` twin.
- Unit tests + a new e2e spec. Frontend only: no migration, no backend, no model calls.
