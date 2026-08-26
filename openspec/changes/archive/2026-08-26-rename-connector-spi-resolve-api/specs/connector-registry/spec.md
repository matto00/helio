## RENAMED Requirements

- FROM: `### Requirement: GET /api/connectors returns the registry`
- TO: `### Requirement: GET /api/connector-types returns the registry`

- FROM: `### Requirement: list_connectors MCP tool`
- TO: `### Requirement: list_connector_types MCP tool`

## MODIFIED Requirements

### Requirement: ConnectorRegistry enumerates every source kind
The backend SHALL define `ConnectorRegistry` in `com.helio.domain` exposing `all: Vector[ConnectorMetadata]`
containing exactly one entry per source kind (`csv`, `rest_api`, `sql`, `static`, `text`, `pdf`,
`image`). Every entry SHALL be reachable from a dependency-free static context — no `ActorSystem`,
no constructor arguments, no instance state — since `DataSourceKind.All` (a static value read from
contexts with no `ActorSystem` in scope, e.g. `DataSourceProtocol.scala`'s JSON discriminators,
`DataSourceRepository.scala`) derives from this registry. Entries for kinds with a `ConnectorDriver[Config]`
SPI implementation (`sql`, `rest_api`) SHALL be sourced from that implementation's dependency-free
static `metadata` value (`SqlConnectorDriver.metadata`, an `object` member; `RestApiConnectorDriver.metadata`,
a companion-object `val` — never an instance member, since constructing a `RestApiConnectorDriver`
requires an `ActorSystem`); entries for kinds without a live SPI implementation (`csv`, `static`,
`text`, `pdf`, `image`) SHALL be static `ConnectorMetadata` values registered directly in
`ConnectorRegistry`.

#### Scenario: Registry contains all seven kinds
- **WHEN** `ConnectorRegistry.all` is read
- **THEN** it contains exactly one `ConnectorMetadata` entry for each of `csv`, `rest_api`, `sql`,
  `static`, `text`, `pdf`, `image`, and no others

#### Scenario: SQL and REST entries are sourced from dependency-free static metadata
- **WHEN** `ConnectorRegistry.all` is read
- **THEN** the `sql` entry equals `SqlConnectorDriver.metadata` and the `rest_api` entry equals
  `RestApiConnectorDriver.metadata` (the companion object's `val`) — constructing neither requires an
  `ActorSystem` or any other dependency

#### Scenario: DataSourceKind's static call sites never need to construct a connector
- **WHEN** `DataSourceKind.All` is read from a context with no `ActorSystem` in scope (e.g.
  `DataSourceProtocol.scala`'s JSON discriminators or `DataSourceRepository.scala`)
- **THEN** the read succeeds without constructing a `RestApiConnectorDriver` instance or any other
  connector requiring runtime dependencies

### Requirement: DataSourceKind derives from the registry
`DataSourceKind.All` SHALL be computed as `ConnectorRegistry.all.map(_.kind).toSet` rather than a
literal `Set[String]`. `DataSourceKind.parseKind` SHALL continue to accept exactly the same set of
kind strings it accepted before this change, and reject any other string with the same error message
shape.

#### Scenario: parseKind behavior is unchanged for existing kinds
- **WHEN** `DataSourceKind.parseKind` is called with any of `csv`, `rest_api`, `sql`, `static`,
  `text`, `pdf`, `image`
- **THEN** it returns `Right` with that same kind string, identical to pre-change behavior

#### Scenario: parseKind still rejects unknown kinds
- **WHEN** `DataSourceKind.parseKind` is called with a string not present in the registry
- **THEN** it returns `Left` with an "Unknown source type" message listing the valid values

### Requirement: Registry/DataSourceKind enumeration cannot silently drift
A test SHALL fail if a source kind is added to `DataSourceKind` (a new `DataSource` subtype and its
`kind` string) without a corresponding `ConnectorRegistry` registration, or vice versa — this SHALL
NOT rely on prose documentation alone.

#### Scenario: Registry and DataSourceKind.All sets match a kind set fixed independently in the test
- **WHEN** the backend test suite runs `ConnectorRegistrySpec`
- **THEN** it asserts `ConnectorRegistry.all.map(_.kind).toSet == DataSourceKind.All` AND that both
  sets equal a literal kind-name set written independently in the test file (not derived from either
  production value), so an un-registered new kind or an un-declared registry entry fails the
  assertion

### Requirement: GET /api/connector-types returns the registry
The backend SHALL expose `GET /api/connector-types` in the authenticated route tree, returning a JSON
array where each element carries `kind`, `displayName`, `supportsIncremental`, `authKind`, and
`requiredFields` (an array of `{ name, label, secret }` objects) — one element per
`ConnectorRegistry.all` entry, in registry order. The response SHALL NOT include any credential or
secret field value, only field descriptors. The route previously served at `GET /api/connectors`;
that path is freed for a future entity endpoint and no longer serves this response.

#### Scenario: Authenticated client fetches the registry
- **WHEN** an authenticated client sends `GET /api/connector-types`
- **THEN** the response is `200 OK` with a JSON array of 7 entries, each including `requiredFields`
  descriptors with no secret values present anywhere in the payload

#### Scenario: Unauthenticated request is rejected
- **WHEN** a client sends `GET /api/connector-types` without a valid session/token
- **THEN** the response is `401 Unauthorized`, matching the existing authenticated-route-tree
  behavior for sibling endpoints

### Requirement: list_connector_types MCP tool
The MCP server SHALL expose a `list_connector_types` read tool (`helio-mcp/src/tools/read.ts` +
`helioApi.ts`) that calls `GET /api/connector-types` and returns the response verbatim as the tool
result, following the existing `guarded(() => api.xxx())` pass-through pattern used by the other read
tools. The tool was previously named `list_connectors`; that name is retired.

#### Scenario: Agent enumerates connectors before creating a source
- **WHEN** an agent calls `list_connector_types`
- **THEN** the tool returns the same 7-entry registry payload the HTTP endpoint returns, including
  each kind's `requiredFields`, so the agent can determine what a `create_*_data_source` call needs
  before calling it

### Requirement: SourceTypeToggle renders from the registry
The frontend `SourceTypeToggle` component SHALL render its buttons from a `GET /api/connector-types`-backed
list rather than a hardcoded set, while rendering the identical 7 buttons (same order, same labels)
for the current kinds.

#### Scenario: Toggle renders the same options as before for existing kinds
- **WHEN** `AddSourceModal` opens and the registry has loaded
- **THEN** `SourceTypeToggle` renders exactly the same 7 buttons, in the same order, with the same
  labels, as the pre-change hardcoded implementation
