## Purpose

Guarantees that every backend test using embedded Postgres runs against the cluster it started itself, so a port collision between concurrently starting instances can never silently redirect a suite onto another suite's database.

## ADDED Requirements

### Requirement: Embedded Postgres starts are verified to reach their own cluster
Every embedded Postgres instance a backend test starts SHALL be confirmed, before any test code uses it, to be served by the cluster whose data directory that instance created. A start that reaches a different cluster SHALL be discarded without stopping or modifying the other cluster, and retried on a different port a bounded number of times. When every attempt fails, the start SHALL fail with an error that names the expected and observed data directories.

#### Scenario: A port collision is detected and retried
- **WHEN** a test starts embedded Postgres on a port another running cluster already holds
- **THEN** the start does not hand the test a connection to that other cluster, the attempt is retried on a different port, and the test receives an instance whose reported data directory is its own

#### Scenario: The foreign cluster is left intact
- **WHEN** a start attempt is discarded because it reached another cluster
- **THEN** that other cluster remains running and its data (roles, tables, rows) is unchanged

#### Scenario: The ownership check itself fails
- **WHEN** confirming which cluster served a start fails with an error (for example, the connection is closed because the cluster it reached is shutting down)
- **THEN** that attempt is treated as unverified: its own data directory is discarded, the error is recorded, and the start is retried within the bound rather than propagating the error to the test

#### Scenario: Retries run out
- **WHEN** every bounded attempt reaches a cluster other than its own
- **THEN** the start fails loudly with an error naming the expected and observed data directories, and no test runs against a foreign cluster

#### Scenario: The unverified direct path is demonstrably unsafe
- **WHEN** an instance is started directly, without verification, on a port another cluster holds
- **THEN** a regression test observes that it reports the other cluster's data directory, documenting why direct starts are forbidden

### Requirement: Direct embedded Postgres starts are rejected mechanically
The backend test suite SHALL fail when any test source other than the shared startup helper starts embedded Postgres directly, and SHALL name each offending file.

#### Scenario: A spec starts embedded Postgres directly
- **WHEN** a test source calls the embedded Postgres builder's start, or the library's static start, outside the shared helper
- **THEN** the guard test fails and its message lists that file

#### Scenario: Every start goes through the helper
- **WHEN** no test source other than the helper starts embedded Postgres directly
- **THEN** the guard test passes

### Requirement: Test database roles and RLS enforcement are unaffected
Moving embedded Postgres starts onto the verified helper SHALL NOT change any test's role names, grants, `SET ROLE` configuration, or row-level-security enforcement. Test pools that run as a non-BYPASSRLS role SHALL still enforce RLS.

#### Scenario: An RLS harness still enforces RLS
- **WHEN** a harness whose app pool runs as a non-superuser, non-BYPASSRLS role starts through the helper
- **THEN** its RLS-enforcement assertion passes, and the same assertion fails if that role is granted BYPASSRLS
