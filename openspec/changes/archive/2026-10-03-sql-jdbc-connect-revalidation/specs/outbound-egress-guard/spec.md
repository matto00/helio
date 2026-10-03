## REMOVED Requirements

### Requirement: The JDBC path is exempt from connection pinning, with the residual risk recorded
**Reason**: HEL-998 closes the DNS-rebinding window with connect-time re-validation, so the exemption no longer applies.
**Migration**: Superseded by the requirement below.

## ADDED Requirements

### Requirement: The JDBC path re-validates the destination address at TCP connect
The JDBC path SHALL re-validate the destination address at the moment the driver opens its TCP connection, using a driver socket-factory hook for each supported dialect (`postgresql`, `mysql`). The hook SHALL validate the address actually being connected to (never a re-resolved hostname) against the same shared egress policy that governs outbound HTTP, and SHALL refuse to connect when that address is blocked or unresolved. The application's own database connection SHALL NOT use this hook. Connections SHALL NOT use URL rewriting, so TLS hostname verification is unaffected. Because no hook can be assumed for other dialects, a dialect other than `postgresql` or `mysql` SHALL be refused with a clear client error at source creation and at connect time.

#### Scenario: A rebinding resolver does not reach the internal address
- **WHEN** the egress guard's lookup sees a public address and the driver's own lookup of the same host yields an internal address
- **THEN** the connect-time hook refuses the connection
- **AND** no TCP connection to the internal address is accepted

#### Scenario: Both supported dialects are covered
- **WHEN** a SQL connection to a user-supplied host is opened for `postgresql` or `mysql`
- **THEN** the connection is made through the connect-time re-validating socket factory

#### Scenario: An unknown dialect is refused
- **WHEN** a SQL data source names a dialect other than `postgresql` or `mysql`
- **THEN** creation is refused with a 4xx and a message naming the supported dialects
- **AND** an already-persisted source with such a dialect fails at connect with the same message and opens no connection

#### Scenario: The application's own database is unaffected
- **WHEN** the application opens its own database connection pool or notify connection
- **THEN** no connect-time egress socket factory is attached

### Requirement: JDBC URL components cannot override the connect-time hook
The database name of a SQL source SHALL be restricted to a safe identifier character set so no user-controlled value can introduce a JDBC URL query parameter (such as `socketFactory`) that would override or disable the connect-time hook. A violating source SHALL be refused with a 4xx at creation and at connect time.

#### Scenario: A database name carrying a URL parameter is refused
- **WHEN** a SQL source's database is `x?socketFactory=javax.net.DefaultSocketFactory`
- **THEN** it is refused and no connection is opened
