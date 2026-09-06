## Why

The Connector picker HEL-827 added to the REST source form lists Connectors of every kind, unfiltered, and nothing anywhere — picker, create boundary, or fetch path — rejects binding a REST source to a non-`rest_api` Connector. The mistake is accepted silently at the moment it is made and surfaces much later as an opaque fetch failure against whatever `baseUrl` the wrong Connector happened to hold. This is the epic's recurring "wrong thing that looks like a right thing" class (HEL-826, HEL-814, HEL-671), and the Connectors epic created the affordance without constraining it.

Re-confirmed against `main` at `e01aa6d4` before planning (verdict: no-drift): `ConnectorSelectField.tsx:37` has no kind predicate; `DataSourceProtocol` validates `connectorId` structurally and never loads the Connector; `RestApiConnectorDriver.resolveConnector` returns the Connector without inspecting `kind`.

## What Changes

- **Server-side kind validation at the source create/update boundary — this is the guarantee.** Creating or updating a REST data source whose `connectorId` resolves to a Connector whose `kind` is not `rest_api` is rejected with a `400` naming both the expected and the actual kind. The check lives in the service layer where the Connector is already resolvable owner-scoped, not in the decoder — per HEL-826's invariant that decode is total and validation belongs at create-time or the request-issuing choke point.
- **Server-side kind validation at the fetch choke point — this closes the pre-existing-rows hole.** `RestApiConnectorDriver`'s Connector resolution rejects a non-`rest_api` Connector with a curated error naming the kind mismatch, before any URL is composed or credential decrypted. This is what makes an already-bound mismatched source behave predictably instead of failing opaquely, and it covers rows written before this change.
- **UI filtering of the picker — this is the affordance, not the guarantee.** The REST source form's Connector picker lists only `rest_api` Connectors.
- **An explanatory empty state** when the user owns no `rest_api` Connector, replacing a bare empty dropdown, pointing at inline Connector creation.
- **No new API surface and no new request/response field, and no `schemas/` edit.** The change narrows what an existing endpoint accepts and adds one error case. Verified by search: the repo has no OpenAPI document, and `schemas/sources/` carries no REST-source create-request schema — the only `connectorId`-bearing schema sits in the HEL-973-owned pipelines directory. The OpenSpec delta under `specs/rest-api-connector/` is therefore the contract record for the new `400`. See design.md Decision 7.

Deliberately **not** doing: adding a `kind` filter query parameter to `GET /api/connectors`. `ConnectorSummary` already carries `kind`, the connector list is owner-scoped and small, and adding a server-side filter parameter would be a new API surface whose only consumer is a filter the client can already apply. This keeps the UI from being the thing that enforces anything.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities

- `rest-api-connector`: creating a REST source against a Connector whose kind is not `rest_api` is rejected at the creation boundary (there is no update path that can change `connectorId`); resolving such a Connector at fetch time fails with a curated kind-mismatch error rather than composing a request against a foreign `baseUrl`.
- `sources/rest-source-authoring`: the form's Connector picker lists only Connectors whose kind matches the source type being authored, and shows an explanatory empty state when the user owns none.

## Impact

- `backend/src/main/scala/com/helio/domain/connectors/RestApiConnectorDriver.scala` — kind guard in the Connector-resolution path.
- The REST data-source create/update service path — kind guard at the authoring boundary.
- `frontend/src/features/sources/ui/forms/ConnectorSelectField.tsx` — kind filtering and empty state.
- `openspec/specs/rest-api-connector/` + `openspec/specs/sources/rest-source-authoring/` — the contract record for the narrowed create contract and the filtered picker. No `schemas/` file is edited (design.md Decision 7).
- No database migration. No change to the `connectors` table, the `data_sources` table, or any persisted shape; the change is purely a validation narrowing plus client-side filtering.
- No overlap with concurrent runs HEL-890 (secondary-source truncation reporting) or HEL-973 (`PipelineStepRepository`, pipelines schema directory).
