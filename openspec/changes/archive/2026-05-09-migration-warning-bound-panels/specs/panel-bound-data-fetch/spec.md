## MODIFIED Requirements

### Requirement: DataSource is not directly accessible from panel rendering code
The `sources` Redux slice SHALL NOT be read in panel rendering contexts. All data resolution
from DataType to DataSource is handled server-side by the execute endpoint. Frontend panel
components and hooks MUST NOT traverse `dataType.sourceId` to reach a DataSource for data
fetching purposes. However, `dataType.sourceId` MAY be read by the `useLegacyBoundPanel` hook
for the sole purpose of detecting legacy-bound panels and displaying a migration warning banner;
this read is for UI signalling only and does not affect the data fetch path.

#### Scenario: Panel hook does not import or read sources slice
- **WHEN** `usePanelData` is invoked
- **THEN** it dispatches `fetchPanelPage` and reads from `panelsSlice.paginationState`; it does not access `sourcesSlice` state

#### Scenario: useLegacyBoundPanel reads dataTypesSlice only for warning, not data fetch
- **WHEN** `useLegacyBoundPanel` reads `dataType.sourceId`
- **THEN** it returns a boolean warning flag only; it does NOT initiate any data fetch from the DataSource directly
