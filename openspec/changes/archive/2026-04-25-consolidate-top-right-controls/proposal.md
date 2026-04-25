## Why

The app-command-bar's right section currently renders a flat list of loose controls — theme toggle, user identity block, and sign-out button — with no grouping hierarchy or room to grow. As more per-user actions ship (settings, notifications, account management), this area will become cluttered and difficult to navigate.

## What Changes

* Introduce a `UserMenu` component: a single trigger button (avatar / initials) in the top-right that opens a popover containing all per-user controls
* Move theme toggle, user display name, and sign-out into the `UserMenu` popover
* Popover dismisses on Escape keypress and click-outside
* The flat `user-identity` div and loose sign-out / theme-toggle buttons are removed from the command bar's right section
* `UserMenu` accepts an extensible `items` interface so new menu entries can be added without structural changes

## Capabilities

### New Capabilities
- `user-menu-popover`: A popover menu component triggered by the user avatar/initials in the top-right; hosts user identity, theme toggle, and sign-out, with a slot for future items

### Modified Capabilities
- `header-user-identity`: User identity (avatar/initials, display name) now lives inside the UserMenu popover rather than inline in the command bar header
- `frontend-theme-system`: Theme toggle control moves from the command bar into the UserMenu popover

## Impact

* `frontend/src/app/App.tsx` — `AppShell` right section refactored; `UserMenu` replaces loose controls
* `frontend/src/components/UserMenu.tsx` — new component (popover trigger + menu items)
* `frontend/src/app/App.css` — remove user-identity / loose btn styles; add UserMenu styles
* No backend changes; no API or schema changes

## Non-goals

* Persisting per-user menu preferences
* Adding new menu items beyond what currently exists (settings, notifications deferred)
* Changing the undo/redo or dashboard-appearance controls (those are not per-user actions)
