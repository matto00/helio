## Purpose

Guarantees that every job in the CI workflow gates merges, by statically failing whenever a job is missing from the
aggregate `ci-complete` check's `needs` list.

## ADDED Requirements

### Requirement: Every CI job is required by ci-complete
A static check SHALL fail whenever any job defined in `.github/workflows/ci.yml`, other than `ci-complete` itself, is
absent from `ci-complete`'s `needs` list, naming each missing job. The check SHALL run both in the pre-commit hook and
in a CI job that `ci-complete` depends on.

#### Scenario: A job left out of needs
- **WHEN** `ci.yml` defines a job that is not listed in `ci-complete`'s `needs`
- **THEN** the check exits non-zero and names that job

#### Scenario: Every job listed
- **WHEN** every job other than `ci-complete` is listed in `ci-complete`'s `needs`
- **THEN** the check exits zero

### Requirement: The guard fails closed
The check SHALL exit non-zero, rather than pass, when it cannot establish the job set or the `needs` list: when no
jobs are found, when `ci-complete` is missing, when `ci-complete` has no `needs` or a `needs` not written as a
single-line list, when `needs` names a job that does not exist or contains an entry that is not a bare job id, or
when the jobs mapping contains a key it cannot read as a bare job id (for example a quoted key). `jobs:` SHALL be the last top-level key: any non-comment column-0 line after it SHALL be an error rather than the end of the jobs mapping. Comment lines,
including column-0 comments between jobs, SHALL NOT end the jobs mapping, and comment lines SHALL never be read as the
`needs` list; `ci-complete` having more than one `needs` key line SHALL be an error. A job key appearing more than once in the jobs mapping SHALL be an error.

#### Scenario: needs written as a multi-line list
- **WHEN** `ci-complete`'s `needs` is written as a block (multi-line) list
- **THEN** the check exits non-zero with a message saying the list could not be parsed

#### Scenario: ci-complete missing
- **WHEN** `ci.yml` has no `ci-complete` job
- **THEN** the check exits non-zero

#### Scenario: Quoted job key
- **WHEN** `ci.yml` defines a job with a quoted key such as `"lint":`
- **THEN** the check exits non-zero naming the unreadable line, rather than skipping that job

#### Scenario: Column-0 comment between jobs
- **WHEN** a column-0 comment sits between two jobs and the later job is missing from `needs`
- **THEN** the check exits non-zero and names the later job

#### Scenario: Comment mentioning needs above the real list
- **WHEN** a comment in the `ci-complete` job lists every job in `needs: [...]` form, and the real `needs` line omits one
- **THEN** the check exits non-zero and names the omitted job

#### Scenario: Column-0 line after jobs
- **WHEN** a non-comment column-0 line follows `jobs:` (for example the continuation of a multi-line quoted string that would otherwise hide a later job)
- **THEN** the check exits non-zero naming that line

#### Scenario: Duplicate job key
- **WHEN** a job key (for example `ci-complete`) appears twice, such as a fake copy inside an earlier job's multi-line quoted string
- **THEN** the check exits non-zero naming the duplicate key
