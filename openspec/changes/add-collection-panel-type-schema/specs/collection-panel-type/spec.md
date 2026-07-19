## ADDED Requirements

### Requirement: Collection appears in every panel-type contract surface

Every contract surface that enumerates panel `type` values SHALL include `collection`, matching the
backend `PanelType` canonical set. This covers the JSON Schemas
`create-panel-request.schema.json`, `panel.schema.json`, `update-panels-batch-request.schema.json`,
and `dashboard-proposal.schema.json`, and the helio-mcp proposal tool's `PANEL_TYPES` enum. Every
surface that enumerates *data-panel* kinds (kinds requiring a bound DataType) SHALL include
`collection`, matching the backend `DataPanelKinds` set — this covers helio-mcp's `DATA_PANEL_TYPES`
and the Proposal Review UI's `DATA_PANEL_TYPES` (`ProposalReview.tsx`), which drives the "needs bound
DataType" warning. A CI schema-parity check SHALL fail when any of these surfaces diverges from the
backend canonical sets, so a newly added panel type cannot ship without updating every surface.

#### Scenario: Batch update accepts a collection panel

- **WHEN** an `update-panels-batch-request` payload contains an item with `type: "collection"`
- **THEN** the JSON Schema validates the payload as conformant

#### Scenario: A dashboard proposal may contain a collection panel

- **WHEN** a `dashboard-proposal` payload contains a panel with `type: "collection"`
- **THEN** the JSON Schema validates the payload as conformant

#### Scenario: helio-mcp propose tool accepts collection panels

- **WHEN** the helio-mcp proposal tool validates a panel with `type: "collection"`
- **THEN** the panel passes the tool's panel-type validation and is treated as a data panel
  (requiring `dataTypeId`), matching the backend

#### Scenario: Proposal Review UI flags an unbound collection panel

- **WHEN** a proposal containing a collection panel with no bound DataType is shown in the Proposal
  Review UI
- **THEN** the panel is treated as a data panel and surfaces the "needs bound DataType" warning,
  rather than rendering as if no binding is required

#### Scenario: Parity check fails on a missing panel type

- **WHEN** any enumerating surface omits a panel type present in the backend `PanelType` canonical set
- **THEN** the `npm run check:schemas` parity check exits non-zero and names the diverging surface
