## MODIFIED Requirements

### Requirement: Embedded Postgres starts are verified to reach their own cluster
Every embedded Postgres instance a backend test starts SHALL be confirmed, before any test code uses it, to be served by the cluster whose data directory that instance created. A start that reaches a different cluster SHALL be discarded without stopping or modifying the other cluster, and retried on a different port a bounded number of times. When every attempt fails, the start SHALL fail with an error that names the expected and observed data directories. An attempt that ends in any other way than being handed to the test SHALL NOT leave its own data directory behind.

#### Scenario: A port collision is detected and retried
- **WHEN** a test starts embedded Postgres on a port another running cluster already holds
- **THEN** the start does not hand the test a connection to that other cluster, the attempt is retried on a different port, and the test receives an instance whose reported data directory is its own

#### Scenario: The foreign cluster is left intact
- **WHEN** a start attempt is discarded because it reached another cluster
- **THEN** that other cluster remains running and its data (roles, tables, rows) is unchanged

#### Scenario: The ownership check itself fails
- **WHEN** confirming which cluster served a start fails with an error (for example, the connection is closed because the cluster it reached is shutting down)
- **THEN** that attempt is treated as unverified: its own data directory is discarded, the error is recorded, and the start is retried within the bound rather than propagating the error to the test

#### Scenario: The ownership check is interrupted by a fatal throwable
- **WHEN** confirming which cluster served a start is ended by a fatal throwable (one that must not be swallowed, such as an interruption)
- **THEN** the attempt's own instance is closed and its own data directory is deleted, and that same throwable propagates unchanged without a retry

#### Scenario: The library's own start fails
- **WHEN** the embedded Postgres library's start throws before an instance is returned
- **THEN** the attempt's own data directory is deleted and the library's error propagates unchanged

#### Scenario: Retries run out
- **WHEN** every bounded attempt reaches a cluster other than its own
- **THEN** the start fails loudly with an error naming the expected and observed data directories, and no test runs against a foreign cluster

#### Scenario: The unverified direct path is demonstrably unsafe
- **WHEN** an instance is started directly, without verification, on a port another cluster holds
- **THEN** a regression test observes that it reports the other cluster's data directory, documenting why direct starts are forbidden

### Requirement: Direct embedded Postgres starts are rejected mechanically
The backend test suite SHALL fail when any test source other than the shared startup helper starts embedded Postgres directly, and SHALL name each offending file. Comment-looking text inside a well-formed string literal SHALL NOT hide a direct start from this check, including literals using the `$"` escape of interpolated strings and backslash escapes inside `raw` interpolated strings.

#### Scenario: A spec starts embedded Postgres directly
- **WHEN** a test source calls the embedded Postgres builder's start, or the library's static start, outside the shared helper
- **THEN** the guard test fails and its message lists that file

#### Scenario: Every start goes through the helper
- **WHEN** no test source other than the helper starts embedded Postgres directly
- **THEN** the guard test passes

#### Scenario: A string-literal escape precedes a same-line direct start
- **WHEN** a test source line holds an interpolated string using the `$"` escape, or a `raw` interpolated string containing `\"`, whose content includes `//`, followed on the same line by a direct start
- **THEN** the guard reports that direct start
