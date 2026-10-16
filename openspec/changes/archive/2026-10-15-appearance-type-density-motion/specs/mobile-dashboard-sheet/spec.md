## MODIFIED Requirements

### Requirement: Sheet dismissal and surface compliance
The sheet SHALL be an opaque `--app-surface-strong` surface rendered through the existing overlay infrastructure
(portal + `useOverlay` registration, following the `Modal`/`Popover` patterns — no third overlay mechanism). It SHALL
dismiss on backdrop tap, on a drag toward its anchored edge (upward, past the dismiss threshold), and on Escape, with a
single entrance animation that is disabled when reduced motion is in effect. "Reduced motion in effect" means the user saved Motion = Off, or saved no motion choice while the OS reports `prefers-reduced-motion: reduce` (appearance-preferences). A saved Full or Subtle choice is not reduced motion, whatever the OS reports. The drag affordance SHALL be
presented at the sheet's free edge — the bottom edge — rather than at the pinned top edge, and its pointer-tracked
region SHALL be at least 44px in its drag dimension. Focus SHALL be trapped while the sheet is open and restored to
the control that opened it on close.

#### Scenario: Backdrop dismisses
- **WHEN** the sheet is open and the user taps the backdrop
- **THEN** the sheet dismisses without changing the selection

#### Scenario: Swipe-up dismisses
- **WHEN** the user drags the sheet upward past the dismiss threshold
- **THEN** the sheet dismisses without changing the selection

#### Scenario: The drag strip remains a usable target
- **WHEN** the sheet is open at a 430px-wide viewport
- **THEN** the computed height of the pointer-tracked drag strip is at least 44px

#### Scenario: The sheet clears the floating bottom nav
- **WHEN** the sheet is open with a full list at a 430px-wide viewport
- **THEN** the drag strip's bottom edge sits above the floating bottom nav's top edge, so the sheet neither overlaps
  the capsule nor places its upward dismissal gesture in the home-indicator band

#### Scenario: Reduced motion disables the entrance
- **WHEN** `prefers-reduced-motion: reduce` is emulated on the running application for a user with no saved motion
  choice, or the user saved Motion = Off, and the sheet opens
- **THEN** the computed animation-name is `none` for both the sheet panel and its clipping element — the sheet
  appears in its final position rather than playing a shortened animation

#### Scenario: Initial focus lands on the list, not the create action
- **WHEN** the sheet opens
- **THEN** focus moves to the active item, or the first item when none is active — never to the create action

#### Scenario: Focus returns to the trigger
- **WHEN** the sheet is dismissed by any means
- **THEN** focus is restored to the command-bar control that opened it
