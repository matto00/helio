## ADDED Requirements

### Requirement: Archival overdue reporting

The OpenSpec hygiene check SHALL report an unarchived change whose `tasks.md` is fully checked only when that
change is overdue for archival, where overdue means the change is reachable from the base branch, or its last
activity is older than the staleness threshold. A fully-checked change that is neither SHALL NOT be reported.

#### Scenario: Change escaped to the base branch unarchived

- **WHEN** the check runs and a fully-checked, unarchived change directory is reachable from the base branch
- **THEN** the check reports that change as overdue for archival and exits non-zero
- **AND** the message identifies the base branch it was found on

#### Scenario: Committed change inactive beyond the staleness threshold

- **WHEN** the check runs and a fully-checked, unarchived change's most recent commit has an author date older
  than the staleness threshold
- **THEN** the check reports that change as overdue for archival and exits non-zero
- **AND** the message states how long the change has been inactive

#### Scenario: Change rebased after its last real activity

- **WHEN** a fully-checked, unarchived change whose author date is older than the staleness threshold is rebased,
  moving its committer date to the present
- **THEN** the check still reports that change as overdue for archival

#### Scenario: Uncommitted change older than the staleness threshold

- **WHEN** the check runs and a fully-checked, unarchived change directory has never been committed and its
  filesystem modification time is older than the staleness threshold
- **THEN** the check reports that change as overdue for archival and exits non-zero

#### Scenario: Change in flight on the current branch

- **WHEN** the check runs and a fully-checked, unarchived change is absent from the base branch and its last
  activity is more recent than the staleness threshold
- **THEN** the check does not report that change
- **AND** the check exits zero if no other hygiene rule is violated

### Requirement: Exempt-change diagnostic

The OpenSpec hygiene check SHALL, for every fully-checked unarchived change it examines and exempts, emit a
diagnostic line naming the change and the reason it was exempt, so that examining-and-exempting is
distinguishable from doing nothing at all.

#### Scenario: In-flight change is examined and exempted

- **WHEN** the check exempts a fully-checked, unarchived change as in flight
- **THEN** the check emits a diagnostic naming that change and the reason it was exempt

#### Scenario: No fully-checked change present

- **WHEN** the check runs and no unarchived change is fully checked
- **THEN** the check emits no exempt diagnostic

### Requirement: Staleness threshold configuration

The OpenSpec hygiene check SHALL use a default staleness threshold of 14 days and SHALL allow that threshold to
be overridden by the `OPENSPEC_HYGIENE_STALE_DAYS` environment variable.

#### Scenario: Default threshold applies

- **WHEN** the check runs without `OPENSPEC_HYGIENE_STALE_DAYS` set
- **THEN** a change is treated as stale only once its last activity is more than 14 days old

#### Scenario: Threshold overridden

- **WHEN** `OPENSPEC_HYGIENE_STALE_DAYS` is set to a positive integer
- **THEN** the check uses that value in place of the default when deciding staleness

#### Scenario: Threshold value is invalid

- **WHEN** `OPENSPEC_HYGIENE_STALE_DAYS` is set to a non-integer or non-positive value
- **THEN** the check uses the default threshold

### Requirement: Conservative degradation without git context

The OpenSpec hygiene check SHALL degrade toward reporting rather than toward silence whenever git context is
unavailable or a condition cannot be evaluated, and SHALL state on stderr that it has done so.

#### Scenario: Base branch reference cannot be resolved

- **WHEN** neither the remote nor the local base branch reference can be resolved
- **THEN** the check skips the base-branch condition and decides using the staleness condition alone

#### Scenario: A condition cannot be evaluated

- **WHEN** evaluating either overdue condition for a change fails or returns unparsable output
- **THEN** the check treats that change as overdue and reports it
- **AND** the check writes a notice to stderr naming what failed

#### Scenario: Git is unavailable entirely

- **WHEN** git cannot be invoked or the target directory is not a git repository
- **THEN** the check reports every fully-checked unarchived change, as it did before this capability existed
- **AND** the check writes a notice to stderr explaining that it fell back to unconditional reporting

### Requirement: Preservation of the other hygiene rules

The OpenSpec hygiene check SHALL continue to report changes with no tasks, stray non-directory entries in the
changes directory, and leftover executor handoff files in archived changes, unchanged by archival-overdue
scoping.

#### Scenario: Change has no tasks

- **WHEN** the check runs and an unarchived change has no task entries
- **THEN** the check reports that change and exits non-zero, independent of the overdue conditions

#### Scenario: Stray file present in the changes directory

- **WHEN** the check runs and a non-directory entry exists directly under the changes directory
- **THEN** the check reports that stray entry and exits non-zero

#### Scenario: Leftover executor handoff in an archived change

- **WHEN** the check runs and an archived change directory contains a `files-modified.md` handoff file
- **THEN** the check reports that leftover file and exits non-zero

#### Scenario: Archive directory absent

- **WHEN** the check runs against a repository that has no archive directory under the changes directory
- **THEN** the check treats it as containing no archived changes and does not fail with an unhandled error
