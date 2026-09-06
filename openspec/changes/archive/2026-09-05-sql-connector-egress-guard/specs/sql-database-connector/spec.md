## ADDED Requirements

### Requirement: SQL destinations are egress-guarded
Creating a SQL data source, and opening a JDBC connection for any SQL operation, SHALL refuse a host whose resolved
address falls in blocked address space. The connect-time check SHALL be the enforcement boundary and SHALL apply to
every SQL operation — preview, refresh, schema inference, connection test, and pipeline execution — because a persisted
host is re-resolved on each use. A host that merely fails to resolve SHALL NOT block creation, but SHALL be refused at
connect time.

#### Scenario: Creating a SQL data source with an internal host is rejected
- **WHEN** a SQL data source is created with a host resolving to loopback, link-local, or private address space
- **THEN** the request is rejected
- **AND** no data source is persisted

#### Scenario: Every SQL operation is guarded, not just creation
- **WHEN** a persisted SQL data source's host resolves to blocked address space at the time it is used
- **THEN** the operation is refused before any JDBC connection is opened

#### Scenario: An unresolvable host is creatable but not connectable
- **WHEN** a SQL data source names a host that does not currently resolve
- **THEN** creation succeeds
- **AND** a later attempt to connect is refused

#### Scenario: A legitimate external database host still works
- **WHEN** a SQL data source names a host resolving to a public address
- **THEN** the connection proceeds unchanged
