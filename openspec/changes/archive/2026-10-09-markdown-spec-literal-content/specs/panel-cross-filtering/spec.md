## ADDED Requirements

### Requirement: A markdown Output panel is never a cross-filter target

A panel that places a `markdown`-kind Output SHALL NOT be a cross-filter target, regardless of any `fieldMapping`
stored in that Output's config. A markdown Output has no data binding and renders its literal `config.content`, so
an active cross-filter SHALL leave such a panel's rendered content unchanged and SHALL NOT show a cross-filter
loaded-scope disclosure on it. A `fieldMapping` left on a markdown Output by the legacy data-bound migration SHALL
NOT count as "a field mapping that references the filter's dimension" for the narrowing requirement above.

#### Scenario: A legacy stored markdown fieldMapping does not make the panel a target
- **WHEN** a cross-filter `dimension: "region"` is active
- **AND** a sibling panel places a markdown Output whose stored config contains `fieldMapping: {content: "region"}`
- **THEN** that panel is not treated as a cross-filter target and renders its literal `config.content` unchanged

#### Scenario: A current markdown Output is not a target
- **WHEN** a cross-filter is active
- **AND** a sibling panel places a markdown Output whose config has an empty or absent `fieldMapping`
- **THEN** that panel is not treated as a cross-filter target
