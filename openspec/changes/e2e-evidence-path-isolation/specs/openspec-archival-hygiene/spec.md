## MODIFIED Requirements

### Requirement: Preservation of the other hygiene rules

The OpenSpec hygiene check SHALL continue to report changes with no tasks, stray non-directory entries in the
changes directory, and leftover executor handoff files in archived changes, unchanged by archival-overdue
scoping. A change directory with no tasks whose every contained file is gitignored (so nothing in it can ever be
committed) SHALL NOT fail the check; the check SHALL instead write a stderr notice naming that directory and
stating it holds only gitignored files. When git cannot be consulted, such a directory SHALL be reported as a
no-tasks error as before.

#### Scenario: Change has no tasks

- **WHEN** the check runs and an unarchived change has no task entries and contains at least one tracked or
  committable (not gitignored) file
- **THEN** the check reports that change and exits non-zero, independent of the overdue conditions

#### Scenario: Change directory holds only gitignored files

- **WHEN** the check runs and an unarchived change directory with no tasks contains only gitignored files
- **THEN** the check does not report it as an error
- **AND** the check writes a stderr notice naming that directory

#### Scenario: Gitignored-only directory without git

- **WHEN** git is unavailable and an unarchived change has no tasks
- **THEN** the check reports that change and exits non-zero

#### Scenario: Stray file present in the changes directory

- **WHEN** the check runs and a non-directory entry exists directly under the changes directory
- **THEN** the check reports that stray entry and exits non-zero

#### Scenario: Leftover executor handoff in an archived change

- **WHEN** the check runs and an archived change directory contains a `files-modified.md` handoff file
- **THEN** the check reports that leftover file and exits non-zero

#### Scenario: Archive directory absent

- **WHEN** the check runs against a repository that has no archive directory under the changes directory
- **THEN** the check treats it as containing no archived changes and does not fail with an unhandled error
