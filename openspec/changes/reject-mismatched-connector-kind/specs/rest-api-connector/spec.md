## ADDED Requirements

### Requirement: A REST source cannot be bound to a non-REST Connector
Creating a REST/HTTP data source whose `connectorId` resolves to a Connector whose `kind` is not
`rest_api` SHALL be rejected with a `400` whose message names both the expected kind and the
Connector's actual kind. The check SHALL be performed at the source-creation boundary, after the
Connector has been resolved owner-scoped, and SHALL NOT be performed in the config decode path —
decode remains total. Rejection SHALL occur before the source row is written, so no mismatched
binding is ever persisted by this path. Because both the UI and the agent/MCP proposal-apply path
create REST sources through this same boundary, the guard applies uniformly to both surfaces.

There is deliberately no corresponding update-path requirement: the source update contract
(`UpdateDataSourceRequest`) carries `name` only and cannot change `connectorId`, so a
mismatched-kind binding cannot be introduced by an update.

#### Scenario: Create rejects a mismatched-kind Connector
- **WHEN** a client submits a REST source create request whose `connectorId` references a Connector
  of kind `sql`
- **THEN** the request is rejected with `400`, the error message names both `rest_api` and `sql`,
  and no `data_sources` row is created

#### Scenario: The agent/MCP proposal-apply path is guarded identically
- **WHEN** a pipeline proposal is applied whose REST source references a Connector of kind `sql`
- **THEN** the apply fails with the same kind-mismatch rejection and no source row is created

#### Scenario: A matching-kind Connector is unaffected
- **WHEN** a client creates a REST source referencing a `rest_api` Connector
- **THEN** the request succeeds and the created source's `connectorId` is the referenced Connector

#### Scenario: The kind check does not fire on the bare-url path
- **WHEN** a request uses the legacy bare-`url` shape and carries no `connectorId`
- **THEN** no Connector is resolved and the kind check does not apply

### Requirement: Fetch-time Connector resolution rejects a mismatched kind
Resolving a REST source's `connectorId` at request-issuing time SHALL fail with a curated error
naming the kind mismatch when the resolved Connector's `kind` is not `rest_api`. The failure SHALL
occur before the request URI is composed and before the Connector's credential is decrypted, so a
foreign `baseUrl` is never contacted and no credential is decrypted for a mismatched binding. This
guard makes sources bound to a mismatched Connector before this change fail predictably and
legibly rather than as an opaque fetch error. The curated error SHALL NOT leak the Connector id,
its `baseUrl`, or any credential material.

#### Scenario: A pre-existing mismatched binding fails legibly
- **WHEN** a REST source whose stored `connectorId` references a `sql`-kind Connector is fetched,
  previewed, or refreshed
- **THEN** the operation fails with an error naming the expected and actual kind, no HTTP request
  is issued to the Connector's `baseUrl`, and no credential decryption is attempted

#### Scenario: A matching-kind Connector still fetches
- **WHEN** a REST source bound to a `rest_api` Connector is fetched
- **THEN** resolution succeeds and the request is composed and issued exactly as before
