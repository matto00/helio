# pipeline-zero-root-db-guard Specification

## Purpose
The database-level backstop for `pipeline-multi-root` R1 ("a pipeline with zero roots is not a
representable state"): what the zero-root guard must catch, which callers it must catch it for, and
what it must never falsely reject. Stated as behaviour so that a guard which silently stops firing
is a spec violation rather than an undocumented regression in a migration header.

## Requirements

### Requirement: The zero-root guard enforces for every writer, independent of RLS session state

A delete that would leave a still-existing pipeline with zero roots SHALL be rejected at the
database level and the transaction rolled back, regardless of the deleting session's row-level
security visibility. Enforcement SHALL NOT depend on `app.current_user_id` being set, on the
deleting role holding `BYPASSRLS`, or on the affected `pipelines`/`pipeline_roots` rows being
visible under the caller's own policies.

This covers writers that reach `pipeline_roots` with no user context — a migration, an admin
script, a background job, or a connection taken from the privileged pool — as well as the ordinary
user-context path. The no-user-context shape that actually matters is a **privileged
(`BYPASSRLS`) pool connection** with `app.current_user_id` never set: on a plain `NOSUPERUSER
NOBYPASSRLS` app-pool connection, `data_sources_owner`'s own policy has no `missing_ok=true` and
raises `42704`/`22P02` on the outer DELETE before the trigger is ever reached — that shape is
unreachable, not unprotected, and is not what this requirement is about (see `probe.md`, task
1.1).

#### Scenario: Deleting a sole root's DataSource with no user context raises

- **WHEN** a connection on the privileged (`BYPASSRLS`) pool — a role that is `NOSUPERUSER` and
  `NOBYPASSRLS` but has escalated via `SET ROLE helio_privileged`, with `app.current_user_id` never
  set — deletes a DataSource that is bound by the only root of a still-existing pipeline
- **THEN** the statement raises, naming the zero-root invariant
- **THEN** the transaction rolls back, leaving the pipeline, its root, and the DataSource intact —
  no `pipelines=1, roots=0` state is reachable

#### Scenario: The same delete raises identically under a user context

- **WHEN** the same delete is issued with `app.current_user_id` set to the pipeline's owner
- **THEN** it raises the same error, so the user-facing 409 mapping keyed on that error signature is
  unaffected

### Requirement: The zero-root guard does not reject legitimate deletes

The guard SHALL reject only a delete that empties a **still-existing** pipeline's roots. It SHALL
NOT reject any other delete, under any RLS session state.

#### Scenario: Removing one of several roots succeeds

- **WHEN** a pipeline has two roots and one of them (or its DataSource) is deleted
- **THEN** the delete succeeds and the pipeline retains its remaining root

#### Scenario: Deleting the pipeline itself succeeds

- **WHEN** a pipeline is deleted, cascading away all of its roots in the same statement
- **THEN** the delete succeeds and raises nothing, because no pipeline is left behind rootless

#### Scenario: A no-user-context delete of a whole pipeline still succeeds

- **WHEN** a connection on the privileged (`BYPASSRLS`) pool — `SET ROLE helio_privileged`, with
  `app.current_user_id` never set — deletes a pipeline
- **THEN** the delete succeeds — making the guard RLS-independent SHALL NOT convert previously
  legal deletes into failures
