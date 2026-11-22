# orphan-upload-folder-prune Specification

## Purpose
A dry-run-first script lists the per-user assistant-conversation upload folders whose user exists in none of the given databases, and deletes them only with an explicit flag, by exact id.

## Requirements

### Requirement: Orphan conversation folders are listed against every given database

A repository script SHALL list the per-user conversation folders under an explicitly given uploads root whose folder
name is a well-formed user UUID that exists as a user id in none of the explicitly given databases. It SHALL require
the uploads root and at least one database; it SHALL NOT default the uploads root. A folder whose name is not a
well-formed UUID SHALL be counted as skipped and never listed or deleted. If any given database cannot be read, the
script SHALL fail with no folder listed as an orphan and nothing deleted. It SHALL NOT print any connection string or
credential.

#### Scenario: Dry run lists orphans and changes nothing

- **WHEN** the script runs without the delete flag over a root holding folders for a user present in one database and
  a user present in none
- **THEN** it lists only the second user's folder, reports counts, and every folder and file under the root is
  unchanged

#### Scenario: A user present in any given database is not an orphan

- **WHEN** a folder's user id exists in the second of two given databases only
- **THEN** the folder is not listed

#### Scenario: Unreadable database fails closed

- **WHEN** one given database cannot be queried
- **THEN** the script exits non-zero, lists no orphan, and deletes nothing

### Requirement: Orphan folders are deleted only with an explicit flag, by exact id

The script SHALL delete nothing unless invoked with an explicit delete flag. With the flag it SHALL delete exactly the
listed orphan folders, each addressed by joining the uploads root, the conversation family directory and the exact
UUID; it SHALL NOT use any glob, pattern, prefix or time-window selection, and SHALL NOT follow a folder that is a
symbolic link.

#### Scenario: Delete flag removes only the orphans

- **WHEN** the script runs with the delete flag
- **THEN** the orphan folders are gone and every non-orphan and skipped folder is unchanged
