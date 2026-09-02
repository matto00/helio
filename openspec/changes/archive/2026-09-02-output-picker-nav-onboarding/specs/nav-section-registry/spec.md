## REMOVED Requirements

### Requirement: The primary nav destination list is derived from the registry
**Reason**: The nav destination set itself shrinks (Data Types and Metrics removed); rewritten wholesale against the new five-entry set rather than incrementally modified, since the removed entries were named in the original scenario.
**Migration**: See the new "The primary nav destination list is exactly five entries, derived from the registry" requirement (this same change).

### Requirement: One registry resolves every chrome route to label/icon/picker
**Reason**: The `PickerId` union itself drops two values (`registry`, `metrics`); rewritten wholesale against the new union rather than incrementally modified.
**Migration**: See the new "One registry resolves every chrome route to label/icon/picker, with no registry/metrics picker id" requirement (this same change), which preserves this requirement's general resolution/registry-edit behavior.

## ADDED Requirements

### Requirement: The primary nav destination list is exactly five entries, derived from the registry
The registry's nav-visible entries SHALL be exactly: Dashboards, Data Sources, Data Pipelines, Connectors, Assistant, and this list SHALL be the single source every nav-deriving surface (sidebar rail, bottom tab bar, mobile nav sheet, onboarding glyphs) reads from — no surface hardcodes an independent list.

#### Scenario: Nav-visible entries match the registry
- **WHEN** the registry's nav-visible entries are read
- **THEN** they are exactly Dashboards, Data Sources, Data Pipelines, Connectors, Assistant, in that order

#### Scenario: Five nav destinations are shown everywhere
- **WHEN** any nav-deriving surface (sidebar, bottom nav, mobile sheet) renders
- **THEN** exactly five destinations appear, matching the registry
- **AND** no Data Types or Metrics entry appears anywhere

### Requirement: One registry resolves every chrome route to label/icon/picker, with no registry/metrics picker id
Every route SHALL resolve a label from the registry, and adding a new route SHALL require only a registry edit (no second hardcoded mapping elsewhere). The `PickerId` union SHALL NOT include `"registry"` or `"metrics"`; `/registry`, `/registry/:id`, `/metrics`, `/metrics/:id` are not registered routes and resolve to no chrome section (decision 11 — no stubs or redirects).

#### Scenario: Every route resolves a label from the registry
- **WHEN** any registered chrome route is rendered
- **THEN** its label and icon (if nav-visible) come from the registry, not a separate hardcoded mapping

#### Scenario: Adding a route requires only a registry edit
- **WHEN** a new route is added to the registry array
- **THEN** every nav-deriving surface picks it up with no additional code change

#### Scenario: Retired routes have no chrome mapping
- **WHEN** the registry is queried for `/registry` or `/metrics`
- **THEN** no matching section entry is found — these paths are not registered routes at all
