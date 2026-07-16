# table-panel-display-config Specification

## Purpose
Defines persisted per-panel `density` and `columnOrder` on `TablePanelConfig` — storage shape,
absent-field defaults (normal density; all columns visible in natural order), wire tolerance, and
how the stored values render through `DataGrid` props on every surface including the mobile stack.
## Requirements
### Requirement: TablePanelConfig persists optional density and columnOrder
`TablePanelConfig` SHALL carry an optional `density` field (one of `"condensed"`, `"normal"`,
`"spacious"`) and an optional `columnOrder` field (an ordered array of visible data-column keys)
alongside `dataTypeId`, `fieldMapping`, and `columnWidths` — in the TypeScript type, the
`TableConfig` definition in `schemas/panel.schema.json`, the backend `TablePanelConfig`
decode/patch path, and the `panels` table (dedicated nullable columns added by a single Flyway
migration). Existing rows SHALL require no data migration: NULL/absent values mean the defaults.

#### Scenario: Existing panels migrate cleanly with defaults
- **WHEN** the migration runs against a database with existing Table panel rows
- **THEN** all existing rows keep NULL for the new columns and those panels render with normal
  density and all columns visible in natural order

#### Scenario: Config round-trips through persistence
- **WHEN** a Table panel is saved with `density: "spacious"` and `columnOrder: ["b", "a"]` and
  then read back
- **THEN** the returned config contains exactly `density: "spacious"` and
  `columnOrder: ["b", "a"]`, with `columnWidths` unchanged

#### Scenario: Absent fields on the wire are tolerated
- **WHEN** a panel PATCH or create payload for a Table panel omits `density` and `columnOrder`
  entirely (fields absent, not null)
- **THEN** the request succeeds and previously stored values are left unchanged by a PATCH (and
  default to absent on create)

#### Scenario: Null clears a stored value
- **WHEN** a panel PATCH sends `density: null` or `columnOrder: null` for a Table panel with
  stored values
- **THEN** the stored value is cleared and the panel reverts to the default behavior for that
  field

#### Scenario: Invalid density on PATCH is rejected
- **WHEN** a panel PATCH carries a `density` value outside the three allowed literals
- **THEN** the request fails with a 400 (allow-list check in `Patch.decode` via
  `RequestValidation.validateTableDensity`, mirroring the `imageFit` precedent) and nothing is
  persisted

#### Scenario: Invalid density on the lenient read/create path is treated as absent
- **WHEN** a stored or create-path config value for `density` is wrong-typed or outside the
  allowed literals
- **THEN** the lenient `decode` path treats it as absent (normal density) and never stores the
  invalid value as-is

### Requirement: New config columns persist through the shared config-column write path
The `table_density` and `column_order` columns SHALL be added to the
`configColumnsOf`/`configColumnValuesOf` tuple pair in `PanelRepository.scala` so both
`PanelRepository.replace` and the batch-update config path write them, and persistence SHALL be
verified through the repository or endpoint write path (not only an in-memory mapper round-trip).

#### Scenario: PATCHed display config survives a re-read from the database
- **WHEN** a Table panel PATCH sets `density` and `columnOrder` and the panel is subsequently
  fetched through the repository
- **THEN** the fetched panel's config contains the patched values

### Requirement: Table panels render persisted density through DataGrid
When a Table panel's `config.density` is set, `TableRenderer` SHALL pass it to `DataGrid`'s
`density` prop. When absent or `"normal"`, the panel SHALL render with normal density
(`DataGrid`'s full-variant default). This SHALL apply on every surface that renders the panel,
including the read-only mobile panel stack.

#### Scenario: Stored density is applied
- **WHEN** a Table panel with `density: "condensed"` renders
- **THEN** its `DataGrid` renders with condensed row spacing

#### Scenario: Absent density renders normal
- **WHEN** a Table panel with no stored `density` renders
- **THEN** its `DataGrid` renders with normal row spacing

#### Scenario: Density applies in the mobile stack
- **WHEN** a dashboard containing a Table panel with `density: "spacious"` is viewed at a mobile
  viewport (below 768px)
- **THEN** the panel in the mobile stack renders with spacious row spacing

### Requirement: columnOrder controls column visibility and order
When `config.columnOrder` is absent or empty, a Table panel SHALL render all data columns in
natural order. When non-empty, the panel SHALL render exactly the listed column keys, in list
order, intersected with the keys actually present in the data: listed keys missing from the data
SHALL be skipped (never rendered as empty columns), and data keys missing from the list SHALL be
hidden.

#### Scenario: Absent columnOrder shows all columns
- **WHEN** a Table panel with no stored `columnOrder` renders rows with keys `a`, `b`, `c`
- **THEN** columns `a`, `b`, `c` all render in natural order

#### Scenario: columnOrder reorders and hides columns
- **WHEN** a Table panel with `columnOrder: ["c", "a"]` renders rows with keys `a`, `b`, `c`
- **THEN** exactly two columns render, `c` then `a`, and `b` is hidden

#### Scenario: Stale keys are skipped
- **WHEN** a Table panel with `columnOrder: ["gone", "a"]` renders rows whose keys are `a`, `b`
- **THEN** only column `a` renders and no empty `gone` column appears

