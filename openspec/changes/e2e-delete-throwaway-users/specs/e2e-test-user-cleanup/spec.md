## Purpose

Ensures every e2e run deletes the throwaway users it registered, by exact recorded id only, through a test-only path
that is not part of the product, so the shared dev database stops accumulating gate residue.

## ADDED Requirements

### Requirement: Every e2e user registration is recorded

Every e2e code path that creates a user (API registration through the shared helper, any direct registration call,
and UI-driven signup) SHALL record the created user's exact id and email in the current run's registry immediately
after the registration succeeds. A static check SHALL fail, naming the file, when an e2e source file registers a user
without recording it.

#### Scenario: Shared helper registration

- **WHEN** a spec calls the shared register helper and the server returns 201
- **THEN** the run registry contains that user's id and exact email

#### Scenario: Unrecorded registration is rejected by the check

- **WHEN** an e2e source file posts to the register endpoint (or drives the signup form) and never records the user
- **THEN** the check exits non-zero and names the file

### Requirement: Run teardown deletes exactly the recorded users

At the end of every e2e run, the harness SHALL delete exactly the users recorded by that run, together with the rows
they own that would otherwise block the delete, in a single transaction. The delete SHALL select users only by exact
id, and SHALL abort with nothing deleted unless every recorded id exists with exactly its recorded email and the
number of deleted users equals the number recorded. It SHALL NOT read any other run's registry.

#### Scenario: Users created by a run are gone afterwards

- **WHEN** a full e2e run completes (pass or fail)
- **THEN** none of the users it registered remain in the database

#### Scenario: Recorded id with a mismatched email

- **WHEN** a recorded id exists but its email differs from the recorded email
- **THEN** the transaction aborts, no user is deleted, and the teardown fails loudly naming the mismatch count

### Requirement: The cleanup can only target recorded ids

The deletion builder SHALL accept only well-formed UUID ids and the exact recorded emails, SHALL refuse the system
user id, an empty input, and any email outside the e2e throwaway domains, SHALL repeat the domain refusal and an
explicit exclusion of the owner account in the generated SQL, SHALL read only the current run's registry, and SHALL NOT emit any pattern, name, or time-window predicate. The cleanup path SHALL
NOT exist in the product: no HTTP route, service, or migration is added, and no credential or connection string is
printed on success or failure.

#### Scenario: Non-recorded or malformed input refused

- **WHEN** the builder is given a non-UUID id, the system user id, a duplicate id, or an email containing a quote, backslash, whitespace or control character
- **THEN** it throws before any SQL is produced

#### Scenario: Non-test account refused

- **WHEN** a record's email domain is not an e2e throwaway domain, or is the owner account
- **THEN** the builder throws, and the generated SQL would match no such row even if the builder check were bypassed

#### Scenario: Another run's registry is ignored

- **WHEN** a sibling run directory with other ids exists next to the current run's registry
- **THEN** none of its ids appear in the generated deletion

#### Scenario: Connection failure does not leak credentials

- **WHEN** the database call fails
- **THEN** the error message contains neither the connection URL nor any password
