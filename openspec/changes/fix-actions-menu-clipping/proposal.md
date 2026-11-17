## Why

The shared ⋮ ActionsMenu opens its portalled, `position: fixed` panel at a one-shot `top = trigger.bottom + 8` with no
vertical collision handling. A live probe (dark theme, 1280x400, last rail dashboard row) put the 165px panel at y
353-518 against a 400px viewport: Rename and Duplicate visible, Share, Export and Delete off screen and unreachable —
the owner's report. No ancestor clips it (panel parent is `<body>`, no transform/contain/overflow on its path); the
suspected overflow container is not the cause. Every ActionsMenu call site (13) shares the defect.

## What Changes

- ActionsMenu measures its mounted panel and fits it to the viewport: opens on its requested side when it fits, flips
  to the other side when that fits, otherwise opens on the roomier side with its height capped to the room and the
  rest scrolling inside the menu. Hidden until placed, so no visible jump.
- Placement reuses `usePortalPopover`'s existing opt-in `place` mechanism (HEL-1668) and generalises the Select
  listbox's fit arithmetic (HEL-1373) into one shared helper, rather than a per-container tweak.
- The menu stays inside the viewport horizontally (existing clamp behaviour preserved).
- An e2e, red first: open the ⋮ on the last dashboard-list row in a short viewport and assert the last item is inside
  the viewport and is `elementFromPoint` at its own centre; desktop and phone.
- Every other ActionsMenu call site is checked and listed (fixed by the shared change or noted).

## Non-goals

- Changing menu items, styling, hover CSS (HEL-1675) or keyboard behaviour.
- Other popovers (UserMenu, DashboardAppearanceEditor, panel provenance) — listed in the call-site audit if exposed,
  filed as a follow-up rather than changed here.

## Capabilities

### New Capabilities
- `actions-menu-viewport-fit`: the ⋮ actions menu always opens fully reachable inside the viewport.

### Modified Capabilities

## Impact

Frontend only: `shared/chrome/ActionsMenu.tsx` (+css), `hooks/usePortalPopover.ts` (if needed), a shared fit helper
extracted from `shared/ui/selectPanelFit.ts` (Select keeps its behaviour), unit tests, one new e2e. No API or schema
change.
