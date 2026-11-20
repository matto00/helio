# feature-stylesheet-hover-gating Specification

## Purpose
Feature stylesheets outside the shared component library and the pipeline page apply hover effects only on pointers
that can hover, so a touch tap never leaves a hover fill stuck, while desktop hover looks exactly as before.

## Requirements

### Requirement: Feature stylesheet hover effects apply only on hover-capable pointers
Hover fills, colour, border, outline, filter and transform changes defined by any stylesheet under `frontend/src/`
outside the shared component directory and the pipeline page's guarded stylesheets SHALL apply only when the primary
input can hover. Focus, active, selected, pressed, expanded and disabled states SHALL be unaffected, and on a
hover-capable pointer every computed hover and rest style SHALL be identical to before.

#### Scenario: No sticky hover after a tap on a feature control
- **WHEN** a user on a touch device whose primary pointer cannot hover taps a named feature control that stays mounted
- **THEN** once the tap's effect has settled, that control shows its rest background, border and text colour, not its
  hover ones, in light and dark

#### Scenario: Desktop hover unchanged
- **WHEN** a mouse hovers a named feature control on a hover-capable device, in light or dark
- **THEN** the control shows the same computed hover background, border and text colour as before this change

#### Scenario: A hover reveal stays reachable on touch
- **WHEN** a control is shown only through a hover reveal (for example a sidebar row's actions menu)
- **THEN** that reveal keeps working on a touch device exactly as before this change

### Requirement: Feature stylesheet hover gating is guarded
An automated check SHALL fail when any `:hover` selector in a stylesheet under `frontend/src/` outside the shared
component directory and the pipeline page's guarded stylesheets sits outside `@media (hover: hover)` and is not a named
reveal on its allowlist, when a gated rule mixes a `:hover` selector with a non-hover one, or when an allowlist entry no
longer matches a rule. DESIGN.md SHALL name this check alongside the shared and pipeline checks.

#### Scenario: An ungated feature hover rule fails the check
- **WHEN** a `:hover` rule in any covered feature stylesheet is moved outside `@media (hover: hover)`
- **THEN** the check fails and names that file and selector

#### Scenario: A new feature stylesheet is covered without editing the check
- **WHEN** a new stylesheet with an ungated `:hover` rule is added anywhere under `frontend/src/` outside the shared
  component directory
- **THEN** a hover gating check fails for it

#### Scenario: A stale reveal entry fails the check
- **WHEN** a reveal allowlist entry's rule is removed or renamed
- **THEN** the check fails and names the entry
