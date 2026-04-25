## Context

`AppShell` in `frontend/src/app/App.tsx` renders the command bar's right section as a flat list: undo/redo buttons, dashboard appearance editor, theme toggle button, user identity div, and sign-out button. The theme toggle and user-facing controls have no hierarchy.

The existing `header-user-identity` spec requires avatar/initials and display name in the header. The `frontend-theme-system` spec requires a toggle control accessible from the frontend. Both specs will be updated so these controls live inside a popover rather than inline.

## Goals / Non-Goals

**Goals:**
- Replace loose top-right user controls with a `UserMenu` popover component
- Popover opens on trigger click, closes on Escape and click-outside
- All existing per-user actions remain accessible within the menu
- Menu is keyboard-accessible (focus trap, Escape to dismiss)
- Structure allows adding new items without refactoring

**Non-Goals:**
- Undo/redo and dashboard appearance controls are not per-user actions — they stay in the command bar and are not moved
- Persisting menu state across sessions
- Adding new menu actions (notifications, settings) in this ticket

## Decisions

**Decision: Local React state for open/closed (no Redux)**
The popover is ephemeral UI state. Redux is for shared application state. `useState` in `UserMenu` suffices — consistent with how `DashboardAppearanceEditor` manages its own editor visibility.

**Decision: Single `UserMenu` component in `frontend/src/components/UserMenu.tsx`**
Keeps the component co-located with other shared UI components. `AppShell` passes `currentUser`, `theme`, `toggleTheme`, and `onLogout` as props so `UserMenu` stays presentational and testable.

**Decision: `useEffect` click-outside listener + `onKeyDown` Escape handler**
Standard pattern already used in the codebase for modals. Attaches a `mousedown` listener to `document` and checks `ref.current.contains(event.target)`. Cleans up on unmount.

**Decision: CSS-only popover positioning (no external dependency)**
The app already manages complex CSS via `App.css` and theme tokens. No need to introduce Floating UI or Popper.js for a single anchored popover. Absolute positioning relative to the trigger container is sufficient.

**Decision: Modify `header-user-identity` and `frontend-theme-system` specs (MODIFIED)**
These specs define WHERE the controls appear. Since the popover changes the location from inline-header to inside-popover, the requirements change at spec level, not just implementation level.

## Risks / Trade-offs

[Risk: Focus management on popover open] → On open, move focus to the first menu item so keyboard users can navigate immediately. Close returns focus to the trigger button.

[Risk: Popover clipped by header overflow] → The command bar likely has `overflow: visible`. Confirm in CSS and add `position: relative` to the trigger wrapper if needed.

## Planner Notes

- Self-approved: pure frontend UI refactor, no API or schema changes, no new dependencies
- Undo/redo buttons and `DashboardAppearanceEditor` are context-specific (dashboard view only) and are not per-user controls — they deliberately stay outside the menu
