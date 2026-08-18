# HEL-718: Add an IconButton primitive + DESIGN.md tooltip recipe for icon-only buttons

## Description

From the beta UI/UX polish sweep (PR #382).

**Scope**
Icon-only buttons (kebab menus, close buttons, theme toggle, sidebar collapse, etc.) are hand-rolled independently across the codebase with inconsistent sizing, hover states, and — critically — inconsistent tooltip/aria-label coverage. Add a shared `IconButton` primitive (accessible name required at the type level) and document its recipe + a tooltip pattern in DESIGN.md, then migrate existing icon-only buttons onto it.

## Acceptance Criteria

* `IconButton` exists in `shared/ui/`, documented in DESIGN.md §5/§6.
* Every icon-only interactive element in the app has a visible or accessible tooltip/label.
