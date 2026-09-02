## REMOVED Requirements

### Requirement: Frontend panel creation is backend-backed
**Reason**: This requirement encodes the retired create-payload shape (type selection +, for data-bound types, a `dataTypeId` selected in the DataType picker step). Panel creation is now a single-click placement via the Output picker with a decision-15 server-owned default size.
**Migration**: See `output-picker`'s "Selecting an Output places it with the server-owned default size" requirement (this same change) for the current `POST /api/panels` contract.

### Requirement: Panel list refreshes after successful create
**Reason**: Rewritten wholesale against the Output-picker placement flow rather than incrementally modified, since the original scenario describes the retired create-payload shape.
**Migration**: See the new "Panel list refreshes after a successful placement or content-panel create" requirement (this same change), which preserves this requirement's refresh-on-success behavior.

### Requirement: Inline panel creation exposes simple explicit feedback
**Reason**: Same as above.
**Migration**: See the new "Placement and content-panel creation expose simple explicit feedback" requirement (this same change), which preserves this requirement's success/error feedback behavior.

## ADDED Requirements

### Requirement: Panel list refreshes after a successful placement or content-panel create
Placing an Output via the picker, or creating a content panel, SHALL refresh the dashboard's panel list so the new panel appears without a manual refresh — the same outcome `frontend-panel-creation` always guaranteed, now triggered by the picker's placement call instead of the retired wizard's create call.

#### Scenario: Panel create succeeds
- **WHEN** the user places an Output via the picker, or creates a content panel
- **THEN** the request succeeds
- **AND** the dashboard's panel list includes the new panel without requiring a manual refresh

### Requirement: Placement and content-panel creation expose simple explicit feedback
Placing an Output or creating a content panel SHALL surface simple, explicit success/error feedback — the same feedback contract `frontend-panel-creation` always guaranteed, now covering the picker's placement call and content-panel creation instead of the retired wizard's multi-step create flow.

#### Scenario: Panel create fails
- **WHEN** `POST /api/panels` fails while placing an Output or creating a content panel
- **THEN** the picker (or dashboard) shows an explicit, human-readable error rather than failing silently
