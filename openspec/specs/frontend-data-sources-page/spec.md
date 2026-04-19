## ADDED Requirements

### Requirement: /sources route renders SourcesPage
The frontend SHALL register a `/sources` route via React Router that renders `SourcesPage`. The existing `/` route continues to render the dashboard panel view. Navigation between the two routes is provided by `NavLink` components in the app sidebar with `aria-label="Main navigation"`.

#### Scenario: Navigating to /sources shows SourcesPage
- **WHEN** the user navigates to `/sources`
- **THEN** `SourcesPage` is rendered with "Data Sources" and "Type Registry" section headings visible

#### Scenario: Navigating to / shows dashboard view
- **WHEN** the user is on `/sources` and clicks the Dashboards nav link
- **THEN** the panel list and dashboard controls are visible

### Requirement: SourcesPage lists data sources
`SourcesPage` SHALL dispatch `fetchSources` and `fetchDataTypes` on mount. When sources are loaded, `DataSourceList` renders one row per source showing: name, sourceType badge, Refresh and Delete action buttons.

#### Scenario: Empty sources state
- **WHEN** `GET /api/data-sources` returns an empty list
- **THEN** "No data sources yet. Add one to get started." is displayed

#### Scenario: Delete with confirmation
- **WHEN** the user clicks the Delete button for a source
- **THEN** a confirmation prompt ("Delete?") appears before the source is removed

#### Scenario: Refresh updates the DataType
- **WHEN** the user clicks the Refresh button for a source
- **THEN** `POST /api/sources/:id/refresh` or `POST /api/data-sources/:id/refresh` is called and `fetchDataTypes` is dispatched on success

### Requirement: Two-step AddSourceModal with schema preview
`SourcesPage` SHALL include an "Add source" button that opens `AddSourceModal`. The modal has two steps:

1. **Configure**: choose source type (REST API or CSV), enter name and config fields, click "Preview schema" — calls the corresponding infer endpoint and transitions to step 2
2. **Preview**: displays an editable table of inferred fields (displayName, dataType, nullable are editable); clicking "Create source" calls the create endpoint with field overrides

#### Scenario: REST API preview flow
- **WHEN** the user enters a URL, clicks "Preview schema"
- **THEN** `POST /api/sources/infer` is called with the config and the inferred fields table is shown

#### Scenario: CSV preview flow
- **WHEN** the user selects a CSV file and clicks "Preview schema"
- **THEN** `POST /api/data-sources/infer` is called and the inferred fields table is shown

#### Scenario: Field overrides are sent on create
- **WHEN** the user edits a field's displayName in step 2 and clicks "Create source"
- **THEN** the create endpoint receives `fieldOverrides` reflecting the edited values

### Requirement: TypeRegistryBrowser with inline TypeDetailPanel
The TypeRegistry section of `SourcesPage` SHALL render a `TypeRegistryBrowser` that lists all `DataType` records from Redux state. Clicking a type opens `TypeDetailPanel` inline, showing an editable field table. Saving dispatches `updateDataType` (PATCH /api/types/:id).

#### Scenario: Selecting a type opens detail panel
- **WHEN** the user clicks a DataType row in the registry
- **THEN** `TypeDetailPanel` appears showing the type's fields with editable displayName and dataType

#### Scenario: Saving field edits
- **WHEN** the user changes a displayName and clicks "Save changes"
- **THEN** `PATCH /api/types/:id` is called with the updated fields array

#### Scenario: Empty registry state
- **WHEN** no DataTypes exist in Redux state
- **THEN** "No data types yet. Add a source to create one." is displayed

### Requirement: DataTypeField model alignment
The frontend `DataTypeField` interface SHALL be `{ name: string; displayName: string; dataType: string; nullable: boolean }`, matching the backend `DataField` wire format. The previous incorrect shape `{ name, fieldType }` SHALL be removed.

### Requirement: DataType model removes sourceType
The frontend `DataType` interface SHALL NOT include a `sourceType` field, which was never returned by the backend. Source-type information SHALL be accessed via `DataType.sourceId` (non-null means source-backed). The `PanelDetailModal` type badge SHALL use `sourceId !== null` as its condition.
## Requirements
### Requirement: AddSourceModal has a Manual/Static tab
`AddSourceModal` SHALL include a third tab labelled "Manual" alongside the existing "REST API" and "CSV" tabs. Selecting this tab SHALL show a two-step flow: Step 1 — define columns (name and type selector: string/integer/float/boolean); Step 2 — enter row values inline using inputs matched to each column's declared type. Clicking "Create source" in Step 2 SHALL POST to `/api/data-sources` with `Content-Type: application/json` and `source_type: "static"`.

#### Scenario: Manual tab is accessible
- **WHEN** the user opens `AddSourceModal`
- **THEN** a "Manual" tab is visible alongside "REST API" and "CSV"

#### Scenario: Column definition step
- **WHEN** the user selects the Manual tab
- **THEN** an "Add column" button is visible; clicking it appends a row with a name input and type selector (string/integer/float/boolean)

#### Scenario: Row entry step
- **WHEN** the user has defined at least one column and clicks "Next"
- **THEN** a row-entry grid is displayed with one column per defined field and an "Add row" button

#### Scenario: Save posts static payload
- **WHEN** the user has defined columns and rows and clicks "Create source"
- **THEN** `POST /api/data-sources` is called with `Content-Type: application/json`, `source_type: "static"`, `columns`, and `rows`

#### Scenario: Empty column list prevents progression
- **WHEN** no columns have been defined
- **THEN** the "Next" button is disabled

### Requirement: DataSourceList shows a Static badge for static sources
`DataSourceList` SHALL render a "Static" badge for sources whose `sourceType` is `"static"`, consistent with the existing badge rendering for other source types.

#### Scenario: Static badge is visible
- **WHEN** a data source with `sourceType: "static"` appears in `DataSourceList`
- **THEN** a badge with the text "Static" is rendered next to the source name

