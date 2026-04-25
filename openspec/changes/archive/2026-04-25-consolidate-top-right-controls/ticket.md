# HEL-61 — Consolidate top-right controls into a popover menu

## Context

The top-right corner of the app currently has several controls clumped together — user avatar, theme toggle, and other actions — with no clear hierarchy or room to grow. As more features ship (settings, notifications, account management), this area will become increasingly cluttered.

## What changes

* Replace the loose collection of top-right controls with a single trigger button (e.g. avatar or menu icon) that opens a clean popover/dropdown menu
* All existing actions (theme toggle, user info, logout, etc.) move into the menu
* Menu is keyboard-accessible, dismisses on Escape and click-outside
* Component is designed to accept new menu items easily as future actions are added

## Acceptance criteria

- [ ] A single trigger button in the top-right opens a popover menu containing all previously clumped controls
- [ ] The menu dismisses on Escape and on click-outside
- [ ] All existing actions (theme toggle, logout, etc.) are accessible from within the menu
- [ ] No controls remain floating loose in the top-right outside the trigger button
- [ ] Menu structure is easy to extend with new items without structural refactoring
