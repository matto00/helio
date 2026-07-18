# type-registry-provenance — delta spec (change: type-registry-origin-distinction)

## ADDED Requirements

### Requirement: Registry sidebar entries show producing-pipeline provenance
The Type Registry sidebar SHALL render, for each listed DataType whose id matches a pipeline's
`outputDataTypeId` in the loaded pipelines state, a subtitle of the form `Pipeline: <pipeline name>`
beneath the DataType name, styled with design-token typography (12px scale token, secondary text
color). When no matching pipeline is loaded for a DataType, the entry SHALL render without a
subtitle (no placeholder text).

#### Scenario: DataType produced by a loaded pipeline
- **WHEN** the registry sidebar renders a DataType whose id equals a loaded pipeline's
  `outputDataTypeId`
- **THEN** the entry shows the subtitle `Pipeline: <that pipeline's name>` under the DataType name

#### Scenario: No matching pipeline loaded
- **WHEN** the registry sidebar renders a DataType with no matching `outputDataTypeId` among loaded
  pipelines (not yet fetched, or orphaned)
- **THEN** the entry renders name (and any badge) only, with no subtitle element

### Requirement: Pipelines are fetched when the registry section is active
The frontend SHALL dispatch the existing `fetchPipelines` thunk when the registry section of the
sidebar becomes active while the pipelines slice status is `idle`, so provenance can resolve. It
SHALL NOT refetch when pipelines are already loaded or loading.

#### Scenario: Cold visit to the registry section
- **WHEN** the user navigates to `/registry` with pipelines status `idle`
- **THEN** `fetchPipelines` is dispatched once and subtitles appear after it resolves

#### Scenario: Pipelines already loaded
- **WHEN** the user navigates to `/registry` with pipelines status `succeeded`
- **THEN** no additional pipelines fetch is dispatched

### Requirement: Phone section sheet shows the same provenance
The phone section-item sheet for the registry section SHALL show the same `Pipeline: <name>`
subtitle per item, derived from the same selector as the desktop sidebar, and each sheet item's
tap target SHALL remain at least 44px tall at a 390×844 viewport.

#### Scenario: Registry sheet item with provenance
- **WHEN** the phone sheet lists a DataType matching a loaded pipeline's `outputDataTypeId`
- **THEN** the sheet item shows the `Pipeline: <name>` subtitle and its tap target is ≥44px tall

### Requirement: Other sections are unaffected by the subtitle capability
Sections that do not set a subtitle on their items (dashboards, sources, pipelines) SHALL render
identically to the pre-change UI: no subtitle element is present in their rows or sheet items,
and the sidebar filter SHALL continue to match on item name only.

#### Scenario: Sources section rows unchanged
- **WHEN** the sources section sidebar renders its items
- **THEN** no subtitle element appears in any row

#### Scenario: Filter ignores subtitle text
- **WHEN** the user types a pipeline name fragment into the registry sidebar filter that matches
  only a subtitle, not any DataType name
- **THEN** the list shows the no-matches state
