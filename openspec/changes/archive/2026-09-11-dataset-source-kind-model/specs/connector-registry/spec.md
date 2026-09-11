## MODIFIED Requirements

### Requirement: ConnectorRegistry enumerates every source kind
The backend SHALL define `ConnectorRegistry` in `com.helio.domain` exposing `all: Vector[ConnectorMetadata]`
containing exactly one entry per source kind (`csv`, `rest_api`, `sql`, `dataset`, `text`, `pdf`,
`image`). Every entry SHALL be reachable from a dependency-free static context — no `ActorSystem`,
no constructor arguments, no instance state — since `DataSourceKind.All` (a static value read from
contexts with no `ActorSystem` in scope, e.g. `DataSourceProtocol.scala`'s JSON discriminators,
`DataSourceRepository.scala`) derives from this registry. Entries for kinds with a `ConnectorDriver[Config]`
SPI implementation (`sql`, `rest_api`) SHALL be sourced from that implementation's dependency-free
static `metadata` value (`SqlConnectorDriver.metadata`, an `object` member; `RestApiConnectorDriver.metadata`,
a companion-object `val` — never an instance member, since constructing a `RestApiConnectorDriver`
requires an `ActorSystem`); entries for kinds without a live SPI implementation (`csv`, `dataset`,
`text`, `pdf`, `image`) SHALL be static `ConnectorMetadata` values registered directly in
`ConnectorRegistry`.

#### Scenario: Registry contains all seven kinds
- **WHEN** `ConnectorRegistry.all` is read
- **THEN** it contains exactly one `ConnectorMetadata` entry for each of `csv`, `rest_api`, `sql`,
  `dataset`, `text`, `pdf`, `image`, and no others

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
literal `Set[String]`. `DataSourceKind.parseKind` SHALL accept every kind string present in `All`,
plus the literal `"static"` as a temporary wire alias resolving to `"dataset"` (removed no earlier
than one minor release after this change ships), and reject any other string with the same error
message shape as before.

#### Scenario: parseKind behavior is unchanged for existing kinds
- **WHEN** `DataSourceKind.parseKind` is called with any of `csv`, `rest_api`, `sql`, `dataset`,
  `text`, `pdf`, `image`
- **THEN** it returns `Right` with that same kind string, identical to pre-change behavior

#### Scenario: parseKind resolves the static alias to dataset
- **WHEN** `DataSourceKind.parseKind` is called with `"static"`
- **THEN** it returns `Right("dataset")`

#### Scenario: parseKind still rejects unknown kinds
- **WHEN** `DataSourceKind.parseKind` is called with a string not present in the registry and not
  the `"static"` alias
- **THEN** it returns `Left` with an "Unknown source type" message listing the valid values

### Requirement: Registry/DataSourceKind enumeration cannot silently drift
A test SHALL fail if a source kind is added to `DataSourceKind` (a new `DataSource` subtype and its
`kind` string) without a corresponding `ConnectorRegistry` registration, or vice versa — this SHALL
NOT rely on prose documentation alone. The `"static"` wire alias SHALL NOT be treated as a distinct
registry kind for this drift check — only `"dataset"` is a registered kind.

#### Scenario: Registry and DataSourceKind.All sets match a kind set fixed independently in the test
- **WHEN** the backend test suite runs `ConnectorRegistrySpec`
- **THEN** it asserts `ConnectorRegistry.all.map(_.kind).toSet == DataSourceKind.All` AND that both
  sets equal a literal kind-name set (containing `dataset`, not `static`) written independently in
  the test file (not derived from either production value), so an un-registered new kind or an
  un-declared registry entry fails the assertion
