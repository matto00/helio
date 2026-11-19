## MODIFIED Requirements

### Requirement: e2e shard assignment is weighted from CI evidence
Shard assignment SHALL be a deterministic function of the discovered spec files and a checked-in per-spec weight table
derived from CI Playwright reports (not local runs). Specs absent from the table SHALL receive a defined default
weight. The table SHALL be regenerable from CI artifacts by a documented command. When the regeneration is given the
current discovered test list, each test result in a report SHALL be weighted to a current spec file by its title path
(the describe chain plus the test title, excluding the file-level suite and the project) as follows: to the
file the report names if that file still contains a test with the same title path; otherwise to the one current file
that contains a test with that title path (a test moved by a split); otherwise to the file the report names if that
file is still discovered (a renamed test). A result whose title path is in several current files, none of them the
reported one, SHALL make the regeneration fail and name the test. A result that matches no current test and whose
file is no longer discovered SHALL be left out of the table and named on the regeneration's diagnostic output.

#### Scenario: Assignment is deterministic
- **WHEN** two legs of the same run compute the assignment from the same discovered specs and weight table
- **THEN** they compute the identical partition

#### Scenario: A split spec is weighted from the runs that measured it before the split
- **WHEN** a spec file is split into several files and the table is regenerated, with the current test list, from CI
  reports taken before the split
- **THEN** each new file's weight is the median across runs of the summed duration of the tests it now contains, and the old
  file has no row

#### Scenario: An ambiguous moved test fails the regeneration
- **WHEN** a report test's file no longer contains its title path and that title path is in more than one current file
- **THEN** the regeneration fails and names the test, rather than guessing or double-counting its duration

#### Scenario: Regeneration without the test list is unchanged
- **WHEN** the table is regenerated without the current test list
- **THEN** each result is weighted to the file its report names, exactly as before this change
