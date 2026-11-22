## ADDED Requirements

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
