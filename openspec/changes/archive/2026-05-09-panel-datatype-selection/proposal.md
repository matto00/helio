## Why

The panel creation flow currently allows panels to be created without a DataType binding, leaving them
in an unbound state that produces empty/placeholder content. To enforce the pipeline → DataType → Panel
chain defined in HEL-145, data-bound panel types must require a DataType selection before the panel can
be created, ensuring every panel is immediately wired to real data.

## What Changes

- The panel creation modal gains a **DataType picker step** inserted between template selection and title
  entry, shown only for data-bound panel types (metric, chart, text, table)
- The DataType picker lists only DataTypes produced by at least one registered pipeline (Type Registry
  filter); if none are available, an empty state links to pipeline creation
- The Create button on the final step is disabled until a DataType is selected (for data-bound types)
- `POST /api/panels` accepts and persists a `dataTypeId` field in the request body
- The backend validates that the provided `dataTypeId` refers to an existing DataType
- Non-data-bound types (markdown, image, divider) skip the DataType step entirely

## Capabilities

### New Capabilities
- `panel-creation-datatype-step`: DataType picker step in the panel creation modal — lists registry
  DataTypes, enforces selection for data-bound types, passes dataTypeId through to the create request

### Modified Capabilities
- `panel-creation-modal`: Gains a new step (DataType selection) between template and title steps for
  data-bound panel types; modal step count and back-navigation update accordingly
- `frontend-panel-creation`: Create request payload now includes `dataTypeId` for data-bound panels;
  create is blocked until a DataType is selected
- `panel-datatype-binding`: Clarifies that `typeId` is now set at creation time (not only via post-creation
  PATCH), and creation-time binding satisfies the bound-panel requirements

## Impact

- **Frontend**: `PanelCreationModal` and its step components; `panelsSlice` create thunk payload
- **Backend**: `POST /api/panels` route + `PanelRepository.create`; `panels` DB table (dataTypeId column
  already exists from prior migration); `JsonProtocols` for panel create request
- **Schema**: `schemas/panel-create-request.json` gains required `dataTypeId` for data-bound types
- **No new external dependencies**

## Non-goals

- Changing how an existing panel's DataType binding is updated (that is handled by PATCH, covered by
  `panel-datatype-binding` spec)
- Migrating previously unbound panels created before this change
- DataType creation from within the panel creation modal
