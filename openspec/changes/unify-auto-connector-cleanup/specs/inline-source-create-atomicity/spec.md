## ADDED Requirements

### Requirement: Every implicit-Connector cleanup applies the single auto-created rule
Every path that removes the implicit Connector of a bare-`url` REST source it created or is deleting (source-create failure cleanup, inline-root compensation, and patch-set undo of a pipeline create) SHALL apply the same rule as a user source delete: the Connector is removed if and only if its server-owned `implicit` flag is `true`, its name still starts with `Auto: `, no data source references it, and it is owned by the acting user. A failure SHALL be logged with identifiers, the exception class and the SQLSTATE only, never with an exception message, Connector config or credential value, and SHALL NOT replace the original outcome.

#### Scenario: A renamed inline source's Auto Connector is still removed on compensation
- **WHEN** a bare-`url` REST inline source was renamed and is then compensated or removed by undo
- **THEN** its still-`Auto: `-named implicit Connector and credential row no longer exist

#### Scenario: An adopted Connector survives undo
- **WHEN** the implicit Connector was renamed so its name no longer starts with `Auto: `, and the pipeline create is undone
- **THEN** the inline source is removed and the Connector and its credential still exist

#### Scenario: A shared Auto Connector survives until its last source is gone
- **WHEN** another source references the implicit Connector and the pipeline create is undone
- **THEN** the inline source is removed and the Connector and its credential still exist

#### Scenario: Cleanup failure logs carry no exception message
- **WHEN** a cleanup step fails with an exception whose message contains a secret value
- **THEN** no log line contains that value, and the original outcome is unchanged
