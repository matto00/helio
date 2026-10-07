## MODIFIED Requirements

### Requirement: Coverage drift fails

Every top-level directory in the repository SHALL be classified into exactly one of three states: fully covered by
a declared surface root at, inside, or beneath it; partially covered, requiring a recorded entry naming the scanned
subtree and why the remainder is not scanned; or acknowledged unscanned, requiring a recorded one-line reason. The
gate SHALL fail when it finds a top-level directory in none of the three states. Directories that are never
committed — build and tooling output, and dot-prefixed directories — SHALL be excluded from classification, and the
basis for that exclusion SHALL be documented in the script. Every directory that `.gitignore` ignores at the
repository root SHALL be in that exclusion, and the self-test SHALL fail when a root-level directory pattern in
`.gitignore` is not excluded, other than the self-test's own probe directories that are meant to trip the guard.

#### Scenario: A new top-level directory appears

- **WHEN** a top-level directory exists that is in none of the three classified states
- **THEN** the gate exits non-zero
- **AND** the message names the directory and states which list to add it to

#### Scenario: A partially covered directory is not misreported as unscanned

- **WHEN** a top-level directory contains a declared surface root but is not wholly covered by it
- **THEN** it is recorded as partially covered, distinctly from an acknowledged-unscanned directory, so a future
  loss of that surface root is not indistinguishable from a deliberate acknowledgment

#### Scenario: The guard is stable across checkouts

- **WHEN** the gate runs from a linked worktree and from the main checkout, whose top-level contents differ by
  uncommitted build and tooling output
- **THEN** the classification and the verdict are the same in both

#### Scenario: Gitignored e2e evidence output does not trip the guard

- **WHEN** the gitignored `e2e-evidence/` directory written by e2e specs exists at the repository root
- **THEN** the gate does not report coverage drift for it

#### Scenario: A root-level gitignore entry without a matching exclusion is caught

- **WHEN** `.gitignore` ignores a directory at the repository root that the gate does not exclude
- **THEN** the self-test exits non-zero and names the directory
