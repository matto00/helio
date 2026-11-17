# shared-control-hover-gating Specification

## Purpose
Shared components (icon buttons, popover and actions-menu triggers and items, selects, modal footer buttons, segmented
radios, disclosure summaries, data-grid and table-header controls, and every other control styled under the shared
component library) apply hover effects only on pointers that can hover, so a touch tap never leaves a fill stuck,
while desktop hover looks exactly as before.

## Requirements

### Requirement: Shared component hover effects apply only on hover-capable pointers
Hover-only fills, colour, border and transform changes defined by the shared component styles SHALL apply only when the
primary input can hover. Focus, keyboard-focused option, active, pressed, selected and disabled states SHALL be
unaffected, and on a hover-capable pointer the hover appearance SHALL be identical to before.

#### Scenario: No sticky fill after a tap in the phone step sheet
- **WHEN** a user on a touch device whose primary pointer cannot hover taps a shared control in the phone step sheet:
  the step actions menu trigger, an actions-menu item (observed when the menu is reopened), a Select trigger, or a
  step editor's disclosure summary
- **THEN** once the tap's effect has settled, that control shows its rest background, border and text colour, not its
  hover ones, in light and dark

#### Scenario: No sticky fill after a tap on the phone pipeline page
- **WHEN** a user on a touch device whose primary pointer cannot hover taps a source card's refresh-sample icon button,
  or a modal footer button in a dialog on the phone pipeline page (observed when the dialog is reopened)
- **THEN** once the tap's effect has settled, that control shows its rest background, border and text colour, in light
  and dark

#### Scenario: Desktop hover unchanged
- **WHEN** a mouse hovers any of the controls in the two scenarios above on a hover-capable device, in light or dark
- **THEN** the control shows the same hover background, border and text colour as before this change

#### Scenario: Keyboard focus in an open Select is unchanged
- **WHEN** the user moves through an open Select's options with the arrow keys on any device
- **THEN** the focused option shows its focused background exactly as before

### Requirement: Hover gating is a written, guarded rule
DESIGN.md SHALL state that hover effects are declared inside `@media (hover: hover)`, that hover reveals needed for
reachability are named exceptions, and that focus/active/selected/pressed states are never gated. An automated check
SHALL fail when any `:hover` selector in a shared component stylesheet, or in the pipeline page stylesheets HEL-1668
already guards, sits outside `@media (hover: hover)` without a named exception, or when a gated rule mixes a `:hover`
selector with a non-hover one.

#### Scenario: An ungated shared hover rule fails the check
- **WHEN** a `:hover` rule in any shared component stylesheet is moved outside `@media (hover: hover)`
- **THEN** the check fails and names that file and selector

#### Scenario: A new shared stylesheet is covered without editing the check
- **WHEN** a new stylesheet with an ungated `:hover` rule is added under the shared component directory
- **THEN** the check fails for it
