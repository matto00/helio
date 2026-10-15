## REMOVED Requirements

### Requirement: One bound row renders one collection item
**Reason**: Names a "bound collection panel" and a "bound DataType" snapshot. DataTypes were deleted by the pipelines-and-outputs remodel and `collection` is an Output kind (`OutputPanelContent.tsx` dispatches `kind === "collection"` to `CollectionRenderer` inside an `output` panel). The one-item-per-row behaviour is unchanged and is restated against the Output path.
**Migration**: See "A collection Output renders one metric item per loaded row".

### Requirement: Literal item options override bound slots
**Reason**: `itemOptions.metric.label`/`unit` no longer exist as config: a collection Output accepts no `itemOptions` key (`OutputConfigValidation.KnownKeys`), and `OutputPanelContent` passes `CollectionRenderer` no `metricOptions` (the renderer's `metricOptions` prop has no non-test caller).
**Migration**: A collection item's label and unit come from the Output's `fieldMapping` `label` and `unit` slots (see "A collection Output's config is fieldMapping, layout, format and conditionalFormats").

### Requirement: Collection empty and unbound states
**Reason**: Its "unbound collection panel (no `outputId`)" half describes a panel that cannot be created (the backend rejects an `output` panel without an `outputId` at create) and has no placeholder in the renderer path. The zero-row half is restated below with the panel-level states the code actually produces.
**Migration**: See "A collection with no rows shows a no-data state".

## ADDED Requirements

### Requirement: A collection Output renders one metric item per loaded row
An `output` panel bound to a collection-kind Output SHALL render one item per loaded row of the Output's rows, each item
produced by applying the Output's `fieldMapping` (`value`, `label`, `unit` slots) to that row. Each item SHALL reuse the
Metric renderer (large value with optional adjacent unit, label) and apply the Output's `format` and `conditionalFormats`
to its own raw value.

#### Scenario: Multi-row Output expands to N items
- **WHEN** a collection Output with `value` and `label` mapped has 5 loaded rows
- **THEN** the panel body renders exactly 5 metric items, each showing that row's mapped value and label

#### Scenario: Item slots resolve per row
- **WHEN** two rows carry different values in the column mapped to `value`
- **THEN** the two rendered items show their own row's value, not a shared one

#### Scenario: Format applies to every item
- **WHEN** the collection Output's `config.format` is `"percent"`
- **THEN** every rendered item shows its value in the percent display style

### Requirement: A collection with no rows shows a no-data state
When the collection Output has no fetched rows, the panel SHALL show the panel-level "No data available" state, or "Not
run yet" when the Output's node was never materialized by a pipeline run, rather than an empty body. A collection
renderer that is given no rows (for example when a viewer filter removes every loaded row) SHALL show a "No data" state.

#### Scenario: Zero fetched rows shows the panel-level state
- **WHEN** a collection Output's node has run and returned zero rows
- **THEN** the panel shows "No data available"

#### Scenario: Renderer given no rows shows No data
- **WHEN** the collection renderer receives an empty row list
- **THEN** the body shows a "No data" state
