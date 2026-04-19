## ADDED Requirements

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
