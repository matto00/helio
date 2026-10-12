## Purpose
The shared Select signals an invalid value visually as well as to assistive technology, matching the text input's invalid state.

## ADDED Requirements

### Requirement: Invalid Select shows a visual invalid state
A shared `Select` whose trigger carries `aria-invalid="true"` SHALL render the same invalid visual state as a shared
text input: an `--app-error` border at all times, and while focused an `--app-error-surface` halo in place of the
accent focus ring, in both light and dark themes. A Select not marked invalid SHALL render unchanged.

#### Scenario: Invalid trigger has an error border
- **WHEN** a Select is rendered with `aria-invalid` true
- **THEN** its trigger's computed border colour equals `--app-error` in the light and the dark theme

#### Scenario: Focused invalid trigger shows the error halo
- **WHEN** an invalid Select trigger has keyboard focus
- **THEN** it shows an `--app-error-surface` halo, not the accent focus ring

#### Scenario: Valid Select is unchanged
- **WHEN** a Select is rendered without `aria-invalid`
- **THEN** its border and focus ring are exactly as before this change
