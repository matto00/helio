## 1. Frontend — Hook

- [x] 1.1 Create `frontend/src/hooks/usePortalPopover.ts` with trigger ref, isOpen, panelPos, handleOpen, close
- [x] 1.2 Hook position type is `{ top: number; right?: number; left?: number; width?: number }`
- [x] 1.3 Hook returns `handleOpen` that reads `getBoundingClientRect()` from triggerRef and calls a caller-supplied `computePos(rect)` callback to populate panelPos

## 2. Frontend — UserMenu (the clipping fix)

- [x] 2.1 Update `UserMenu.tsx` to use `usePortalPopover` for open/close and position state
- [x] 2.2 Render `user-menu__popover` via `createPortal(panel, document.body)` with `position: fixed` inline style (top = rect.bottom + 8, right = window.innerWidth - rect.right)
- [x] 2.3 Port Escape key handling to a `document` keydown listener (mirroring the existing mousedown listener) so it fires even when focus is inside the portalled panel
- [x] 2.4 Remove `.user-menu__popover { position: absolute; ... }` from `UserMenu.css`; add scrim button matching ActionsMenu pattern

## 3. Frontend — Refactor existing portalled components

- [x] 3.1 Refactor `ActionsMenu.tsx` to use `usePortalPopover` (behavior-preserving; right-aligned)
- [x] 3.2 Refactor `DashboardAppearanceEditor.tsx` to use `usePortalPopover` (behavior-preserving; right-aligned)
- [x] 3.3 Refactor `Select.tsx` to use `usePortalPopover` for open/close and position state; keep its own `portalTarget` (dialog-aware) logic

## 4. Tests

- [x] 4.1 Update `UserMenu.test.tsx` to assert the menu panel renders as a portal (not inside `.user-menu`) when open
- [x] 4.2 Verify existing `AccentPicker.test.tsx` and `PanelGrid.test.tsx` still pass after refactor
