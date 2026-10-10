# ci-required-jobs-guard Specification

## Purpose
Guarantees that every job in the CI workflow gates merges, by statically failing whenever a job is missing from the
aggregate `ci-complete` check's `needs` list.

## Requirements

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
The check SHALL parse `ci.yml` with a real YAML parser (not a line scanner), so lines inside multi-line quoted or flow
scalars are string content and never structure. It SHALL exit non-zero, rather than pass, when it cannot establish the
job set or the `needs` list: when the YAML does not parse (including a duplicate key), when there is no `jobs` mapping
or it is empty, when `ci-complete` is missing, when `ci-complete` has no `needs` or a `needs` that is not a list (a
scalar `needs: a` is rejected), when a `needs` entry is not a bare job id string, or when `needs` names a job that does
not exist.

#### Scenario: needs is a scalar
- **WHEN** `ci-complete`'s `needs` is the scalar `needs: a`
- **THEN** the check exits non-zero saying `needs` must be a list of job ids

#### Scenario: ci-complete missing
- **WHEN** `ci.yml` has no `ci-complete` job
- **THEN** the check exits non-zero

#### Scenario: Invalid needs entry
- **WHEN** a `needs` entry is empty, non-string, or not a bare job id
- **THEN** the check exits non-zero naming the entry

#### Scenario: Duplicate job key
- **WHEN** a job key (for example `ci-complete`) appears twice as a real mapping key in the `jobs` mapping
- **THEN** the check exits non-zero as unparseable YAML

#### Scenario: Structure-looking lines inside a quoted scalar
- **WHEN** a multi-line quoted string contains lines that look like job keys, `needs:` lines or column-0 keys
- **THEN** those lines are string content: the real jobs and the real `needs` are checked, and a real job missing from `needs` is named

#### Scenario: Comment mentioning needs above the real list
- **WHEN** a comment in the `ci-complete` job lists every job in `needs: [...]` form, and the real `needs` omits one
- **THEN** the check exits non-zero and names the omitted job
