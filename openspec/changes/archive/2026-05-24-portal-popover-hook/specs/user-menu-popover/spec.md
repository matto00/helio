## ADDED Requirements

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
