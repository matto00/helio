# user-menu-popover Specification

## Purpose
Consolidates all per-user controls (theme, display name, sign-out, accent color) into a single avatar-triggered popover in the app header, removing loose controls from the command bar.
## Requirements
### Requirement: Single trigger button opens user menu popover
The app header top-right SHALL render a single trigger button (avatar image or initials fallback) that opens a popover menu when clicked. No per-user controls SHALL appear outside this trigger.

#### Scenario: Trigger opens popover on click
- **WHEN** the user clicks the avatar/initials trigger button in the top-right
- **THEN** a popover menu appears containing all per-user controls

#### Scenario: No loose controls outside trigger
- **WHEN** the user is authenticated
- **THEN** theme toggle, display name, and sign-out are only accessible inside the popover, not rendered as standalone elements in the command bar

### Requirement: Popover dismisses on Escape key
The popover SHALL close when the user presses the Escape key while the popover is open.

#### Scenario: Escape closes open popover
- **WHEN** the popover is open and the user presses Escape
- **THEN** the popover closes and focus returns to the trigger button

### Requirement: Popover dismisses on click-outside
The popover SHALL close when the user clicks anywhere outside the popover and trigger button.

#### Scenario: Click outside closes popover
- **WHEN** the popover is open and the user clicks outside the UserMenu component
- **THEN** the popover closes

### Requirement: Popover is keyboard-accessible
The popover SHALL be keyboard navigable. Focus SHALL move into the first menu item when the popover opens.

#### Scenario: Focus moves into menu on open
- **WHEN** the popover opens via keyboard or mouse
- **THEN** focus is placed on the first interactive item inside the popover

### Requirement: UserMenu accepts extensible items
The `UserMenu` component SHALL be structured so that new menu items can be added without structural refactoring of the component itself.

#### Scenario: New item added without restructuring
- **WHEN** a developer adds a new entry to the menu items list
- **THEN** the new item renders in the popover without changes to the component's core structure

### Requirement: UserMenu popover is viewport-aware and never clips
The UserMenu popover SHALL render via `createPortal` to `document.body` with `position: fixed`
and coordinates calculated from the trigger element's `getBoundingClientRect()`, so that the
popover is never clipped by any parent overflow or stacking context.

#### Scenario: Popover renders outside parent stacking context
- **WHEN** the user opens the UserMenu popover
- **THEN** the popover panel is a direct child of `document.body` in the DOM
- **AND** the panel is fully visible regardless of parent overflow settings

#### Scenario: Popover position matches trigger alignment
- **WHEN** the user opens the UserMenu popover
- **THEN** the panel top is aligned to the bottom of the trigger button with an 8 px gap
- **AND** the panel right edge aligns with the right edge of the trigger button

