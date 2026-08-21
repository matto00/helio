## Why

`MobileNavSheet` rises from the bottom edge while the control that summons it sits at the top of the screen,
so the motion runs away from its trigger and covers the content being navigated between. The sheet is also a
dead end for creation. HEL-772 has since landed the top-chrome safe-area seam this inversion needs.

## What Changes

- Re-anchor the sheet — and its scrim — to the **top** edge from the existing `--app-top-chrome-height` seam,
  so it descends from a command bar that stays lit. The inset is consumed, never re-derived.
- Invert the entrance and the drag gesture, preserving backdrop tap, Escape, focus trap, focus restore, and
  `prefers-reduced-motion`.
- **BREAKING (spec-level):** the sheet gains a section-appropriate create action, narrowing the current
  "picker only, no CRUD" requirement. Labels and glyphs come from the HEL-548 hooks, consumed read-only.
- The empty branch renders the shared `EmptyState` primitive instead of a bare `<p>`, carrying that create
  action as its CTA and suppressing the header action so exactly one is ever visible (bounded HEL-782).
- Applies to every section using the pattern, via the one shared component and `usePickerSelection`. The type
  registry gets the create-pipeline CTA in its empty branch only, matching the desktop sidebar.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `mobile-dashboard-sheet`: top-anchored rather than bottom-anchored; dismissal inverts to swipe-up; the
  no-CRUD prohibition narrows to permit one create action; the empty branch gains a CTA-capable primitive.

## Impact

- `MobileNavSheet.tsx`/`.css` and their test locks; `usePickerSelection.ts`; `MobileShell.tsx`; `CommandBar`;
  `App.tsx` (the trigger becomes a toggle).
- Consumes read-only: the HEL-772 top-chrome tokens, the HEL-548 hooks, `EmptyState`.

## Non-goals

- No change to the HEL-548 hooks, any modal mount site, or `SidebarBody`/`SidebarItemList`/`DashboardList`
  (HEL-554 runs concurrently on those seams).
- No create action for metrics or assistant — neither has a shared hook.
- No gesture polish beyond the inversion (HEL-565 parked); no bottom-nav or command-bar geometry change.
