# panel-appearance-settings Specification

## Purpose
Defines the requirements for panel-level visual appearance settings, including how appearance data is
represented in API responses, persisted through updates, and validated against the schema.
## Requirements
### Requirement: Panel resources expose nested appearance settings
Panel resources MUST include a nested `appearance` object that carries panel-level visual customization settings.

#### Scenario: Panel response includes appearance object
- **WHEN** a client fetches panel resources for a dashboard
- **THEN** each panel response includes an `appearance` object
- **AND** the `appearance` object is represented separately from `meta`
- **AND** the `appearance` object includes the supported panel background, color, and transparency settings

### Requirement: Panel appearance settings are persisted through resource updates
The backend MUST persist supported panel appearance settings so they are returned on subsequent reads.

#### Scenario: Panel appearance is updated
- **GIVEN** an existing panel
- **WHEN** a client submits an update that changes the panel `appearance`
- **THEN** the panel stores the updated background, color, and transparency settings
- **AND** a later fetch for that panel returns the saved `appearance`

### Requirement: Panel appearance contract is validated
The panel schema MUST validate the nested appearance object shape.

#### Scenario: Panel schema defines appearance
- **WHEN** panel payloads are validated against the schema
- **THEN** the schema requires an `appearance` object
- **AND** the appearance object validates the supported panel appearance fields

### Requirement: Panel appearance chartType is validated
The panel schema MUST validate the optional `chartType` field within the appearance object.

#### Scenario: Panel schema validates chartType values
- **WHEN** panel payloads are validated against the schema
- **THEN** the appearance object accepts an optional `chartType` field
- **AND** `chartType` MUST be one of: line, bar, pie, scatter when present

#### Scenario: Panel schema rejects unknown chartType values
- **WHEN** a panel appearance payload contains a `chartType` value not in the allowed set
- **THEN** schema validation fails with an error indicating the invalid value

#### Scenario: Panel schema accepts payload without chartType
- **WHEN** a panel appearance payload omits the `chartType` field
- **THEN** schema validation succeeds and the panel is stored without a chartType

### Requirement: Panel transparency slider produces a smooth and well-distributed alpha range
The panel transparency slider (0–100) SHALL map to an alpha range that produces a perceptible
and smoothly-distributed change in panel surface opacity across the full slider travel.

#### Scenario: Panel surface is nearly opaque at zero transparency
- **WHEN** a panel's transparency is set to 0
- **THEN** the `buildPanelSurface` function returns an rgba value with an alpha at or near 0.9

#### Scenario: Panel surface is significantly transparent at maximum transparency
- **WHEN** a panel's transparency is set to 100
- **THEN** the `buildPanelSurface` function returns an rgba value with an alpha at or near 0.18

#### Scenario: Panel transparency alpha decreases monotonically across the slider range
- **WHEN** transparency increases from 0 to 100
- **THEN** the resulting surface alpha decreases monotonically with no discontinuities

