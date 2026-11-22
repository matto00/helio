# e2e-test-user-cleanup Specification

## Purpose
Ensures every e2e run deletes the throwaway users it registered, by exact recorded id only, through a test-only path
that is not part of the product, so the shared dev database stops accumulating gate residue.

## Requirements

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

### Requirement: Teardown removes the deleted users' conversation folders

After the user-delete transaction commits, every repository caller of the throwaway-user delete SHALL remove, for each
deleted user, exactly the folder `assistant-conversations/<recorded id>` under the uploads root the backend uses
(resolved as the dev backend resolves it: for `HELIO_UPLOADS_ROOT`, then `HELIO_UPLOADS_DIR`, the process environment
value wins over the backend's `.env` value; with neither set, the home default). It SHALL report only the number of
folders removed, never a path or id.
The folder path SHALL be built only from a recorded id that already passed the delete builder's validation; no other
path is removed, a missing folder is not an error, and a folder is never removed when the delete did not commit.

#### Scenario: A run's user with a conversation leaves no folder

- **WHEN** a recorded user with a conversation folder under the uploads root is deleted by the teardown
- **THEN** that user's folder is gone and every other folder under the root is unchanged

#### Scenario: Failed delete keeps the folders

- **WHEN** the delete transaction aborts
- **THEN** no folder is removed

#### Scenario: The backend's .env uploads root is honoured

- **WHEN** `HELIO_UPLOADS_ROOT` is set only in the backend's `.env` file
- **THEN** the teardown removes the folder under that root, and a process-environment value overrides it when present

### Requirement: A failed folder removal does not block the registry cleanup

Once the user-delete transaction has committed, a failure while removing any deleted user's conversation folder
(including a failure resolving the uploads root) SHALL NOT prevent the remaining folders from being attempted, and
SHALL NOT prevent the run's registry from being cleared. The teardown SHALL then fail loudly, reporting the failure only
as a count of folders not removed, never a path or id. Every other caller of the throwaway-user delete SHALL treat a
non-zero failed count as a failure, reported as a count. A delete that did not commit SHALL still leave the registry in
place.

#### Scenario: Folder removal fails after the delete committed

- **WHEN** the delete commits and removing one recorded user's folder throws
- **THEN** the other users' folders are still removed, the run's registry directory is gone, and the teardown fails
  with a message carrying only the failed count

#### Scenario: The next teardown accepts the left state

- **WHEN** teardown runs again after a folder-removal failure cleared the registry
- **THEN** it deletes nothing and does not fail the exact-match check

#### Scenario: A failed delete still keeps the registry

- **WHEN** the delete transaction aborts
- **THEN** no folder is removed and the registry directory is left in place
