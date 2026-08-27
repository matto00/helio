# sources/rest-source-authoring Specification

## Purpose
Defines the human-facing contract for authoring a REST data source from the UI, so that every
REST source shape the agent/MCP surface can produce is also reachable from the form, with Connector
selection standing in legibly for the removed auth fields.

## Requirements

### Requirement: Connector selection in the REST source form
The REST source form SHALL let the user select an existing Connector, or create one inline and
return to the form with it selected, before the source can be saved. The form SHALL display the
selected Connector's name and kind, and a statement that its credential will be applied to outbound
requests, so the absence of auth fields reads as intentional.

#### Scenario: User selects an existing Connector
- **WHEN** the user opens the REST source form and picks a Connector from the picker
- **THEN** the form shows the Connector's name/kind and applies it (`connectorId`) to the composed
  request used for test-before-save and for the create payload

#### Scenario: User creates a Connector inline
- **WHEN** the user chooses "create new" from the Connector picker and completes Connector creation
- **THEN** the form returns focus to REST source authoring with the newly created Connector selected,
  without losing any other field values already entered

### Requirement: Query params, headers, and template parameters are editable
The REST source form SHALL provide editable key/value lists for query parameters and per-source
headers, and SHALL provide an editor for `{{name}}` template parameters detected in the endpoint,
query params, headers, or body, allowing a value to be supplied for each detected parameter name.

#### Scenario: Template parameter detected in the endpoint
- **WHEN** the user types an endpoint containing `{{accountId}}`
- **THEN** the form surfaces an `accountId` value field in the template-parameters editor

### Requirement: Test-before-save reflects the fully composed request
Test-before-save (`TestConnectionAffordance`) SHALL exercise the same composed request shape
(Connector + endpoint + method + query params + headers + body + resolved template parameters)
that would be submitted on save.

#### Scenario: Test reflects unsaved changes
- **WHEN** the user edits headers after a Connector is already selected and clicks "Test connection"
- **THEN** the test request includes the edited headers, not a stale composed request

### Requirement: UI stops emitting the bare-URL create path
The REST source form SHALL require a Connector to be selected before the save/create action is
enabled, and SHALL NOT ever submit a create request carrying a bare `url` with no `connectorId`; a
source can only be created via the form with a Connector attached going forward. Because a Connector
is always required before save, template parameters are always resolvable at save/test time — the
form never allows submission of an unresolved `{{name}}` placeholder as a literal value.

#### Scenario: Existing implicitly-created source keeps working
- **WHEN** a source created before this change (with no `connectorId`, via the retired dual-support
  path, and already converted to a `connectorId` row by `RestSourceConnectorMigration` at boot) has
  its schema previewed and a pipeline run against it after this change ships
- **THEN** both succeed — retiring the UI's *create* path SHALL NOT orphan or invalidate any existing
  source or its implicitly-created Connector (no source edit form exists to re-verify via editing;
  this is proven via preview/pipeline-run instead)
